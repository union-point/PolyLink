package am.polylink.recovery;

import am.polylink.auth.*;
import am.polylink.keyvault.*;
import jakarta.servlet.http.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Account lock always precedes operation locks. No Transit or verifier hashing under SQL locks. */
@Service
@IdentityEnabled
public class RecoveryService {
    public static final String COOKIE = "__Host-plk-recovery", CSRF = "__Host-plk-recovery-csrf";
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final Sessions sessions;
    private final Challenges challenges;
    private final RateLimiter limits;
    private final Secrets secrets;
    private final TransitClient transit;
    private final KeyVaultService vaults;
    private final PasswordEncoder encoder;
    private final TransactionTemplate tx;
    private final JsonMapper mapper;
    private final Clock clock;
    private final EnrollmentService enrollment;
    private final EnrollmentSessions enrollmentSessions;

    public RecoveryService(
            JdbcTemplate db,
            Accounts accounts,
            Sessions sessions,
            Challenges challenges,
            RateLimiter limits,
            Secrets secrets,
            TransitClient transit,
            KeyVaultService vaults,
            PasswordEncoder encoder,
            TransactionTemplate tx,
            JsonMapper mapper,
            Clock clock,
            EnrollmentService enrollment,
            EnrollmentSessions enrollmentSessions) {
        this.db = db;
        this.accounts = accounts;
        this.sessions = sessions;
        this.challenges = challenges;
        this.limits = limits;
        this.secrets = secrets;
        this.transit = transit;
        this.vaults = vaults;
        this.encoder = encoder;
        this.tx = tx;
        this.mapper = mapper;
        this.clock = clock;
        this.enrollment = enrollment;
        this.enrollmentSessions = enrollmentSessions;
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private AuthDtos.Versions base(Map<String, Object> row) {
        return new AuthDtos.Versions(
                row.get("CredentialVersion").toString(),
                row.get("VaultKeyVersion").toString(),
                row.get("VaultRevision").toString(),
                row.get("IdentityVersion").toString());
    }

    private UUID id(Map<String, Object> row) {
        return UUID.fromString(row.get("OperationId").toString());
    }

    private int user(Map<String, Object> row) {
        return ((Number) row.get("UserId")).intValue();
    }

    private Map<String, Object> row(UUID id) {
        var rows =
                Rows.query(
                        db,
                        "SELECT o.*,r.VerifiedEmail,r.LoginHandoffUsed,r.CsrfHash FROM keyvault.Operations o JOIN auth.RecoveryAuthorizations r ON r.OperationId=o.OperationId WHERE o.OperationId=?",
                        id);
        if (rows.isEmpty()) throw AuthFailure.denied();
        return rows.getFirst();
    }

    private Map<String, Object> capability(HttpServletRequest request, boolean mutation) {
        String token = Sessions.cookie(request, COOKIE);
        if (token.isEmpty()) throw AuthFailure.denied();
        Secrets.decode(token, 32);
        var rows =
                Rows.query(
                        db,
                        "SELECT OperationId FROM auth.RecoveryAuthorizations WHERE TokenHash=?",
                        Secrets.hash(token));
        if (rows.isEmpty()) throw AuthFailure.denied();
        var row = row(UUID.fromString(rows.getFirst().get("OperationId").toString()));
        if (!((OffsetDateTime) row.get("ExpiresAt")).isAfter(now())) throw AuthFailure.denied();
        if (mutation) {
            String csrf = Sessions.cookie(request, CSRF);
            if (csrf.isEmpty()
                    || !csrf.equals(request.getHeader("X-CSRF-Token"))
                    || !Secrets.equal(Secrets.hash(csrf), (byte[]) row.get("CsrfHash")))
                throw new AuthFailure(403, "FORBIDDEN", "Recovery authorization is required.");
        }
        return row;
    }

    private Accounts.Account active(Map<String, Object> row) {
        var account = accounts.get(user(row));
        account.requireAdmitted();
        if (!account.email().equals(row.get("VerifiedEmail"))
                || !account.versions().equals(base(row))
                || Set.of("COMPLETED", "CANCELLED", "EXPIRED").contains(row.get("State"))
                || !((OffsetDateTime) row.get("ExpiresAt")).isAfter(now()))
            throw AuthFailure.conflict();
        return account;
    }

    private Map<String, Object> status(Map<String, Object> row) {
        var value = new LinkedHashMap<String, Object>();
        value.put("operationId", id(row).toString());
        value.put("kind", row.get("Kind"));
        value.put("state", row.get("State"));
        value.put("expiresAt", row.get("ExpiresAt").toString());
        value.put("baseVersions", base(row));
        // Needed to resume without persisting secrets or trusting browser account selection.
        value.put("userId", "" + user(row));
        value.put("email", row.get("VerifiedEmail"));
        value.put("packagePrepared", row.get("PackageFingerprint") != null);
        if ("COMPLETED".equals(row.get("State")))
            value.put("resultVersions", mapper.readTree((byte[]) row.get("CompletionResult")));
        return value;
    }

    public Map<String, Object> request(String email, String ip, HttpServletResponse response) {
        email = Accounts.email(email);
        limits.issue(email, ip);
        enrollment.expireEmail(email);
        var account =
                accounts.find(email)
                        .filter(
                                a ->
                                        ("PENDING".equals(a.admission())
                                                || (a.verified()
                                                        && "ADMITTED".equals(a.admission())
                                                        && a.vaultKey() > 0)))
                        .orElse(null);
        String browser = secrets.token();
        var challenge =
                challenges.create(
                        account == null ? null : account.id(),
                        "RECOVERY",
                        account == null ? 1 : account.credential(),
                        email,
                        browser);
        challenges.deliver(challenge);
        Sessions.cookie(response, Sessions.CHALLENGE, browser, true, 600);
        return challenge.response();
    }

    public Map<String, Object> verify(
            AuthDtos.CodeProof proof, HttpServletRequest request, HttpServletResponse response) {
        var proven =
                challenges.verify(
                        proof,
                        "RECOVERY",
                        Sessions.cookie(request, Sessions.CHALLENGE),
                        request.getRemoteAddr());
        if (proven.admission().equals("PENDING")) {
            sessions.clear(response);
            enrollmentSessions.issue(proven.id(), proven.credential(), response);
            return Map.of("status", "enrollment");
        }
        EnrollmentSessions.clear(response);
        String token = secrets.token(), csrf = secrets.token();
        UUID operation = UUID.randomUUID();
        var result =
                tx.execute(
                        t -> {
                            var account = accounts.lock(proven.id());
                            account.requireAdmitted();
                            if (!account.versions().equals(proven.versions())
                                    || !account.email().equals(proven.email())
                                    || account.vaultKey() == 0) throw AuthFailure.conflict();
                            db.update(
                                    "UPDATE keyvault.Operations SET State='CANCELLED',PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE UserId=? AND Kind IN ('RECOVERY_LOCAL','RECOVERY_SERVICE') AND State NOT IN ('COMPLETED','CANCELLED','EXPIRED')",
                                    account.id());
                            db.update(
                                    "INSERT keyvault.Operations(OperationId,UserId,Kind,State,CredentialVersion,VaultKeyVersion,VaultRevision,IdentityVersion,AuthorizationHash,ExpiresAt) VALUES (?,?,'RECOVERY_LOCAL','VERIFIED',?,?,?,?,?,?)",
                                    operation,
                                    account.id(),
                                    account.credential(),
                                    account.vaultKey(),
                                    account.vaultRevision(),
                                    account.identity(),
                                    Secrets.hash(token),
                                    now().plusMinutes(30));
                            db.update(
                                    "INSERT auth.RecoveryAuthorizations(OperationId,TokenHash,CsrfHash,VerifiedEmail) VALUES (?,?,?,?)",
                                    operation,
                                    Secrets.hash(token),
                                    Secrets.hash(csrf),
                                    account.email());
                            return Map.<String, Object>of("operation", status(row(operation)));
                        });
        Sessions.cookie(response, COOKIE, token, true, 1800);
        Sessions.cookie(response, CSRF, csrf, false, 1800);
        return result;
    }

    public Map<String, Object> status(HttpServletRequest request) {
        if (!Sessions.cookie(request, EnrollmentSessions.COOKIE).isEmpty()) {
            var pending = enrollment.state(request);
            return Map.of("state", "ENROLLMENT", "email", pending.get("email"));
        }
        return status(capability(request, false));
    }

    public Map<String, Object> unlock(AuthDtos.OperationId input, HttpServletRequest request) {
        var initial = capability(request, true);
        if (!id(initial).equals(input.operationId())) throw AuthFailure.denied();
        limits.consume("RECOVERY_UNLOCK", "" + user(initial), 20, 1800);
        var selected =
                tx.execute(
                        t -> {
                            accounts.lock(user(initial));
                            var row = capability(request, true);
                            var account = active(row);
                            if (!Set.of("VERIFIED", "WAITING_SERVICE").contains(row.get("State"))
                                    || row.get("PackageFingerprint") != null)
                                throw AuthFailure.conflict();
                            db.update(
                                    "UPDATE keyvault.Operations SET Kind='RECOVERY_SERVICE',State='WAITING_SERVICE' WHERE OperationId=?",
                                    id(row));
                            return Rows.query(
                                            db,
                                            "SELECT * FROM keyvault.Vaults WHERE UserId=?",
                                            account.id())
                                    .getFirst();
                        });
        byte[] key =
                transit.unwrap(
                        user(initial),
                        Long.parseLong(base(initial).vaultKey()),
                        selected.get("ServiceCopy").toString(),
                        selected.get("TransitContext").toString());
        try {
            return tx.execute(
                    t -> {
                        accounts.lock(user(initial));
                        var row = capability(request, true);
                        var account = active(row);
                        if (!"WAITING_SERVICE".equals(row.get("State"))
                                || row.get("PackageFingerprint") != null)
                            throw AuthFailure.conflict();
                        return Map.of(
                                "operationId",
                                id(row).toString(),
                                "vaultKey",
                                Secrets.encode(key),
                                "bundle",
                                vaults.own(account));
                    });
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    private void validate(
            Accounts.Account account,
            Map<String, Object> row,
            AuthDtos.Recovery input,
            HttpServletRequest request) {
        if (!id(row).equals(input.operationId())
                || !base(row).equals(input.expected())
                || !row.get("Kind").equals(input.kind())) throw AuthFailure.conflict();
        Secrets.decode(input.loginSecret(), 32);
        Secrets.decode(input.passwordCopy().ciphertext(), 48);
        Secrets.decode(input.passwordCopy().nonce(), 24);
        Secrets.decode(input.vault().nonce(), 24);
        Secrets.decode(input.identity().publicKey(), 32);
        if (Secrets.equal(account.salt(), Secrets.decode(input.derivation().salt(), 16))
                || !input.identity().userId().equals("" + account.id()))
            throw AuthFailure.invalid();
        var bundle = vaults.own(account);
        if (input.kind().equals("RECOVERY_LOCAL")) {
            var caller = sessions.require(request);
            sessions.requireCurrent(caller);
            if (caller.account().id() != account.id()
                    || input.serviceVaultKey() != null
                    || !mapper.valueToTree(bundle.get("vault"))
                            .equals(mapper.valueToTree(input.vault()))
                    || !mapper.valueToTree(bundle.get("identity"))
                            .equals(mapper.valueToTree(input.identity())))
                throw AuthFailure.denied();
        } else {
            Secrets.decode(input.serviceVaultKey(), 32);
            if (!input.identity().version().equals("" + Math.addExact(account.identity(), 1))
                    || input.identity()
                            .publicKey()
                            .equals(((AuthDtos.Identity) bundle.get("identity")).publicKey())
                    || mapper.valueToTree(bundle.get("vault"))
                            .equals(mapper.valueToTree(input.vault()))) throw AuthFailure.invalid();
        }
    }

    public Map<String, Object> prepare(AuthDtos.Recovery input, HttpServletRequest request) {
        var initial = capability(request, true);
        limits.consume("RECOVERY_PREP", "" + user(initial), 20, 1800);
        byte[] fingerprint = Secrets.digest(mapper.writeValueAsBytes(input));
        boolean ready =
                tx.execute(
                        t -> {
                            accounts.lock(user(initial));
                            var row = capability(request, true);
                            var account = active(row);
                            validate(account, row, input, request);
                            if (row.get("PackageFingerprint") != null
                                    && !Secrets.equal(
                                            fingerprint, (byte[]) row.get("PackageFingerprint")))
                                throw new AuthFailure(
                                        409,
                                        "OPERATION_PAYLOAD_CONFLICT",
                                        "This operation already has a different package.");
                            if ("READY".equals(row.get("State"))) return true;
                            db.update(
                                    "UPDATE keyvault.Operations SET State='PREPARING',PackageFingerprint=? WHERE OperationId=?",
                                    fingerprint,
                                    id(row));
                            return false;
                        });
        if (ready) return status(capability(request, false));
        String verifier = encoder.encode(input.loginSecret());
        var prepared = new LinkedHashMap<String, Object>();
        prepared.put("derivation", input.derivation());
        prepared.put("vault", input.vault());
        prepared.put("passwordCopy", input.passwordCopy());
        prepared.put("identity", input.identity());
        if (input.kind().equals("RECOVERY_SERVICE")) {
            byte[] key = Secrets.decode(input.serviceVaultKey(), 32);
            try {
                var wrapped =
                        transit.wrap(
                                user(initial),
                                Math.addExact(Long.parseLong(base(initial).vaultKey()), 1),
                                key);
                prepared.put("serviceCopy", wrapped.ciphertext());
                prepared.put("context", wrapped.context());
            } catch (AuthFailure failure) {
                tx.execute(
                        t -> {
                            accounts.lock(user(initial));
                            var row = capability(request, true);
                            active(row);
                            db.update(
                                    "UPDATE keyvault.Operations SET State='WAITING_SERVICE' WHERE OperationId=? AND State='PREPARING'",
                                    id(row));
                            return null;
                        });
                throw failure;
            } finally {
                Arrays.fill(key, (byte) 0);
            }
        }
        return tx.execute(
                t -> {
                    accounts.lock(user(initial));
                    var row = capability(request, true);
                    active(row);
                    if (!Secrets.equal(fingerprint, (byte[]) row.get("PackageFingerprint")))
                        throw AuthFailure.conflict();
                    if (!"READY".equals(row.get("State")))
                        db.update(
                                "UPDATE keyvault.Operations SET State='READY',PreparedCiphertext=?,PreparedLoginVerifier=? WHERE OperationId=?",
                                mapper.writeValueAsBytes(prepared),
                                verifier,
                                id(row));
                    return status(row(id(row)));
                });
    }

    public Map<String, Object> commit(AuthDtos.OperationId input, HttpServletRequest request) {
        var initial = capability(request, true);
        if (!id(initial).equals(input.operationId())) throw AuthFailure.denied();
        return tx.execute(
                t -> {
                    var account = accounts.lock(user(initial));
                    var row = capability(request, true);
                    if ("COMPLETED".equals(row.get("State"))) return status(row);
                    active(row);
                    if (!"READY".equals(row.get("State"))) throw AuthFailure.conflict();
                    var data = mapper.readTree((byte[]) row.get("PreparedCiphertext"));
                    var params = data.path("derivation");
                    long credential = Math.addExact(account.credential(), 1);
                    db.update(
                            "UPDATE auth.AccountSecurity SET CredentialVersion=?,ClientSalt=?,ClientOpsLimit=?,ClientMemoryBytes=?,LoginVerifier=?,UpdatedAt=? WHERE UserId=?",
                            credential,
                            Secrets.decode(params.path("salt").asText(), 16),
                            params.path("opsLimit").asInt(),
                            params.path("memoryBytes").asLong(),
                            row.get("PreparedLoginVerifier"),
                            now(),
                            account.id());
                    if ("RECOVERY_SERVICE".equals(row.get("Kind"))) {
                        long identity = Math.addExact(account.identity(), 1);
                        db.update(
                                "INSERT keyvault.Identities(UserId,IdentityVersion,PublicKey,CreatedAt) VALUES (?,?,?,?)",
                                account.id(),
                                identity,
                                Secrets.decode(
                                        data.path("identity").path("publicKey").asText(), 32),
                                now());
                        db.update(
                                "UPDATE keyvault.Vaults SET VaultKeyVersion=?,VaultRevision=?,IdentityVersion=?,VaultPacket=?,ServiceCopy=?,TransitContext=? WHERE UserId=?",
                                Math.addExact(account.vaultKey(), 1),
                                Math.addExact(account.vaultRevision(), 1),
                                identity,
                                mapper.writeValueAsBytes(data.path("vault")),
                                data.path("serviceCopy").asText(),
                                data.path("context").asText(),
                                account.id());
                    }
                    db.update(
                            "UPDATE keyvault.Vaults SET PasswordCopy=? WHERE UserId=?",
                            mapper.writeValueAsBytes(data.path("passwordCopy")),
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
                            id(row));
                    db.update(
                            "UPDATE keyvault.Operations SET State='COMPLETED',CompletionResult=?,CompletedAt=?,PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE OperationId=?",
                            mapper.writeValueAsBytes(accounts.get(account.id()).versions()),
                            now(),
                            id(row));
                    return status(row(id(row)));
                });
    }

    public Sessions.Issued login(AuthDtos.Login input, HttpServletRequest request) {
        var initial = capability(request, true);
        limits.consume("RECOVERY_LOGIN", "" + user(initial), 10, 1800);
        limits.consume("RECOVERY_IP", request.getRemoteAddr(), 50, 1800);
        var account = accounts.get(user(initial));
        if (!account.email().equals(Accounts.email(input.email()))
                || !encoder.matches(input.loginSecret(), account.verifier()))
            throw AuthFailure.denied();
        return tx.execute(
                t -> {
                    var current = accounts.lock(account.id());
                    current.requireAdmitted();
                    var row = capability(request, true);
                    if (!"COMPLETED".equals(row.get("State"))
                            || Boolean.TRUE.equals(row.get("LoginHandoffUsed"))
                            || !current.email().equals(row.get("VerifiedEmail"))
                            || !current.versions()
                                    .equals(
                                            mapper.readValue(
                                                    (byte[]) row.get("CompletionResult"),
                                                    AuthDtos.Versions.class))
                            || !current.verifier().equals(account.verifier()))
                        throw AuthFailure.denied();
                    db.update(
                            "UPDATE auth.RecoveryAuthorizations SET LoginHandoffUsed=1 WHERE OperationId=?",
                            id(row));
                    return sessions.create(current.id(), current.credential(), true);
                });
    }
}
