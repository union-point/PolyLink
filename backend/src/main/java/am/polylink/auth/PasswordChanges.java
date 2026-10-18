package am.polylink.auth;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
@IdentityEnabled
public class PasswordChanges {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final Sessions sessions;
    private final TransactionTemplate tx;
    private final PasswordEncoder encoder;
    private final JsonMapper mapper;
    private final Clock clock;

    public PasswordChanges(
            JdbcTemplate db,
            Accounts accounts,
            Sessions sessions,
            TransactionTemplate tx,
            PasswordEncoder encoder,
            JsonMapper mapper,
            Clock clock) {
        this.db = db;
        this.accounts = accounts;
        this.sessions = sessions;
        this.tx = tx;
        this.encoder = encoder;
        this.mapper = mapper;
        this.clock = clock;
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private byte[] authorization(Sessions.Principal caller) {
        return Secrets.hash("PASSWORD_CHANGE:" + caller.familyId());
    }

    private Map<String, Object> operation(UUID id) {
        var rows = Rows.query(db, "SELECT * FROM keyvault.Operations WHERE OperationId=?", id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private void owner(Sessions.Principal caller, Map<String, Object> row) {
        if (row == null
                || !"PASSWORD_CHANGE".equals(row.get("Kind"))
                || ((Number) row.get("UserId")).intValue() != caller.account().id())
            throw AuthFailure.denied();
    }

    private Map<String, Object> status(UUID id, Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("operationId", id.toString());
        result.put("kind", "PASSWORD_CHANGE");
        result.put("state", row.get("State"));
        result.put("expiresAt", row.get("ExpiresAt").toString());
        result.put(
                "baseVersions",
                new AuthDtos.Versions(
                        row.get("CredentialVersion").toString(),
                        row.get("VaultKeyVersion").toString(),
                        row.get("VaultRevision").toString(),
                        row.get("IdentityVersion").toString()));
        if ("COMPLETED".equals(row.get("State")))
            result.put("resultVersions", mapper.readTree((byte[]) row.get("CompletionResult")));
        return result;
    }

    private void current(Accounts.Account account, AuthDtos.PasswordChange request) {
        account.requireAdmitted();
        if (account.vaultKey() == 0 || !account.versions().equals(request.expected()))
            throw AuthFailure.conflict();
        var vault =
                Rows.query(
                                db,
                                "SELECT v.*,i.PublicKey FROM keyvault.Vaults v JOIN keyvault.Identities i ON i.UserId=v.UserId AND i.IdentityVersion=v.IdentityVersion WHERE v.UserId=?",
                                account.id())
                        .getFirst();
        if (!request.identity().userId().equals("" + account.id())
                || !request.identity().version().equals("" + account.identity())
                || !Secrets.equal(
                        Secrets.decode(request.identity().publicKey(), 32),
                        (byte[]) vault.get("PublicKey"))
                || !mapper.valueToTree(request.vault())
                        .equals(mapper.readTree((byte[]) vault.get("VaultPacket"))))
            throw AuthFailure.conflict();
        if (Secrets.equal(Secrets.decode(request.derivation().salt(), 16), account.salt()))
            throw AuthFailure.invalid();
        Secrets.decode(request.loginSecret(), 32);
        Secrets.decode(request.passwordCopy().nonce(), 24);
        Secrets.decode(request.passwordCopy().ciphertext(), 48);
    }

    private Map<String, Object> replay(
            Sessions.Principal caller,
            AuthDtos.PasswordChange request,
            byte[] fingerprint,
            Map<String, Object> row) {
        owner(caller, row);
        if (!Secrets.equal(authorization(caller), (byte[]) row.get("AuthorizationHash")))
            throw AuthFailure.denied();
        if (!Secrets.equal(fingerprint, (byte[]) row.get("PackageFingerprint")))
            throw new AuthFailure(
                    409,
                    "OPERATION_PAYLOAD_CONFLICT",
                    "This operation already has a different package.");
        if (!"READY".equals(row.get("State"))
                || !((OffsetDateTime) row.get("ExpiresAt")).isAfter(now()))
            throw AuthFailure.conflict();
        return status(request.operationId(), row);
    }

    public Map<String, Object> prepare(Sessions.Principal caller, AuthDtos.PasswordChange request) {
        byte[] fingerprint = Secrets.digest(mapper.writeValueAsBytes(request));
        var old = operation(request.operationId());
        if (old != null) return replay(caller, request, fingerprint, old);
        current(caller.account(), request);
        // Slow password hashing is outside SQL locks. Recheck every base version after it.
        String verifier = encoder.encode(request.loginSecret());
        return tx.execute(
                status -> {
                    var account = accounts.lock(caller.account().id());
                    sessions.requireCurrent(caller);
                    var existing = operation(request.operationId());
                    if (existing != null) return replay(caller, request, fingerprint, existing);
                    current(account, request);
                    db.update(
                            "INSERT keyvault.Operations(OperationId,UserId,Kind,State,CredentialVersion,VaultKeyVersion,VaultRevision,IdentityVersion,AuthorizationHash,PackageFingerprint,PreparedCiphertext,PreparedLoginVerifier,ExpiresAt) VALUES (?,?,'PASSWORD_CHANGE','READY',?,?,?,?,?,?,?,?,?)",
                            request.operationId(),
                            account.id(),
                            account.credential(),
                            account.vaultKey(),
                            account.vaultRevision(),
                            account.identity(),
                            authorization(caller),
                            fingerprint,
                            mapper.writeValueAsBytes(
                                    Map.of(
                                            "derivation",
                                            request.derivation(),
                                            "passwordCopy",
                                            request.passwordCopy())),
                            verifier,
                            now().plusMinutes(15));
                    return status(request.operationId(), operation(request.operationId()));
                });
    }

    public Map<String, Object> completed(Sessions.Principal caller, UUID id) {
        var row = operation(id);
        owner(caller, row);
        if (!"COMPLETED".equals(row.get("State"))
                || !Secrets.equal(authorization(caller), (byte[]) row.get("AuthorizationHash"))
                || !((OffsetDateTime) row.get("ExpiresAt")).isAfter(now()))
            throw AuthFailure.denied();
        return status(id, row);
    }

    public Map<String, Object> commit(Sessions.Principal caller, UUID id) {
        return tx.execute(
                status -> {
                    var account = accounts.lock(caller.account().id());
                    sessions.requireCurrent(caller);
                    var row = operation(id);
                    owner(caller, row);
                    if ("COMPLETED".equals(row.get("State"))) return status(id, row);
                    if (!Secrets.equal(
                            authorization(caller), (byte[]) row.get("AuthorizationHash")))
                        throw AuthFailure.denied();
                    if (!"READY".equals(row.get("State"))
                            || !((OffsetDateTime) row.get("ExpiresAt")).isAfter(now())
                            || account.credential()
                                    != ((Number) row.get("CredentialVersion")).longValue()
                            || account.vaultKey()
                                    != ((Number) row.get("VaultKeyVersion")).longValue()
                            || account.vaultRevision()
                                    != ((Number) row.get("VaultRevision")).longValue()
                            || account.identity()
                                    != ((Number) row.get("IdentityVersion")).longValue())
                        throw AuthFailure.conflict();
                    var prepared = mapper.readTree((byte[]) row.get("PreparedCiphertext"));
                    var params = prepared.path("derivation");
                    long version = Math.addExact(account.credential(), 1);
                    db.update(
                            "UPDATE auth.AccountSecurity SET CredentialVersion=?,ClientSalt=?,ClientOpsLimit=?,ClientMemoryBytes=?,LoginVerifier=?,UpdatedAt=? WHERE UserId=?",
                            version,
                            Secrets.decode(params.path("salt").asText(), 16),
                            params.path("opsLimit").asInt(),
                            params.path("memoryBytes").asLong(),
                            row.get("PreparedLoginVerifier"),
                            now(),
                            account.id());
                    db.update(
                            "UPDATE keyvault.Vaults SET PasswordCopy=? WHERE UserId=?",
                            mapper.writeValueAsBytes(prepared.path("passwordCopy")),
                            account.id());
                    db.update(
                            "UPDATE auth.Sessions SET RevokedAt=?,ReplayPacket=NULL WHERE UserId=? AND RevokedAt IS NULL",
                            now(),
                            account.id());
                    db.update(
                            "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND ConsumedAt IS NULL",
                            now(),
                            account.id());
                    db.update(
                            "UPDATE keyvault.Operations SET State='CANCELLED',PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE UserId=? AND OperationId<>? AND State NOT IN ('COMPLETED','CANCELLED','EXPIRED')",
                            account.id(),
                            id);
                    db.update(
                            "UPDATE keyvault.Operations SET State='COMPLETED',CompletedAt=?,CompletionResult=?,PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE OperationId=?",
                            now(),
                            mapper.writeValueAsBytes(accounts.get(account.id()).versions()),
                            id);
                    return status(id, operation(id));
                });
    }
}
