package am.polylink.admin;

import am.polylink.auth.*;
import jakarta.servlet.http.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@AdminEnabled
public class AdminSessions {
    public static final String SESSION = "__Host-plk-admin", CSRF = "__Host-plk-admin-csrf";
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Secrets secrets;
    private final Clock clock;

    public AdminSessions(JdbcTemplate db, TransactionTemplate tx, Secrets secrets, Clock clock) {
        this.db = db;
        this.tx = tx;
        this.secrets = secrets;
        this.clock = clock;
    }

    public Map<String, Object> require(HttpServletRequest request, boolean lock) {
        String token = Sessions.cookie(request, SESSION);
        try {
            Secrets.decode(token, 32);
        } catch (AuthFailure invalid) {
            throw AuthFailure.denied();
        }
        var initial =
                Rows.query(
                        db,
                        "SELECT AdminId FROM admin.Sessions WHERE TokenHash=?",
                        Secrets.hash(token));
        if (initial.isEmpty()) throw AuthFailure.denied();
        int id = ((Number) initial.getFirst().get("AdminId")).intValue();
        var admin = account(id, lock);
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM admin.Sessions"
                                + (lock ? " WITH(UPDLOCK,HOLDLOCK)" : "")
                                + " WHERE TokenHash=?",
                        Secrets.hash(token));
        if (rows.isEmpty()) throw AuthFailure.denied();
        var row = rows.getFirst();
        var now = OffsetDateTime.now(clock);
        if (!Boolean.TRUE.equals(admin.get("Enabled"))
                || row.get("RevokedAt") != null
                || !row.get("SessionVersion").equals(admin.get("SessionVersion"))
                || !((OffsetDateTime) row.get("IdleExpiresAt")).isAfter(now)
                || !((OffsetDateTime) row.get("AbsoluteExpiresAt")).isAfter(now))
            throw AuthFailure.denied();
        if (!Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod()))
            csrf(request, (byte[]) row.get("CsrfHash"));
        return admin;
    }

    public Map<String, Object> account(int id, boolean lock) {
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM admin.Admins"
                                + (lock ? " WITH(UPDLOCK,HOLDLOCK)" : "")
                                + " WHERE AdminId=?",
                        id);
        if (rows.isEmpty()) throw AuthFailure.denied();
        return rows.getFirst();
    }

    public Map<String, Object> metadata(Map<String, Object> admin) {
        return Map.of(
                "id",
                admin.get("AdminId").toString(),
                "email",
                admin.get("Email"),
                "firstName",
                admin.get("FirstName"),
                "lastName",
                admin.get("LastName"),
                "role",
                "admin");
    }

    /** Caller holds the admin lock in a transaction, including the 2FA proof. */
    public void issue(Map<String, Object> admin, HttpServletResponse response) {
        var now = OffsetDateTime.now(clock);
        issue(admin, response, now.plusHours(12));
    }

    private void issue(
            Map<String, Object> admin, HttpServletResponse response, OffsetDateTime absolute) {
        String token = secrets.token(), csrf = secrets.token();
        var now = OffsetDateTime.now(clock);
        db.update(
                "INSERT admin.Sessions(TokenHash,AdminId,SessionVersion,CsrfHash,IdleExpiresAt,AbsoluteExpiresAt) VALUES (?,?,?,?,?,?)",
                Secrets.hash(token),
                admin.get("AdminId"),
                admin.get("SessionVersion"),
                Secrets.hash(csrf),
                now.plusMinutes(30),
                absolute);
        Sessions.cookie(response, SESSION, token, true, 43200);
        Sessions.cookie(response, CSRF, csrf, false, 43200);
    }

    public Map<String, Object> refresh(HttpServletRequest request, HttpServletResponse response) {
        return tx.execute(
                status -> {
                    var admin = require(request, true);
                    byte[] hash = Secrets.hash(Sessions.cookie(request, SESSION));
                    var absolute =
                            Rows.query(
                                            db,
                                            "SELECT AbsoluteExpiresAt FROM admin.Sessions WHERE TokenHash=?",
                                            hash)
                                    .getFirst()
                                    .get("AbsoluteExpiresAt");
                    db.update("DELETE admin.Sessions WHERE TokenHash=?", hash);
                    issue(admin, response, (OffsetDateTime) absolute);
                    return metadata(admin);
                });
    }

    public void logout(HttpServletRequest request, HttpServletResponse response) {
        tx.executeWithoutResult(
                status -> {
                    require(request, true);
                    db.update(
                            "DELETE admin.Sessions WHERE TokenHash=?",
                            Secrets.hash(Sessions.cookie(request, SESSION)));
                });
        Sessions.cookie(response, SESSION, "", true, 0);
        Sessions.cookie(response, CSRF, "", false, 0);
    }

    public static void csrf(HttpServletRequest request, byte[] expected) {
        String proof = request.getHeader("X-CSRF-Token");
        if (proof == null || !Secrets.equal(expected, Secrets.hash(proof)))
            throw new AuthFailure(403, "FORBIDDEN", "The request could not be verified.");
    }
}
