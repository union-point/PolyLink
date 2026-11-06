package am.polylink.admin;

import java.time.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@AdminEnabled
public class AdminCleanup {
    private final JdbcTemplate db;
    private final Clock clock;

    public AdminCleanup(JdbcTemplate db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void expire() {
        var now = OffsetDateTime.now(clock);
        try {
            // Separate statements avoid an invitation/challenge lock-order inversion.
            db.update(
                    "DELETE TOP(100) FROM admin.Sessions WHERE AbsoluteExpiresAt<=? OR IdleExpiresAt<=? OR RevokedAt IS NOT NULL",
                    now,
                    now);
            db.update("DELETE TOP(100) FROM admin.Challenges WHERE ExpiresAt<=?", now);
            db.update(
                    "DELETE TOP(100) FROM admin.Invitations WHERE ExpiresAt<=? AND NOT EXISTS(SELECT 1 FROM admin.Challenges c WHERE c.InvitationId=admin.Invitations.InvitationId)",
                    now);
        } catch (org.springframework.dao.DataAccessException ignored) {
            org.slf4j.LoggerFactory.getLogger(AdminCleanup.class)
                    .warn("Admin security cleanup is temporarily unavailable");
        }
    }
}
