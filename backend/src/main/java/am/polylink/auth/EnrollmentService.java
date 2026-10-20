package am.polylink.auth;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class EnrollmentService {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private final Secrets secrets;
    private final PasswordEncoder encoder;
    private final Challenges challenges;
    private final RateLimiter limits;
    private final Clock clock;
    private final String dummyVerifier;

    public EnrollmentService(
            JdbcTemplate db,
            Accounts accounts,
            TransactionTemplate tx,
            Secrets secrets,
            PasswordEncoder encoder,
            Challenges challenges,
            RateLimiter limits,
            Clock clock) {
        this.db = db;
        this.accounts = accounts;
        this.tx = tx;
        this.secrets = secrets;
        this.encoder = encoder;
        this.challenges = challenges;
        this.limits = limits;
        this.clock = clock;
        this.dummyVerifier = encoder.encode(secrets.token());
    }

    public AuthDtos.Derivation parameters(String email, String ip) {
        limits.consume("PARAM_IP", ip, 100, 60);
        String normalized = Accounts.email(email);
        var account = accounts.find(normalized);
        return account.map(
                        a ->
                                new AuthDtos.Derivation(
                                        "PLK1", Secrets.encode(a.salt()), a.ops(), a.memory()))
                .orElseGet(
                        () ->
                                new AuthDtos.Derivation(
                                        "PLK1",
                                        Secrets.encode(
                                                Arrays.copyOf(
                                                        secrets.mac("dummy-salt", normalized), 16)),
                                        2,
                                        67108864));
    }

    public Challenges.Created register(AuthDtos.Registration request, String ip, String browser) {
        String email = Accounts.email(request.email());
        limits.issue(email, ip);
        Secrets.decode(request.loginSecret(), 32);
        byte[] salt = Secrets.decode(request.derivation().salt(), 16);
        String verifier = encoder.encode(request.loginSecret());
        var created =
                tx.execute(
                        status -> {
                            var now = OffsetDateTime.now(clock);
                            var invitations =
                                    Rows.query(
                                            db,
                                            "SELECT * FROM auth.Invitations WITH(UPDLOCK,HOLDLOCK) WHERE Email=? AND ConsumedUserId IS NULL AND RevokedAt IS NULL AND ExpiresAt>?",
                                            email,
                                            now);
                            if (invitations.isEmpty()
                                    || !request.role()
                                            .equals(invitations.getFirst().get("RoleCode")))
                                return challenges.create(null, "EMAIL_VERIFY", 1, "", browser);
                            var existing = accounts.find(email);
                            if (existing.isPresent()
                                    && !existing.get().admission().equals("PENDING"))
                                return challenges.create(null, "EMAIL_VERIFY", 1, "", browser);
                            var users =
                                    db.queryForList(
                                            "SELECT UserId FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE Email=?",
                                            Integer.class,
                                            email);
                            int role =
                                    db.queryForObject(
                                            "SELECT RoleId FROM dbo.Roles WHERE Name=?",
                                            Integer.class,
                                            request.role());
                            int user;
                            if (users.isEmpty()) {
                                int language =
                                        db.queryForObject(
                                                "SELECT Id FROM dbo.Languages WHERE Code=N'en'",
                                                Integer.class);
                                user =
                                        db.queryForObject(
                                                "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId) OUTPUT inserted.UserId VALUES (?,?,?,?,?)",
                                                Integer.class,
                                                request.firstName().strip(),
                                                request.lastName().strip(),
                                                email,
                                                role,
                                                language);
                            } else {
                                user = users.getFirst();
                            }
                            long version = existing.map(a -> a.credential() + 1).orElse(1L);
                            if (existing.isPresent())
                                db.update(
                                        "UPDATE auth.AccountSecurity SET CredentialVersion=?,ClientSalt=?,ClientOpsLimit=?,ClientMemoryBytes=?,LoginVerifier=?,UpdatedAt=? WHERE UserId=?",
                                        version,
                                        salt,
                                        request.derivation().opsLimit(),
                                        request.derivation().memoryBytes(),
                                        verifier,
                                        now,
                                        user);
                            else
                                db.update(
                                        "INSERT auth.AccountSecurity(UserId,AdmissionStatus,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled) VALUES (?,'PENDING',1,1,?,?,?,?,0)",
                                        user,
                                        salt,
                                        request.derivation().opsLimit(),
                                        request.derivation().memoryBytes(),
                                        verifier);
                            db.update("DELETE auth.PendingEnrollments WHERE UserId=?", user);
                            db.update(
                                    "INSERT auth.PendingEnrollments(UserId,InvitationId,CredentialVersion,FirstName,LastName,RoleCode) VALUES (?,?,?,?,?,?)",
                                    user,
                                    invitations.getFirst().get("InvitationId"),
                                    version,
                                    request.firstName().strip(),
                                    request.lastName().strip(),
                                    request.role());
                            return challenges.create(user, "EMAIL_VERIFY", version, email, browser);
                        });
        challenges.deliver(created);
        return created;
    }

    public void verifyEmail(AuthDtos.CodeProof proof, String browser, String ip) {
        var account = challenges.verify(proof, "EMAIL_VERIFY", browser, ip);
        tx.executeWithoutResult(
                status -> {
                    var now = OffsetDateTime.now(clock);
                    var grants =
                            db.queryForList(
                                    "SELECT InvitationId FROM auth.Invitations WITH(UPDLOCK,HOLDLOCK) WHERE Email=? AND ConsumedUserId IS NULL AND RevokedAt IS NULL AND ExpiresAt>? AND RoleCode=?",
                                    String.class,
                                    account.email(),
                                    now,
                                    account.role());
                    if (grants.isEmpty()) throw AuthFailure.denied();
                    var current = accounts.lock(account.id());
                    if (current.credential() != account.credential()
                            || !current.admission().equals("PENDING")) throw AuthFailure.conflict();
                    var pending =
                            Rows.query(
                                    db,
                                    "SELECT * FROM auth.PendingEnrollments WHERE UserId=? AND CredentialVersion=? AND InvitationId=?",
                                    account.id(),
                                    account.credential(),
                                    grants.getFirst());
                    if (pending.isEmpty()) throw AuthFailure.denied();
                    var enrollment = pending.getFirst();
                    int role =
                            db.queryForObject(
                                    "SELECT RoleId FROM dbo.Roles WHERE Name=?",
                                    Integer.class,
                                    enrollment.get("RoleCode"));
                    db.update(
                            "UPDATE dbo.Users SET FirstName=?,LastName=?,RoleId=? WHERE UserId=?",
                            enrollment.get("FirstName"),
                            enrollment.get("LastName"),
                            role,
                            account.id());
                    db.update("DELETE auth.PendingEnrollments WHERE UserId=?", account.id());
                    db.update(
                            "UPDATE auth.AccountSecurity SET EmailVerifiedAt=?,AdmissionStatus='ADMITTED',UpdatedAt=? WHERE UserId=?",
                            now,
                            now,
                            account.id());
                    db.update(
                            "UPDATE auth.Invitations SET ConsumedUserId=? WHERE InvitationId=?",
                            account.id(),
                            grants.getFirst());
                });
    }

    public Accounts.Account password(AuthDtos.Login request, String ip) {
        String email = Accounts.email(request.email());
        limits.consume("LOGIN_ACCOUNT", email, 10, 900);
        limits.consume("LOGIN_IP", ip, 50, 900);
        Secrets.decode(request.loginSecret(), 32);
        var account = accounts.find(email);
        boolean valid =
                encoder.matches(
                        request.loginSecret(),
                        account.map(Accounts.Account::verifier).orElse(dummyVerifier));
        if (!valid || account.isEmpty()) throw AuthFailure.denied();
        account.get().requireAdmitted();
        return account.get();
    }
}
