package am.polylink.storage;

import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@IdentityEnabled
public class StorageCleanup {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final StorageService storage;

    public StorageCleanup(
            JdbcTemplate db, TransactionTemplate tx, Clock clock, StorageService storage) {
        this.db = db;
        this.tx = tx;
        this.clock = clock;
        this.storage = storage;
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void clean() {
        try {
            db.update(
                    "UPDATE TOP(100) auth.ProfileAvatars SET IsCurrent=0,StorageState='DELETE_PENDING',RetryAt=? WHERE StorageState='UPLOADING' AND CreatedAt<=? AND (LeaseUntil IS NULL OR LeaseUntil<=?)",
                    now(),
                    now().minusDays(1),
                    now());
            for (String table : List.of("messaging.Attachments", "auth.ProfileAvatars")) {
                String idColumn = table.startsWith("messaging") ? "AttachmentId" : "PhotoId";
                for (var row :
                        Rows.query(
                                db,
                                "SELECT TOP(100) * FROM "
                                        + table
                                        + " WHERE StorageState='DELETE_PENDING' AND (RetryAt IS NULL OR RetryAt<=?) AND (LeaseUntil IS NULL OR LeaseUntil<=?) ORDER BY RetryAt",
                                now(),
                                now())) {
                    UUID token = UUID.randomUUID();
                    Object id = row.get(idColumn);
                    if (db.update(
                                    "UPDATE "
                                            + table
                                            + " SET LeaseToken=?,LeaseUntil=? WHERE "
                                            + idColumn
                                            + "=? AND StorageState='DELETE_PENDING' AND (LeaseUntil IS NULL OR LeaseUntil<=?)",
                                    token,
                                    now().plusMinutes(2),
                                    id,
                                    now())
                            != 1) continue;
                    try {
                        String key = Objects.toString(row.get("ObjectKey"), "");
                        if (key.startsWith("attachments/") || key.startsWith("avatars/"))
                            storage.objects().delete(key);
                        tx.executeWithoutResult(
                                s -> {
                                    int changed =
                                            db.update(
                                                    "UPDATE "
                                                            + table
                                                            + " SET StorageState='DELETED',LeaseToken=NULL,LeaseUntil=NULL,RetryAt=NULL WHERE "
                                                            + idColumn
                                                            + "=? AND StorageState='DELETE_PENDING' AND LeaseToken=?",
                                                    id,
                                                    token);
                                    if (changed == 1) {
                                        if (table.startsWith("messaging"))
                                            db.update(
                                                    "DELETE messaging.AttachmentBodies WHERE AttachmentId=?",
                                                    id);
                                        else
                                            db.update(
                                                    "UPDATE auth.ProfileAvatars SET Content=NULL WHERE PhotoId=?",
                                                    id);
                                    }
                                });
                    } catch (RuntimeException e) {
                        int attempts = ((Number) row.get("Attempts")).intValue();
                        db.update(
                                "UPDATE "
                                        + table
                                        + " SET LeaseToken=NULL,LeaseUntil=NULL,Attempts=Attempts+1,RetryAt=? WHERE "
                                        + idColumn
                                        + "=? AND LeaseToken=?",
                                now().plusSeconds(Math.min(3600, 30L << Math.min(7, attempts))),
                                id,
                                token);
                        org.slf4j.LoggerFactory.getLogger(getClass())
                                .warn("Object deletion deferred; retry work retained");
                    }
                }
            }
        } catch (RuntimeException e) {
            org.slf4j.LoggerFactory.getLogger(getClass())
                    .warn("Object cleanup unavailable; retry work retained");
        }
    }

    /** Never run while SQL is unavailable or against a different deployment's bucket. */
    public long sweepOrphans() {
        long removed = 0;
        for (String prefix : List.of("attachments/", "avatars/")) {
            String cursor = null;
            do {
                var page = storage.objects().list(prefix, cursor);
                for (var entry : page.entries()) {
                    if (entry.modified() == null
                            || !entry.modified()
                                    .isBefore(clock.instant().minus(Duration.ofDays(1)))) continue;
                    int references =
                            db.queryForObject(
                                    "SELECT (SELECT COUNT(*) FROM messaging.Attachments WHERE ObjectKey=? AND StorageState<>'DELETED')+(SELECT COUNT(*) FROM auth.ProfileAvatars WHERE ObjectKey=? AND StorageState<>'DELETED')",
                                    Integer.class,
                                    entry.key(),
                                    entry.key());
                    if (references == 0) {
                        storage.objects().delete(entry.key());
                        removed++;
                    }
                }
                cursor = page.next();
            } while (cursor != null);
        }
        return removed;
    }

    @Scheduled(fixedDelay = 3600000, initialDelay = 3600000)
    public void reconcile() {
        if (storage.enabled())
            try {
                sweepOrphans();
            } catch (RuntimeException e) {
                org.slf4j.LoggerFactory.getLogger(getClass())
                        .warn("Object reconciliation unavailable; scan will retry");
            }
    }
}
