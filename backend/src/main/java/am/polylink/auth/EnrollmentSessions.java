package am.polylink.auth;

import jakarta.servlet.http.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Separate capability namespace: these tokens are never application access/refresh tokens. */
@Service
@IdentityEnabled
public class EnrollmentSessions {
    public static final String COOKIE = "__Host-plk-enrollment",
            CSRF = "__Host-plk-enrollment-csrf";

    public record Caller(Accounts.Account account, String token, Map<String, Object> session) {}

    private final JdbcTemplate db;
    private final Accounts accounts;
    private final Secrets secrets;
    private final Clock clock;
    private final TransactionTemplate tx;

    public EnrollmentSessions(
            JdbcTemplate db,
            Accounts accounts,
            Secrets secrets,
            Clock clock,
            TransactionTemplate tx) {
        this.db = db;
        this.accounts = accounts;
        this.secrets = secrets;
        this.clock = clock;
        this.tx = tx;
    }

    public void issue(int user, long credential, HttpServletResponse response) {
        String token = secrets.token(), csrf = secrets.token();
        tx.executeWithoutResult(
                status -> {
                    var account = accounts.lock(user);
                    if (!account.admission().equals("PENDING")
                            || account.credential() != credential) throw AuthFailure.denied();
                    var pending =
                            Rows.query(
                                    db,
                                    "SELECT SavedAt FROM auth.PendingEnrollments WHERE UserId=?",
                                    user);
                    if (pending.isEmpty()
                            || !((OffsetDateTime) pending.getFirst().get("SavedAt"))
                                    .plusDays(7)
                                    .isAfter(now())) throw AuthFailure.denied();
                    db.update(
                            "INSERT auth.EnrollmentSessions(TokenHash,UserId,CredentialVersion,CsrfHash,IdleExpiresAt,AbsoluteExpiresAt) VALUES (?,?,?,?,?,?)",
                            Secrets.hash(token),
                            user,
                            credential,
                            Secrets.hash(csrf),
                            now().plusMinutes(30),
                            now().plusHours(24));
                });
        Sessions.cookie(response, COOKIE, token, true, 86400);
        Sessions.cookie(response, CSRF, csrf, false, 86400);
    }

    /** Called inside the enrollment transaction; lock account before session/profile/challenge. */
    public Caller require(HttpServletRequest request, boolean completed) {
        String token = Sessions.cookie(request, COOKIE);
        if (token.isEmpty()) throw AuthFailure.denied();
        Secrets.decode(token, 32);
        var initial =
                Rows.query(
                        db,
                        "SELECT UserId FROM auth.EnrollmentSessions WHERE TokenHash=?",
                        Secrets.hash(token));
        if (initial.isEmpty()) throw AuthFailure.denied();
        var account = accounts.lock(((Number) initial.getFirst().get("UserId")).intValue());
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM auth.EnrollmentSessions WITH(UPDLOCK,HOLDLOCK) WHERE TokenHash=?",
                        Secrets.hash(token));
        if (rows.isEmpty()) throw AuthFailure.denied();
        var row = rows.getFirst();
        if (row.get("RevokedAt") != null
                || ((Number) row.get("CredentialVersion")).longValue() != account.credential()
                || !((OffsetDateTime) row.get("IdleExpiresAt")).isAfter(now())
                || !((OffsetDateTime) row.get("AbsoluteExpiresAt")).isAfter(now()))
            throw AuthFailure.denied();
        if (!Set.of("GET", "HEAD").contains(request.getMethod())) {
            String csrf = request.getHeader("X-CSRF-Token");
            if (csrf == null
                    || !Secrets.equal(
                            Secrets.hash(csrf), Secrets.hash(Sessions.cookie(request, CSRF)))
                    || !Secrets.equal(Secrets.hash(csrf), (byte[]) row.get("CsrfHash")))
                throw AuthFailure.denied();
        }
        if (account.admission().equals("PENDING")) {
            var pending =
                    Rows.query(
                            db,
                            "SELECT SavedAt FROM auth.PendingEnrollments WITH(UPDLOCK,HOLDLOCK) WHERE UserId=?",
                            account.id());
            if (pending.isEmpty()
                    || !((OffsetDateTime) pending.getFirst().get("SavedAt"))
                            .plusDays(7)
                            .isAfter(now())) throw AuthFailure.denied();
        } else if (!completed
                || !account.admission().equals("ADMITTED")
                || row.get("CompletedChallengeId") == null) throw AuthFailure.denied();
        var absolute = (OffsetDateTime) row.get("AbsoluteExpiresAt");
        db.update(
                "UPDATE auth.EnrollmentSessions SET IdleExpiresAt=? WHERE TokenHash=?",
                now().plusMinutes(30).isBefore(absolute) ? now().plusMinutes(30) : absolute,
                Secrets.hash(token));
        return new Caller(account, token, row);
    }

    public void logout(HttpServletRequest request, HttpServletResponse response) {
        if (!Sessions.cookie(request, COOKIE).isEmpty())
            tx.executeWithoutResult(
                    status -> {
                        // Expired sessions can still be revoked using their CSRF proof.
                        String token = Sessions.cookie(request, COOKIE),
                                csrf = request.getHeader("X-CSRF-Token");
                        if (csrf == null) throw AuthFailure.denied();
                        db.update(
                                "UPDATE auth.EnrollmentSessions SET RevokedAt=? WHERE TokenHash=? AND CsrfHash=?",
                                now(),
                                Secrets.hash(token),
                                Secrets.hash(csrf));
                    });
        clear(response);
    }

    public static void clear(HttpServletResponse response) {
        Sessions.cookie(response, COOKIE, "", true, 0);
        Sessions.cookie(response, CSRF, "", false, 0);
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }
}
