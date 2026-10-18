package am.polylink.keyvault;

import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
@IdentityEnabled
public class KeyVaultService {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransitClient transit;
    private final TransactionTemplate tx;
    private final JsonMapper mapper;
    private final PasswordEncoder encoder;
    private final Clock clock;

    public KeyVaultService(
            JdbcTemplate db,
            Accounts accounts,
            TransitClient transit,
            TransactionTemplate tx,
            JsonMapper mapper,
            PasswordEncoder encoder,
            Clock clock) {
        this.db = db;
        this.accounts = accounts;
        this.transit = transit;
        this.tx = tx;
        this.mapper = mapper;
        this.encoder = encoder;
        this.clock = clock;
    }

    public Map<String, Object> own(Accounts.Account account) {
        var rows =
                Rows.query(
                        db,
                        "SELECT v.*,i.PublicKey FROM keyvault.Vaults v JOIN keyvault.Identities i ON i.UserId=v.UserId AND i.IdentityVersion=v.IdentityVersion WHERE v.UserId=?",
                        account.id());
        if (rows.isEmpty())
            throw new AuthFailure(404, "NOT_FOUND", "Encryption setup is not complete.");
        var row = rows.getFirst();
        return Map.of(
                "versions",
                account.versions(),
                "vault",
                mapper.readTree((byte[]) row.get("VaultPacket")),
                "passwordCopy",
                mapper.readTree((byte[]) row.get("PasswordCopy")),
                "identity",
                new AuthDtos.Identity(
                        "" + account.id(),
                        "" + account.identity(),
                        Secrets.encode((byte[]) row.get("PublicKey"))));
    }

    public Map<String, Object> prepare(Accounts.Account caller, AuthDtos.Setup request) {
        validate(caller, request);
        byte[] fingerprint = Secrets.digest(mapper.writeValueAsBytes(request));
        var existing =
                Rows.query(
                        db,
                        "SELECT * FROM keyvault.Operations WHERE OperationId=?",
                        request.operationId());
        if (!existing.isEmpty())
            return replay(caller, request.operationId(), fingerprint, existing.getFirst());
        byte[] key = Secrets.decode(request.serviceVaultKey(), 32);
        TransitClient.Wrapped wrapped;
        try {
            wrapped = transit.wrap(caller.id(), 1, key);
        } finally {
            Arrays.fill(key, (byte) 0);
        }
        var prepared =
                Map.of(
                        "vault",
                        request.vault(),
                        "passwordCopy",
                        request.passwordCopy(),
                        "identity",
                        request.identity(),
                        "serviceCopy",
                        wrapped.ciphertext(),
                        "context",
                        wrapped.context());
        return tx.execute(
                status -> {
                    var current = accounts.lock(caller.id());
                    current.requireAdmitted();
                    validate(current, request);
                    var rows =
                            Rows.query(
                                    db,
                                    "SELECT * FROM keyvault.Operations WITH(UPDLOCK,HOLDLOCK) WHERE OperationId=?",
                                    request.operationId());
                    if (!rows.isEmpty())
                        return replay(current, request.operationId(), fingerprint, rows.getFirst());
                    db.update(
                            "INSERT keyvault.Operations(OperationId,UserId,Kind,State,CredentialVersion,VaultKeyVersion,VaultRevision,IdentityVersion,PackageFingerprint,PreparedCiphertext,PreparedLoginVerifier,ExpiresAt) VALUES (?,?,'SETUP','READY',?,0,0,0,?,?,?,?)",
                            request.operationId(),
                            current.id(),
                            current.credential(),
                            fingerprint,
                            mapper.writeValueAsBytes(prepared),
                            current.verifier(),
                            OffsetDateTime.now(clock).plusHours(1));
                    return status(request.operationId(), current);
                });
    }

    public Map<String, Object> commit(Accounts.Account caller, UUID operation) {
        return tx.execute(
                status -> {
                    var account = accounts.lock(caller.id());
                    account.requireAdmitted();
                    var rows =
                            Rows.query(
                                    db,
                                    "SELECT * FROM keyvault.Operations WITH(UPDLOCK,HOLDLOCK) WHERE OperationId=?",
                                    operation);
                    if (rows.isEmpty()
                            || ((Number) rows.getFirst().get("UserId")).intValue() != caller.id())
                        throw AuthFailure.denied();
                    var row = rows.getFirst();
                    if (!"SETUP".equals(row.get("Kind"))) throw AuthFailure.denied();
                    if ("COMPLETED".equals(row.get("State"))) return status(operation, account);
                    if (!"READY".equals(row.get("State"))
                            || !((OffsetDateTime) row.get("ExpiresAt"))
                                    .isAfter(OffsetDateTime.now(clock))
                            || account.vaultKey() != 0
                            || ((Number) row.get("CredentialVersion")).longValue()
                                    != account.credential()) throw AuthFailure.conflict();
                    var packageData = mapper.readTree((byte[]) row.get("PreparedCiphertext"));
                    byte[] publicKey =
                            Secrets.decode(
                                    packageData.path("identity").path("publicKey").asText(), 32);
                    db.update(
                            "INSERT keyvault.Identities(UserId,IdentityVersion,PublicKey,CreatedAt) VALUES (?,1,?,?)",
                            account.id(),
                            publicKey,
                            OffsetDateTime.now(clock));
                    db.update(
                            "INSERT keyvault.Vaults(UserId,VaultKeyVersion,VaultRevision,IdentityVersion,VaultPacket,PasswordCopy,ServiceCopy,TransitContext) VALUES (?,1,1,1,?,?,?,?)",
                            account.id(),
                            mapper.writeValueAsBytes(packageData.path("vault")),
                            mapper.writeValueAsBytes(packageData.path("passwordCopy")),
                            packageData.path("serviceCopy").asText(),
                            packageData.path("context").asText());
                    db.update(
                            "UPDATE keyvault.Operations SET State='COMPLETED',CompletedAt=?,CompletionResult=?,PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE OperationId=?",
                            OffsetDateTime.now(clock),
                            mapper.writeValueAsBytes(accounts.get(account.id()).versions()),
                            operation);
                    return status(operation, accounts.get(account.id()));
                });
    }

    private void validate(Accounts.Account account, AuthDtos.Setup request) {
        account.requireAdmitted();
        if (account.vaultKey() != 0 || !account.versions().equals(request.expected()))
            throw AuthFailure.conflict();
        if (!request.identity().userId().equals("" + account.id())
                || !request.identity().version().equals("1")
                || !Secrets.equal(Secrets.decode(request.derivation().salt(), 16), account.salt())
                || request.derivation().opsLimit() != account.ops()
                || request.derivation().memoryBytes() != account.memory()
                || !encoder.matches(request.loginSecret(), account.verifier()))
            throw AuthFailure.denied();
        Secrets.decode(request.identity().publicKey(), 32);
        Secrets.decode(request.vault().nonce(), 24);
        Secrets.decode(request.passwordCopy().nonce(), 24);
        ciphertext(request.vault().ciphertext(), 17, 1048592);
        ciphertext(request.passwordCopy().ciphertext(), 48, 48);
    }

    private static void ciphertext(String encoded, int min, int max) {
        try {
            byte[] data = Base64.getUrlDecoder().decode(encoded);
            if (data.length < min || data.length > max || !Secrets.encode(data).equals(encoded))
                throw AuthFailure.invalid();
        } catch (IllegalArgumentException e) {
            throw AuthFailure.invalid();
        }
    }

    private Map<String, Object> replay(
            Accounts.Account account, UUID id, byte[] fingerprint, Map<String, Object> row) {
        if (((Number) row.get("UserId")).intValue() != account.id()
                || !"SETUP".equals(row.get("Kind"))) throw AuthFailure.denied();
        if (!Secrets.equal(fingerprint, (byte[]) row.get("PackageFingerprint")))
            throw new AuthFailure(
                    409,
                    "OPERATION_PAYLOAD_CONFLICT",
                    "This operation already has a different package.");
        return status(id, account);
    }

    private Map<String, Object> status(UUID id, Accounts.Account account) {
        var row =
                Rows.query(db, "SELECT * FROM keyvault.Operations WHERE OperationId=?", id)
                        .getFirst();
        var result = new LinkedHashMap<String, Object>();
        result.put("operationId", id.toString());
        result.put("kind", "SETUP");
        result.put("state", row.get("State"));
        result.put("expiresAt", ((OffsetDateTime) row.get("ExpiresAt")).toInstant().toString());
        result.put(
                "baseVersions",
                new AuthDtos.Versions("" + row.get("CredentialVersion"), "0", "0", "0"));
        if (row.get("State").equals("COMPLETED")) result.put("resultVersions", account.versions());
        return result;
    }
}
