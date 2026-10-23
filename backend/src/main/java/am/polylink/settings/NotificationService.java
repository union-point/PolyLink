package am.polylink.settings;

import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class NotificationService {
    private final JdbcTemplate db;
    private final Clock clock;
    private final MailDelivery mail;
    private final TransactionTemplate tx;

    public NotificationService(
            JdbcTemplate db, Clock clock, MailDelivery mail, TransactionTemplate tx) {
        this.db = db;
        this.clock = clock;
        this.mail = mail;
        this.tx = tx;
    }

    // All eligibility checks run again at delivery, including membership's sequence boundary.
    private static final String ELIGIBLE =
            " FROM auth.ActivityNotifications n JOIN dbo.Users u ON u.UserId=n.UserId JOIN auth.AccountSecurity a ON a.UserId=u.UserId JOIN dbo.UserNotificationSettings s ON s.UserId=u.UserId JOIN dbo.Users actor ON actor.UserId=n.ActorId JOIN auth.AccountSecurity actorSecurity ON actorSecurity.UserId=actor.UserId JOIN messaging.Participants p ON p.RoomId=n.RoomId AND p.UserId=n.UserId JOIN messaging.Rooms r ON r.RoomId=p.RoomId WHERE n.Kind='DIRECT_MESSAGE' AND a.AdmissionStatus='ADMITTED' AND actorSecurity.AdmissionStatus='ADMITTED' AND s.DirectMessageNotifications=1 AND p.Muted=0 AND n.Sequence>p.LastReadSequence AND n.Sequence>=p.JoinedSequence AND n.Sequence>p.HistoryCutoff AND (r.IsGroup=0 OR EXISTS(SELECT 1 FROM messaging.MembershipIntervals i WHERE i.RoomId=p.RoomId AND i.UserId=p.UserId AND i.LeftMembership IS NULL AND n.Sequence>=i.JoinedSequence)) AND NOT EXISTS(SELECT 1 FROM messaging.Blocks b WHERE (b.UserId=n.UserId AND b.TargetId=n.ActorId) OR (b.UserId=n.ActorId AND b.TargetId=n.UserId))";

    public Map<String, Object> list(int user, String cursor, int limit) {
        if (limit < 1 || limit > 100) throw AuthFailure.invalid();
        long after;
        try {
            after = cursor.equals("initial") ? 0 : Long.parseLong(cursor);
            if (after < 0) throw AuthFailure.invalid();
        } catch (NumberFormatException e) {
            throw AuthFailure.invalid();
        }
        if (cursor.equals("initial")) {
            Long latest =
                    db.queryForObject(
                            "SELECT COALESCE(MAX(Id),0) FROM auth.ActivityNotifications WHERE UserId=?",
                            Long.class,
                            user);
            return Map.of("items", List.of(), "nextCursor", latest.toString());
        }
        var rows =
                Rows.query(
                        db,
                        "SELECT TOP ("
                                + limit
                                + ") n.Id,n.RoomId,n.Sequence,actor.FirstName,actor.LastName"
                                + ELIGIBLE
                                + " AND n.UserId=? AND n.Id>? ORDER BY n.Id",
                        user,
                        after);
        List<Map<String, Object>> items = new ArrayList<>();
        for (var r : rows) {
            items.add(
                    Map.of(
                            "id",
                            r.get("Id").toString(),
                            "roomId",
                            r.get("RoomId").toString(),
                            "sequence",
                            r.get("Sequence").toString(),
                            "title",
                            r.get("FirstName") + " " + r.get("LastName"),
                            "body",
                            "New message"));
        }
        return Map.of(
                "items",
                items,
                "nextCursor",
                rows.isEmpty() ? cursor : rows.getLast().get("Id").toString());
    }

    @Scheduled(fixedDelay = 15000)
    public void deliver() {
        var now = OffsetDateTime.now(clock);
        for (var entry :
                Rows.query(
                        db,
                        "SELECT TOP (20) * FROM auth.SecurityMailOutbox WHERE DeliveredAt IS NULL AND RetryAt<=? ORDER BY CreatedAt",
                        now)) {
            if (db.update(
                            "UPDATE auth.SecurityMailOutbox SET RetryAt=? WHERE Id=? AND DeliveredAt IS NULL AND RetryAt<=?",
                            now.plusMinutes(2),
                            entry.get("Id"),
                            now)
                    != 1) continue;
            try {
                mail.sendNotice(
                        (String) entry.get("Email"),
                        "PolyLink email changed",
                        "Your PolyLink email address has changed. If you did not request this change, contact the administrator.");
                db.update(
                        "UPDATE auth.SecurityMailOutbox SET DeliveredAt=? WHERE Id=?",
                        now,
                        entry.get("Id"));
            } catch (RuntimeException ignored) {
                /* Lease expiry retries failed delivery. */
            }
        }
        for (var group :
                Rows.query(
                        db,
                        "SELECT TOP (20) UserId,RoomId FROM auth.ActivityNotifications WHERE EmailDone=0 AND RetryAt<=? GROUP BY UserId,RoomId",
                        now)) {
            var claimed =
                    tx.execute(
                            s -> {
                                var rows =
                                        Rows.query(
                                                db,
                                                "SELECT Id FROM auth.ActivityNotifications WITH(UPDLOCK,READPAST) WHERE UserId=? AND RoomId=? AND EmailDone=0 AND RetryAt<=?",
                                                group.get("UserId"),
                                                group.get("RoomId"),
                                                now);
                                for (var row : rows)
                                    db.update(
                                            "UPDATE auth.ActivityNotifications SET RetryAt=? WHERE Id=?",
                                            now.plusMinutes(2),
                                            row.get("Id"));
                                return rows;
                            });
            if (claimed.isEmpty()) continue;
            try {
                var eligible =
                        Rows.query(
                                db,
                                "SELECT TOP (1) u.Email"
                                        + ELIGIBLE
                                        + " AND n.UserId=? AND n.RoomId=? AND s.EmailEnabled=1 AND n.EmailDone=0 AND n.CreatedAt<=?",
                                group.get("UserId"),
                                group.get("RoomId"),
                                now.minusSeconds(60));
                if (!eligible.isEmpty())
                    mail.sendNotice(
                            (String) eligible.getFirst().get("Email"),
                            "PolyLink: new messages",
                            "You have unread messages in PolyLink. Open the site to read them.");
                for (var row : claimed)
                    db.update(
                            "UPDATE auth.ActivityNotifications SET EmailDone=1 WHERE Id=?",
                            row.get("Id"));
            } catch (RuntimeException ignored) {
                /* Lease expiry retries failed delivery. */
            }
        }
    }
}
