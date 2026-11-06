package am.polylink.admin;

import am.polylink.auth.*;
import jakarta.servlet.http.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@AdminEnabled
public class AdminAuth {
    public static final String BROWSER = "__Host-plk-admin-challenge",
            CSRF = "__Host-plk-admin-challenge-csrf";
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Secrets secrets;
    private final PasswordEncoder encoder;
    private final RateLimiter limits;
    private final MailDelivery mail;
    private final AdminSessions sessions;
    private final String dummy;

    public AdminAuth(
            JdbcTemplate db,
            TransactionTemplate tx,
            Clock clock,
            Secrets secrets,
            PasswordEncoder encoder,
            RateLimiter limits,
            MailDelivery mail,
            AdminSessions sessions) {
        this.db = db;
        this.tx = tx;
        this.clock = clock;
        this.secrets = secrets;
        this.encoder = encoder;
        this.limits = limits;
        this.mail = mail;
        this.sessions = sessions;
        dummy = encoder.encode(secrets.token());
    }

    private static String email(String value) {
        try {
            return AdminCommand.email(value);
        } catch (IllegalArgumentException e) {
            throw AuthFailure.invalid();
        }
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    public AuthDtos.Derivation parameters(String address, String ip) {
        limits.consume("ADM_PARAMS_IP", ip, 50, 900);
        String addressKey = email(address);
        var rows =
                Rows.query(
                        db,
                        "SELECT ClientSalt,ClientOpsLimit,ClientMemoryBytes FROM admin.Admins WHERE Email=?",
                        addressKey);
        if (rows.isEmpty())
            return new AuthDtos.Derivation(
                    "PLK1",
                    Secrets.encode(Arrays.copyOf(secrets.mac("admin-parameters", addressKey), 16)),
                    3,
                    67108864);
        var row = rows.getFirst();
        return new AuthDtos.Derivation(
                "PLK1",
                Secrets.encode((byte[]) row.get("ClientSalt")),
                ((Number) row.get("ClientOpsLimit")).intValue(),
                ((Number) row.get("ClientMemoryBytes")).longValue());
    }

    private Map<String, Object> invitation(String token, boolean lock) {
        Secrets.decode(token, 32);
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM admin.Invitations"
                                + (lock ? " WITH(UPDLOCK,HOLDLOCK)" : "")
                                + " WHERE TokenHash=?",
                        Secrets.hash(token));
        if (rows.isEmpty()) throw AuthFailure.denied();
        var row = rows.getFirst();
        if (row.get("ConsumedAt") != null
                || !((OffsetDateTime) row.get("ExpiresAt")).isAfter(now()))
            throw AuthFailure.denied();
        return row;
    }

    public Map<String, Object> inspect(String token, String ip) {
        limits.consume("ADMIN_INVITE_IP", ip, 30, 900);
        var row = invitation(token, false);
        return Map.of(
                "email",
                row.get("Email"),
                "expiresAt",
                ((OffsetDateTime) row.get("ExpiresAt")).toInstant().toString());
    }

    private void mailLimit(String address, String ip) {
        limits.consume("ADMIN_MAIL_EMAIL", address, 5, 3600);
        limits.consume("ADMIN_MAIL_IP", ip, 20, 3600);
    }

    public Map<String, Object> register(
            AdminController.Registration input,
            HttpServletRequest request,
            HttpServletResponse response) {
        limits.consume("ADM_REGISTER_IP", request.getRemoteAddr(), 10, 900);
        var initial = invitation(input.token(), false);
        mailLimit((String) initial.get("Email"), request.getRemoteAddr());
        Secrets.decode(input.loginSecret(), 32);
        byte[] salt = Secrets.decode(input.derivation().salt(), 16);
        String verifier = encoder.encode(input.loginSecret());
        String browser = secrets.token(), csrf = secrets.token(), code = secrets.code();
        UUID id = UUID.randomUUID();
        var result =
                tx.execute(
                        status -> {
                            var invite = invitation(input.token(), true);
                            if (!Rows.query(
                                            db,
                                            "SELECT AdminId FROM admin.Admins WITH(UPDLOCK,HOLDLOCK) WHERE Email=?",
                                            invite.get("Email"))
                                    .isEmpty()) throw AuthFailure.denied();
                            String previous = Sessions.cookie(request, BROWSER);
                            if (!previous.isEmpty())
                                db.update(
                                        "UPDATE admin.Challenges SET ConsumedAt=? WHERE InvitationId=? AND BrowserHash=? AND ConsumedAt IS NULL",
                                        now(),
                                        invite.get("InvitationId"),
                                        Secrets.hash(previous));
                            String first = input.firstName().strip(),
                                    last = input.lastName().strip();
                            if (first.isEmpty() || last.isEmpty()) throw AuthFailure.invalid();
                            var expires = now().plusMinutes(10);
                            if (expires.isAfter((OffsetDateTime) invite.get("ExpiresAt")))
                                expires = (OffsetDateTime) invite.get("ExpiresAt");
                            db.update(
                                    "INSERT admin.Challenges(ChallengeId,Purpose,InvitationId,BrowserHash,CsrfHash,CodeMac,ExpiresAt,ResendAfter,FirstName,LastName,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier) VALUES (?,'REGISTER',?,?,?,?,?,?,?,?,?,?,?,?)",
                                    id,
                                    invite.get("InvitationId"),
                                    Secrets.hash(browser),
                                    Secrets.hash(csrf),
                                    codeMac(id, "REGISTER", code),
                                    expires,
                                    now().plusSeconds(60),
                                    first,
                                    last,
                                    salt,
                                    input.derivation().opsLimit(),
                                    input.derivation().memoryBytes(),
                                    verifier);
                            return challenge(id, expires, now().plusSeconds(60));
                        });
        attach(response, browser, csrf);
        mail.sendCode((String) initial.get("Email"), "EMAIL_VERIFY", code);
        return result;
    }

    public Map<String, Object> login(
            AuthDtos.Login input, HttpServletRequest request, HttpServletResponse response) {
        String address = email(input.email()), ip = request.getRemoteAddr();
        limits.consume("ADM_LOGIN_EMAIL", address, 10, 900);
        limits.consume("ADMIN_LOGIN_IP", ip, 50, 900);
        Secrets.decode(input.loginSecret(), 32);
        var rows = Rows.query(db, "SELECT * FROM admin.Admins WHERE Email=?", address);
        String verifier = rows.isEmpty() ? dummy : (String) rows.getFirst().get("LoginVerifier");
        if (!encoder.matches(input.loginSecret(), verifier)
                || rows.isEmpty()
                || !Boolean.TRUE.equals(rows.getFirst().get("Enabled"))) throw AuthFailure.denied();
        mailLimit(address, ip);
        String browser = secrets.token(), csrf = secrets.token(), code = secrets.code();
        UUID id = UUID.randomUUID();
        var result =
                tx.execute(
                        status -> {
                            var admin =
                                    sessions.account(
                                            ((Number) rows.getFirst().get("AdminId")).intValue(),
                                            true);
                            if (!Boolean.TRUE.equals(admin.get("Enabled"))
                                    || !verifier.equals(admin.get("LoginVerifier")))
                                throw AuthFailure.denied();
                            String previous = Sessions.cookie(request, BROWSER);
                            if (!previous.isEmpty())
                                db.update(
                                        "UPDATE admin.Challenges SET ConsumedAt=? WHERE AdminId=? AND BrowserHash=? AND ConsumedAt IS NULL",
                                        now(),
                                        admin.get("AdminId"),
                                        Secrets.hash(previous));
                            var expires = now().plusMinutes(10);
                            var resend = now().plusSeconds(60);
                            db.update(
                                    "INSERT admin.Challenges(ChallengeId,Purpose,AdminId,SessionVersion,BrowserHash,CsrfHash,CodeMac,ExpiresAt,ResendAfter) VALUES (?,'LOGIN',?,?,?,?,?,?,?)",
                                    id,
                                    admin.get("AdminId"),
                                    admin.get("SessionVersion"),
                                    Secrets.hash(browser),
                                    Secrets.hash(csrf),
                                    codeMac(id, "LOGIN", code),
                                    expires,
                                    resend);
                            return challenge(id, expires, resend);
                        });
        attach(response, browser, csrf);
        mail.sendCode(address, "LOGIN", code);
        return result;
    }

    private Map<String, Object> challenge(UUID id, OffsetDateTime expires, OffsetDateTime resend) {
        return Map.of(
                "status",
                "challenge",
                "challengeId",
                id.toString(),
                "expiresAt",
                expires.toInstant().toString(),
                "resendAfter",
                resend.toInstant().toString());
    }

    private byte[] codeMac(UUID id, String purpose, String code) {
        return secrets.mac("admin-code", id + ":" + purpose + ":" + code);
    }

    private void attach(HttpServletResponse response, String browser, String csrf) {
        Sessions.cookie(response, BROWSER, browser, true, 600);
        Sessions.cookie(response, CSRF, csrf, false, 600);
    }

    /** Lock the owner before the challenge, matching the offline disable command. */
    private Map<String, Object> locked(
            UUID id, String purpose, HttpServletRequest request, boolean completed) {
        var initial = Rows.query(db, "SELECT * FROM admin.Challenges WHERE ChallengeId=?", id);
        if (initial.isEmpty() || !purpose.equals(initial.getFirst().get("Purpose"))) return null;
        var first = initial.getFirst();
        Map<String, Object> ownerInvitation = null;
        if (purpose.equals("LOGIN")) {
            var admin = sessions.account(((Number) first.get("AdminId")).intValue(), true);
            if (!Boolean.TRUE.equals(admin.get("Enabled"))
                    || !admin.get("SessionVersion").equals(first.get("SessionVersion")))
                return null;
        } else {
            var invites =
                    Rows.query(
                            db,
                            "SELECT * FROM admin.Invitations WITH(UPDLOCK,HOLDLOCK) WHERE InvitationId=?",
                            first.get("InvitationId"));
            if (invites.isEmpty()) return null;
            ownerInvitation = invites.getFirst();
            if (!((OffsetDateTime) ownerInvitation.get("ExpiresAt")).isAfter(now())) return null;
        }

        var row =
                Rows.query(
                                db,
                                "SELECT * FROM admin.Challenges WITH(UPDLOCK,HOLDLOCK) WHERE ChallengeId=?",
                                id)
                        .getFirst();
        if (ownerInvitation != null
                && ownerInvitation.get("ConsumedAt") != null
                && (!completed
                        || row.get("CompletedAdminId") == null
                        || !row.get("CompletedAdminId")
                                .equals(ownerInvitation.get("ConsumedAdminId")))) return null;
        String browser = Sessions.cookie(request, BROWSER);
        if (browser.isEmpty()
                || !Secrets.equal((byte[]) row.get("BrowserHash"), Secrets.hash(browser)))
            return null;
        AdminSessions.csrf(request, (byte[]) row.get("CsrfHash"));
        if (!((OffsetDateTime) row.get("ExpiresAt")).isAfter(now())
                || ((Number) row.get("FailedAttempts")).intValue() >= 5) return null;
        if (row.get("ConsumedAt") != null && (!completed || row.get("CompletedAdminId") == null))
            return null;
        return row;
    }

    public Map<String, Object> verify(
            AuthDtos.CodeProof proof,
            String purpose,
            HttpServletRequest request,
            HttpServletResponse response) {
        limits.consume("ADMIN_VERIFY_IP", request.getRemoteAddr(), 50, 1800);
        limits.consume("ADM_VERIFY_CODE", proof.challengeId().toString(), 10, 1800);
        var result =
                tx.execute(
                        status -> {
                            var row =
                                    locked(
                                            proof.challengeId(),
                                            purpose,
                                            request,
                                            purpose.equals("REGISTER"));
                            if (row == null) return null;
                            if (!Secrets.equal(
                                    (byte[]) row.get("CodeMac"),
                                    codeMac(proof.challengeId(), purpose, proof.code()))) {
                                db.update(
                                        "UPDATE admin.Challenges SET FailedAttempts=FailedAttempts+1 WHERE ChallengeId=?",
                                        proof.challengeId());
                                return null;
                            }
                            if (purpose.equals("REGISTER")) {
                                if (row.get("CompletedAdminId") != null)
                                    return Map.<String, Object>of("status", "registered");
                                var invite =
                                        Rows.query(
                                                        db,
                                                        "SELECT * FROM admin.Invitations WHERE InvitationId=?",
                                                        row.get("InvitationId"))
                                                .getFirst();
                                var existing =
                                        Rows.query(
                                                db,
                                                "SELECT AdminId FROM admin.Admins WITH(UPDLOCK,HOLDLOCK) WHERE Email=?",
                                                invite.get("Email"));
                                if (!existing.isEmpty()) return null;
                                int admin =
                                        db.queryForObject(
                                                "INSERT admin.Admins(Email,FirstName,LastName,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailVerifiedAt) OUTPUT inserted.AdminId VALUES (?,?,?,?,?,?,?,?)",
                                                Integer.class,
                                                invite.get("Email"),
                                                row.get("FirstName"),
                                                row.get("LastName"),
                                                row.get("ClientSalt"),
                                                row.get("ClientOpsLimit"),
                                                row.get("ClientMemoryBytes"),
                                                row.get("LoginVerifier"),
                                                now());
                                db.update(
                                        "UPDATE admin.Invitations SET ConsumedAdminId=?,ConsumedAt=? WHERE InvitationId=?",
                                        admin,
                                        now(),
                                        row.get("InvitationId"));
                                db.update(
                                        "UPDATE admin.Challenges SET CompletedAdminId=?,ConsumedAt=? WHERE ChallengeId=?",
                                        admin,
                                        now(),
                                        proof.challengeId());
                                return Map.<String, Object>of("status", "registered");
                            }
                            var admin =
                                    sessions.account(
                                            ((Number) row.get("AdminId")).intValue(), true);
                            sessions.issue(admin, response);
                            db.update(
                                    "UPDATE admin.Challenges SET ConsumedAt=? WHERE ChallengeId=?",
                                    now(),
                                    proof.challengeId());
                            return Map.<String, Object>of(
                                    "status", "authenticated", "admin", sessions.metadata(admin));
                        });
        if (result == null) throw AuthFailure.denied();
        return result;
    }

    public Map<String, Object> resend(UUID id, String purpose, HttpServletRequest request) {
        limits.consume("ADMIN_RESEND_IP", request.getRemoteAddr(), 20, 3600);
        String address =
                tx.execute(
                        status -> {
                            var row = locked(id, purpose, request, false);
                            if (row == null) throw AuthFailure.denied();
                            if (((OffsetDateTime) row.get("ResendAfter")).isAfter(now()))
                                throw new AuthFailure(
                                        429,
                                        "RATE_LIMITED",
                                        "Please wait before requesting another code.");
                            return purpose.equals("LOGIN")
                                    ? (String)
                                            sessions.account(
                                                            ((Number) row.get("AdminId"))
                                                                    .intValue(),
                                                            false)
                                                    .get("Email")
                                    : (String)
                                            Rows.query(
                                                            db,
                                                            "SELECT Email FROM admin.Invitations WHERE InvitationId=?",
                                                            row.get("InvitationId"))
                                                    .getFirst()
                                                    .get("Email");
                        });
        mailLimit(address, request.getRemoteAddr());
        String code = secrets.code();
        var expires =
                tx.execute(
                        status -> {
                            var row = locked(id, purpose, request, false);
                            if (row == null) throw AuthFailure.denied();
                            if (((OffsetDateTime) row.get("ResendAfter")).isAfter(now()))
                                throw new AuthFailure(
                                        429,
                                        "RATE_LIMITED",
                                        "Please wait before requesting another code.");
                            db.update(
                                    "UPDATE admin.Challenges SET CodeMac=?,ResendAfter=? WHERE ChallengeId=?",
                                    codeMac(id, purpose, code),
                                    now().plusSeconds(60),
                                    id);
                            return (OffsetDateTime) row.get("ExpiresAt");
                        });
        mail.sendCode(address, purpose.equals("LOGIN") ? "LOGIN" : "EMAIL_VERIFY", code);
        return challenge(id, expires, now().plusSeconds(60));
    }
}
