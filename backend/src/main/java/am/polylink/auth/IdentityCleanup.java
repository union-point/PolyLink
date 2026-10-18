package am.polylink.auth;

import java.time.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@IdentityEnabled
public class IdentityCleanup {
    private final JdbcTemplate db;
    private final Clock clock;

    public IdentityCleanup(JdbcTemplate db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void expire() {
        var now = OffsetDateTime.now(clock);
        try {
            db.update(
                    "UPDATE auth.Sessions SET ReplayPacket=NULL,PreviousRefreshHash=NULL,ReplayUntil=NULL WHERE ReplayUntil<=?",
                    now);
            db.update("DELETE auth.AccessTokens WHERE ExpiresAt<=?", now);
            db.update("DELETE auth.EmailChallenges WHERE ExpiresAt<?", now.minusDays(1));
            db.update("DELETE auth.RateLimits WHERE WindowStart<?", now.minusDays(1));
            db.update(
                    "UPDATE keyvault.Operations SET State='EXPIRED',PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE State NOT IN ('COMPLETED','CANCELLED','EXPIRED') AND ExpiresAt<=?",
                    now);
        } catch (org.springframework.dao.DataAccessException ignored) {
            org.slf4j.LoggerFactory.getLogger(IdentityCleanup.class)
                    .warn("Identity cleanup is temporarily unavailable");
        }
    }
}
