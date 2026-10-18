package am.polylink.chat;

import am.polylink.auth.IdentityEnabled;
import java.time.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.messenger.enabled", havingValue = "true")
public class AttachmentCleanup {
    private final JdbcTemplate db;
    private final Clock clock;

    public AttachmentCleanup(JdbcTemplate db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void expire() {
        // Row deletion and cascading private-body deletion are one atomic SQL statement.
        try {
            db.update(
                    "DELETE TOP (100) FROM messaging.Attachments WHERE Sequence IS NULL AND ExpiresAt<=?",
                    OffsetDateTime.now(clock));
        } catch (org.springframework.dao.DataAccessException ignored) {
            org.slf4j.LoggerFactory.getLogger(AttachmentCleanup.class)
                    .warn("Staged image cleanup is temporarily unavailable");
        }
    }
}
