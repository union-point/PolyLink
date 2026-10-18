package am.polylink.auth;

import java.time.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class RateLimiter {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Secrets secrets;
    private final Clock clock;

    public RateLimiter(JdbcTemplate db, TransactionTemplate tx, Secrets secrets, Clock clock) {
        this.db = db;
        this.tx = tx;
        this.secrets = secrets;
        this.clock = clock;
    }

    public void consume(String purpose, String scope, int limit, int seconds) {
        long bucket = clock.instant().getEpochSecond() / seconds * seconds;
        var start = OffsetDateTime.ofInstant(Instant.ofEpochSecond(bucket), ZoneOffset.UTC);
        byte[] hash = secrets.mac("rate-limit", scope);
        boolean accepted =
                Boolean.TRUE.equals(
                        tx.execute(
                                status -> {
                                    var values =
                                            db.queryForList(
                                                    "SELECT Attempts FROM auth.RateLimits WITH(UPDLOCK,HOLDLOCK) WHERE ScopeHash=? AND Purpose=? AND WindowStart=?",
                                                    Integer.class,
                                                    hash,
                                                    purpose,
                                                    start);
                                    if (!values.isEmpty() && values.getFirst() >= limit)
                                        return false;
                                    if (values.isEmpty())
                                        db.update(
                                                "INSERT auth.RateLimits(ScopeHash,Purpose,WindowStart,Attempts) VALUES (?,?,?,1)",
                                                hash,
                                                purpose,
                                                start);
                                    else
                                        db.update(
                                                "UPDATE auth.RateLimits SET Attempts=Attempts+1 WHERE ScopeHash=? AND Purpose=? AND WindowStart=?",
                                                hash,
                                                purpose,
                                                start);
                                    return true;
                                }));
        if (!accepted)
            throw new AuthFailure(
                    429, "RATE_LIMITED", "Too many attempts. Please try again later.");
    }

    public void issue(String email, String ip) {
        consume("MAIL_ACCOUNT", email, 5, 3600);
        consume("MAIL_IP", ip, 20, 3600);
    }
}
