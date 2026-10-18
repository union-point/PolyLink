package am.polylink.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.*;
import java.util.*;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
@IdentityEnabled
public class Sessions {
    public static final String REFRESH = "__Host-plk-refresh",
            CSRF = "__Host-plk-refresh-csrf",
            CHALLENGE = "__Host-plk-challenge";

    public record Principal(Accounts.Account account, UUID familyId) {}

    public record Issued(
            String access,
            String refresh,
            String csrf,
            String familyId,
            String expiresAt,
            Map<String, Object> session) {
        public Map<String, Object> response() {
            return Map.of(
                    "status",
                    "authenticated",
                    "accessToken",
                    access,
                    "expiresAt",
                    expiresAt,
                    "session",
                    session);
        }

        @Override
        public String toString() {
            return "Issued[redacted]";
        }
    }

    private final JdbcTemplate db;
    private final Accounts accounts;
    private final Secrets secrets;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final JsonMapper mapper;

    public Sessions(
            JdbcTemplate db,
            Accounts accounts,
            Secrets secrets,
            TransactionTemplate tx,
            Clock clock,
            JsonMapper mapper) {
        this.db = db;
        this.accounts = accounts;
        this.secrets = secrets;
        this.tx = tx;
        this.clock = clock;
        this.mapper = mapper;
    }

    public Issued create(int user, long credential, boolean emailProven) {
        return tx.execute(
                status -> {
                    var account = accounts.lock(user);
                    account.requireAdmitted();
                    if (account.credential() != credential) throw AuthFailure.denied();
                    if (account.emailFactor() && !emailProven) throw AuthFailure.conflict();
                    var now = OffsetDateTime.now(clock);
                    UUID family = UUID.randomUUID();
                    String access = secrets.token(),
                            refresh = secrets.token(),
                            csrf = secrets.token();
                    db.update(
                            "INSERT auth.Sessions(SessionId,UserId,FamilyId,CredentialVersion,AccessHash,RefreshHash,AccessExpiresAt,IdleExpiresAt,AbsoluteExpiresAt,CsrfHash) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            family,
                            user,
                            family,
                            account.credential(),
                            Secrets.hash(access),
                            Secrets.hash(refresh),
                            now.plusMinutes(10),
                            now.plusDays(7),
                            now.plusDays(30),
                            Secrets.hash(csrf));
                    return issued(account, family, access, refresh, csrf, now);
                });
    }

    public Principal require(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) throw AuthFailure.denied();
        String token = header.substring(7);
        Secrets.decode(token, 32);
        var rows =
                Rows.query(
                        db, "SELECT * FROM auth.Sessions WHERE AccessHash=?", Secrets.hash(token));
        if (rows.isEmpty()) throw AuthFailure.denied();
        var row = rows.getFirst();
        var account = accounts.get(((Number) row.get("UserId")).intValue());
        validate(row, account);
        if (!((OffsetDateTime) row.get("AccessExpiresAt")).isAfter(OffsetDateTime.now(clock)))
            throw AuthFailure.denied();
        return new Principal(account, UUID.fromString(row.get("FamilyId").toString()));
    }

    public Map<String, Object> metadata(Principal principal) {
        return metadata(principal.account(), principal.familyId());
    }

    public Issued refresh(HttpServletRequest request) {
        String refresh = cookie(request, REFRESH), csrf = csrf(request);
        Secrets.decode(refresh, 32);
        byte[] hash = Secrets.hash(refresh);
        var initial =
                Rows.query(
                        db,
                        "SELECT UserId,SessionId FROM auth.Sessions WHERE RefreshHash=? OR PreviousRefreshHash=?",
                        hash,
                        hash);
        if (initial.isEmpty()) throw AuthFailure.denied();
        var first = initial.getFirst();
        return tx.execute(
                status -> {
                    var account = accounts.lock(((Number) first.get("UserId")).intValue());
                    var row =
                            Rows.query(
                                            db,
                                            "SELECT * FROM auth.Sessions WITH(UPDLOCK,HOLDLOCK) WHERE SessionId=?",
                                            first.get("SessionId"))
                                    .getFirst();
                    validate(row, account);
                    if (!Secrets.equal((byte[]) row.get("CsrfHash"), Secrets.hash(csrf)))
                        throw AuthFailure.denied();
                    var now = OffsetDateTime.now(clock);
                    if (!Secrets.equal(hash, (byte[]) row.get("RefreshHash"))) {
                        if (!Secrets.equal(hash, (byte[]) row.get("PreviousRefreshHash"))
                                || row.get("ReplayPacket") == null
                                || !((OffsetDateTime) row.get("ReplayUntil")).isAfter(now))
                            throw AuthFailure.denied();
                        return mapper.readValue(
                                secrets.decryptReplay((byte[]) row.get("ReplayPacket")),
                                Issued.class);
                    }
                    UUID family = UUID.fromString(row.get("FamilyId").toString());
                    var issued =
                            issued(account, family, secrets.token(), secrets.token(), csrf, now);
                    OffsetDateTime absolute = (OffsetDateTime) row.get("AbsoluteExpiresAt");
                    var idle = now.plusDays(7).isBefore(absolute) ? now.plusDays(7) : absolute;
                    db.update(
                            "UPDATE auth.Sessions SET AccessHash=?,RefreshHash=?,PreviousRefreshHash=?,AccessExpiresAt=?,IdleExpiresAt=?,ReplayUntil=?,ReplayPacket=? WHERE SessionId=?",
                            Secrets.hash(issued.access()),
                            Secrets.hash(issued.refresh()),
                            hash,
                            now.plusMinutes(10),
                            idle,
                            now.plusSeconds(10),
                            secrets.encryptReplay(mapper.writeValueAsBytes(issued)),
                            first.get("SessionId"));
                    return issued;
                });
    }

    public void logout(HttpServletRequest request) {
        String token = cookie(request, REFRESH);
        if (token.isEmpty()) return;
        Secrets.decode(token, 32);
        String csrf = csrf(request);
        byte[] hash = Secrets.hash(token);
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM auth.Sessions WHERE RefreshHash=? OR PreviousRefreshHash=?",
                        hash,
                        hash);
        if (rows.isEmpty()) throw AuthFailure.denied();
        var row = rows.getFirst();
        if (!Secrets.equal((byte[]) row.get("CsrfHash"), Secrets.hash(csrf)))
            throw AuthFailure.denied();
        db.update(
                "UPDATE auth.Sessions SET RevokedAt=?,ReplayPacket=NULL WHERE SessionId=?",
                OffsetDateTime.now(clock),
                row.get("SessionId"));
    }

    private void validate(Map<String, Object> row, Accounts.Account account) {
        account.requireAdmitted();
        var now = OffsetDateTime.now(clock);
        if (row.get("RevokedAt") != null
                || ((Number) row.get("CredentialVersion")).longValue() != account.credential()
                || !((OffsetDateTime) row.get("IdleExpiresAt")).isAfter(now)
                || !((OffsetDateTime) row.get("AbsoluteExpiresAt")).isAfter(now))
            throw AuthFailure.denied();
    }

    private Issued issued(
            Accounts.Account account,
            UUID family,
            String access,
            String refresh,
            String csrf,
            OffsetDateTime now) {
        return new Issued(
                access,
                refresh,
                csrf,
                family.toString(),
                now.plusMinutes(10).toInstant().toString(),
                metadata(account, family));
    }

    private Map<String, Object> metadata(Accounts.Account account, UUID family) {
        return Map.of(
                "user",
                account.user(),
                "familyId",
                family.toString(),
                "versions",
                account.versions(),
                "keySetupRequired",
                account.vaultKey() == 0);
    }

    public static String cookie(HttpServletRequest request, String name) {
        if (request.getCookies() != null)
            for (var cookie : request.getCookies())
                if (cookie.getName().equals(name)) return cookie.getValue();
        return "";
    }

    private static String csrf(HttpServletRequest request) {
        String header = request.getHeader("X-CSRF-Token");
        if (header == null
                || !Secrets.equal(Secrets.hash(header), Secrets.hash(cookie(request, CSRF))))
            throw AuthFailure.denied();
        return header;
    }

    public static void cookie(
            HttpServletResponse response,
            String name,
            String value,
            boolean httpOnly,
            int seconds) {
        response.addHeader(
                "Set-Cookie",
                ResponseCookie.from(name, value)
                        .path("/")
                        .secure(true)
                        .httpOnly(httpOnly)
                        .sameSite("Lax")
                        .maxAge(seconds)
                        .build()
                        .toString());
    }

    public void attach(HttpServletResponse response, Issued issued) {
        cookie(response, REFRESH, issued.refresh(), true, 30 * 86400);
        cookie(response, CSRF, issued.csrf(), false, 30 * 86400);
        cookie(response, CHALLENGE, "", true, 0);
    }

    public void clear(HttpServletResponse response) {
        cookie(response, REFRESH, "", true, 0);
        cookie(response, CSRF, "", false, 0);
        cookie(response, CHALLENGE, "", true, 0);
    }
}
