package am.polylink.settings;

import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class AccountSettings {
    public record Proof(String loginSecret, String expectedCredential) {}

    public record Start(String email, String loginSecret, String expectedCredential) {}

    public record Factor(Boolean enabled, String loginSecret, String expectedCredential) {}

    public record Code(UUID requestId, String code) {}

    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private final PasswordEncoder encoder;
    private final Secrets secrets;
    private final RateLimiter limits;
    private final MailDelivery mail;
    private final Clock clock;

    public AccountSettings(
            JdbcTemplate db,
            Accounts accounts,
            TransactionTemplate tx,
            PasswordEncoder encoder,
            Secrets secrets,
            RateLimiter limits,
            MailDelivery mail,
            Clock clock) {
        this.db = db;
        this.accounts = accounts;
        this.tx = tx;
        this.encoder = encoder;
        this.secrets = secrets;
        this.limits = limits;
        this.mail = mail;
        this.clock = clock;
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private Accounts.Account proof(Sessions.Principal caller, String secret, String version) {
        var a = accounts.lock(caller.account().id());
        a.requireAdmitted();
        if (!Long.toString(a.credential()).equals(version)) throw AuthFailure.conflict();
        Secrets.decode(secret, 32);
        if (!encoder.matches(secret, a.verifier())) throw AuthFailure.denied();
        return a;
    }

    public Map<String, Object> factor(Sessions.Principal caller, Factor input) {
        if (input.enabled() == null) throw AuthFailure.invalid();
        limits.consume("SETTING_PROOF", "" + caller.account().id(), 10, 3600);
        return tx.execute(
                s -> {
                    var a = proof(caller, input.loginSecret(), input.expectedCredential());
                    db.update(
                            "UPDATE auth.AccountSecurity SET EmailFactorEnabled=?,UpdatedAt=? WHERE UserId=?",
                            input.enabled(),
                            now(),
                            a.id());
                    db.update("DELETE auth.EmailChanges WHERE UserId=?", a.id());
                    db.update(
                            "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND ConsumedAt IS NULL AND Purpose='LOGIN'",
                            now(),
                            a.id());
                    return Map.of("twoFactorEnabled", input.enabled());
                });
    }

    private Map<String, Object> response(Map<String, Object> r) {
        return Map.of(
                "status",
                "challenge",
                "requestId",
                r.get("RequestId").toString(),
                "stage",
                r.get("Stage"),
                "expiresAt",
                r.get("ExpiresAt").toString(),
                "resendAfter",
                r.get("ResendAfter").toString());
    }

    private byte[] mac(UUID id, String stage, String code) {
        return secrets.mac("email-change", id + ":" + stage + ":" + code);
    }

    private Map<String, Object> row(int id) {
        return Rows.query(db, "SELECT * FROM auth.EmailChanges WHERE UserId=?", id).getFirst();
    }

    private void deliver(Map<String, Object> r, String code, String ip) {
        limits.issue((String) r.get(r.get("Stage").equals("OLD") ? "OldEmail" : "NewEmail"), ip);
        mail.sendCode(
                (String) r.get(r.get("Stage").equals("OLD") ? "OldEmail" : "NewEmail"),
                "EMAIL_CHANGE",
                code);
    }

    public Map<String, Object> start(Sessions.Principal caller, Start input, String ip) {
        if (input.email() == null
                || input.email().length() > 255
                || !input.email().matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))
            throw AuthFailure.invalid();
        limits.consume("SETTING_PROOF", "" + caller.account().id(), 10, 3600);
        String code = secrets.code();
        var r =
                tx.execute(
                        s -> {
                            var a = proof(caller, input.loginSecret(), input.expectedCredential());
                            String email = Accounts.email(input.email());
                            if (email.equals(a.email()) || accounts.find(email).isPresent())
                                throw new AuthFailure(
                                        409, "EMAIL_UNAVAILABLE", "This email cannot be used.");
                            db.update("DELETE auth.EmailChanges WHERE UserId=?", a.id());
                            UUID id = UUID.randomUUID();
                            String stage = a.emailFactor() ? "OLD" : "NEW";
                            db.update(
                                    "INSERT auth.EmailChanges VALUES (?,?,?,?,?,?,?,?,?,0,?,?)",
                                    a.id(),
                                    id,
                                    caller.familyId(),
                                    a.credential(),
                                    a.email(),
                                    email,
                                    a.emailFactor(),
                                    stage,
                                    mac(id, stage, code),
                                    now().plusMinutes(10),
                                    now().plusSeconds(60));
                            return row(a.id());
                        });
        deliver(r, code, ip);
        return response(r);
    }

    private Map<String, Object> current(Sessions.Principal caller, UUID id) {
        var a = accounts.lock(caller.account().id());
        a.requireAdmitted();
        var rows = Rows.query(db, "SELECT * FROM auth.EmailChanges WHERE UserId=?", a.id());
        if (rows.isEmpty()) throw AuthFailure.invalid();
        var r = rows.getFirst();
        if (id == null
                || !id.toString().equalsIgnoreCase(r.get("RequestId").toString())
                || !caller.familyId().toString().equalsIgnoreCase(r.get("FamilyId").toString())
                || a.credential() != ((Number) r.get("CredentialVersion")).longValue()
                || !a.email().equals(r.get("OldEmail"))
                || a.emailFactor() != r.get("EmailFactor").equals(true))
            throw AuthFailure.conflict();
        if (!now().isBefore((OffsetDateTime) r.get("ExpiresAt"))
                || ((Number) r.get("Attempts")).intValue() >= 5) throw AuthFailure.invalid();
        return r;
    }

    public Map<String, Object> verify(Sessions.Principal caller, Code input, String ip) {
        limits.consume("SETTING_VERIFY", "" + caller.account().id(), 50, 1800);
        String next = secrets.code();
        var result =
                tx.execute(
                        s -> {
                            var r = current(caller, input.requestId());
                            int user = caller.account().id();
                            if (input.code() == null
                                    || !input.code().matches("[0-9]{6}")
                                    || !Secrets.equal(
                                            (byte[]) r.get("CodeMac"),
                                            mac(
                                                    input.requestId(),
                                                    (String) r.get("Stage"),
                                                    input.code()))) {
                                db.update(
                                        "UPDATE auth.EmailChanges SET Attempts=Attempts+1 WHERE UserId=?",
                                        user);
                                return Map.<String, Object>of("invalid", true);
                            }
                            if (r.get("Stage").equals("OLD")) {
                                db.update(
                                        "UPDATE auth.EmailChanges SET Stage='NEW',CodeMac=?,Attempts=0,ExpiresAt=?,ResendAfter=? WHERE UserId=?",
                                        mac(input.requestId(), "NEW", next),
                                        now().plusMinutes(10),
                                        now().plusSeconds(60),
                                        user);
                                return row(user);
                            }
                            if (accounts.find((String) r.get("NewEmail")).isPresent())
                                throw new AuthFailure(
                                        409, "EMAIL_UNAVAILABLE", "This email cannot be used.");
                            db.update(
                                    "UPDATE dbo.Users SET Email=? WHERE UserId=?",
                                    r.get("NewEmail"),
                                    user);
                            db.update(
                                    "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND ConsumedAt IS NULL",
                                    now(),
                                    user);
                            db.update(
                                    "INSERT auth.SecurityMailOutbox VALUES (?,?,?,NULL,?)",
                                    UUID.randomUUID(),
                                    r.get("OldEmail"),
                                    now(),
                                    now());
                            db.update("DELETE auth.EmailChanges WHERE UserId=?", user);
                            return Map.<String, Object>of(
                                    "status", "completed", "email", r.get("NewEmail"));
                        });
        if (result.containsKey("invalid")) throw AuthFailure.invalid();
        if (result.containsKey("Stage")) {
            deliver(result, next, ip);
            return response(result);
        }
        return result;
    }

    public Map<String, Object> resend(Sessions.Principal caller, Code input, String ip) {
        limits.consume("SETTING_RESEND", "" + caller.account().id(), 10, 3600);
        String code = secrets.code();
        var r =
                tx.execute(
                        s -> {
                            var before = current(caller, input.requestId());
                            if (now().isBefore((OffsetDateTime) before.get("ResendAfter")))
                                throw new AuthFailure(
                                        429, "RATE_LIMIT", "Please wait before resending.");
                            db.update(
                                    "UPDATE auth.EmailChanges SET CodeMac=?,ExpiresAt=?,ResendAfter=? WHERE UserId=?",
                                    mac(input.requestId(), (String) before.get("Stage"), code),
                                    now().plusMinutes(10),
                                    now().plusSeconds(60),
                                    caller.account().id());
                            return row(caller.account().id());
                        });
        deliver(r, code, ip);
        return response(r);
    }
}
