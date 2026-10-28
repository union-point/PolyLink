package am.polylink.settings;

import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
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
    private final boolean forumEnabled;
    private final String frontend;
    private final boolean postsEnabled;
    private final Secrets secrets;

    @org.springframework.beans.factory.annotation.Autowired
    public NotificationService(
            JdbcTemplate db,
            Clock clock,
            MailDelivery mail,
            TransactionTemplate tx,
            @Value("${polylink.forum.enabled:false}") boolean forumEnabled,
            @Value("${polylink.frontend-origins:http://localhost:8001}") String frontend,
            @Value("${polylink.posts.enabled:false}") boolean postsEnabled,
            Secrets secrets) {
        this.db = db;
        this.clock = clock;
        this.mail = mail;
        this.tx = tx;
        this.forumEnabled = forumEnabled;
        this.postsEnabled = postsEnabled;
        this.secrets = secrets;
        this.frontend = frontend.split(",")[0].strip().replaceAll("/+$", "");
    }

    public NotificationService(
            JdbcTemplate db,
            Clock clock,
            MailDelivery mail,
            TransactionTemplate tx,
            boolean forumEnabled,
            String frontend) {
        this(db, clock, mail, tx, forumEnabled, frontend, false, null);
    }

    private static final String POST_ELIGIBLE =
            " FROM auth.ActivityNotifications n JOIN dbo.Users u ON u.UserId=n.UserId JOIN auth.AccountSecurity a ON a.UserId=n.UserId JOIN dbo.UserNotificationSettings s ON s.UserId=n.UserId JOIN dbo.Posts post ON post.PostId=n.PostId AND post.UserId=n.UserId JOIN dbo.PostComments comment ON comment.CommentId=n.CommentId AND comment.PostId=post.PostId AND comment.UserId=n.ActorId JOIN dbo.Users actor ON actor.UserId=n.ActorId JOIN auth.AccountSecurity actorSecurity ON actorSecurity.UserId=n.ActorId WHERE n.Kind='POST_COMMENT' AND n.UserId<>n.ActorId AND a.AdmissionStatus='ADMITTED' AND a.EmailVerifiedAt IS NOT NULL AND actorSecurity.AdmissionStatus='ADMITTED' AND actorSecurity.EmailVerifiedAt IS NOT NULL AND s.PostCommentNotifications=1";
    private static final String POST_FIELDS =
            "n.Id,n.PostId,n.CommentId,n.CreatedAt,actor.FirstName,actor.LastName";

    private Map<String, Object> postItem(Map<String, Object> row) {
        return Map.of(
                "id",
                row.get("Id").toString(),
                "kind",
                "POST_COMMENT",
                "postId",
                row.get("PostId").toString(),
                "commentId",
                row.get("CommentId").toString(),
                "createdAt",
                row.get("CreatedAt").toString(),
                "title",
                row.get("FirstName") + " " + row.get("LastName"),
                "body",
                "Նոր մեկնաբանություն ձեր հայտարարության տակ");
    }

    /** Retained history is separate from the browser/live initial-cursor baseline. */
    public Map<String, Object> history(int user, String cursor) {
        var result = new LinkedHashMap<String, Object>();
        if (!postsEnabled) {
            result.put("items", List.of());
            result.put("nextCursor", null);
            return result;
        }
        var args = new ArrayList<Object>();
        args.add(user);
        String where = " AND n.UserId=?";
        if (!cursor.isEmpty()) {
            try {
                if (cursor.length() > 1000) throw new IllegalArgumentException();
                String[] parts = cursor.split("\\.", -1);
                if (parts.length != 2) throw new IllegalArgumentException();
                String payload =
                        new String(
                                Base64.getUrlDecoder().decode(parts[0]),
                                java.nio.charset.StandardCharsets.UTF_8);
                if (!Secrets.equal(
                        secrets.mac("posts-activity-history", payload),
                        Secrets.decode(parts[1], 32))) throw new IllegalArgumentException();
                String[] fields = payload.split("\n", -1);
                if (fields.length != 3 || !fields[0].equals("" + user))
                    throw new IllegalArgumentException();
                var time = OffsetDateTime.parse(fields[1]);
                long id = Long.parseLong(fields[2]);
                if (id < 1) throw new IllegalArgumentException();
                where += " AND (n.CreatedAt<? OR (n.CreatedAt=? AND n.Id<?))";
                args.add(time);
                args.add(time);
                args.add(id);
            } catch (RuntimeException e) {
                throw AuthFailure.invalid();
            }
        }
        var rows =
                Rows.query(
                        db,
                        "SELECT TOP (21) "
                                + POST_FIELDS
                                + POST_ELIGIBLE
                                + where
                                + " ORDER BY n.CreatedAt DESC,n.Id DESC",
                        args.toArray());
        boolean more = rows.size() > 20;
        var visible = more ? rows.subList(0, 20) : rows;
        result.put("items", visible.stream().map(this::postItem).toList());
        String next = null;
        if (more) {
            var row = visible.getLast();
            String payload = user + "\n" + row.get("CreatedAt") + "\n" + row.get("Id");
            next =
                    Secrets.encode(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8))
                            + "."
                            + Secrets.encode(secrets.mac("posts-activity-history", payload));
        }
        result.put("nextCursor", next);
        return result;
    }

    // All eligibility checks run again at delivery, including membership's sequence boundary.
    private static final String ELIGIBLE =
            " FROM auth.ActivityNotifications n JOIN dbo.Users u ON u.UserId=n.UserId JOIN auth.AccountSecurity a ON a.UserId=u.UserId JOIN dbo.UserNotificationSettings s ON s.UserId=u.UserId JOIN dbo.Users actor ON actor.UserId=n.ActorId JOIN auth.AccountSecurity actorSecurity ON actorSecurity.UserId=actor.UserId JOIN messaging.Participants p ON p.RoomId=n.RoomId AND p.UserId=n.UserId JOIN messaging.Rooms r ON r.RoomId=p.RoomId WHERE n.Kind='DIRECT_MESSAGE' AND a.AdmissionStatus='ADMITTED' AND actorSecurity.AdmissionStatus='ADMITTED' AND s.DirectMessageNotifications=1 AND p.Muted=0 AND n.Sequence>p.LastReadSequence AND n.Sequence>=p.JoinedSequence AND n.Sequence>p.HistoryCutoff AND (r.IsGroup=0 OR EXISTS(SELECT 1 FROM messaging.MembershipIntervals i WHERE i.RoomId=p.RoomId AND i.UserId=p.UserId AND i.LeftMembership IS NULL AND n.Sequence>=i.JoinedSequence)) AND NOT EXISTS(SELECT 1 FROM messaging.Blocks b WHERE (b.UserId=n.UserId AND b.TargetId=n.ActorId) OR (b.UserId=n.ActorId AND b.TargetId=n.UserId))";

    private static final String FORUM_ELIGIBLE =
            " FROM auth.ActivityNotifications n JOIN dbo.Users u ON u.UserId=n.UserId JOIN auth.AccountSecurity a ON a.UserId=n.UserId JOIN dbo.UserNotificationSettings s ON s.UserId=n.UserId JOIN dbo.ForumTopics t ON t.TopicId=n.TopicId AND t.UserId=n.UserId JOIN dbo.ForumReplies reply ON reply.ReplyId=n.ReplyId AND reply.TopicId=t.TopicId AND reply.UserId=n.ActorId JOIN dbo.Users actor ON actor.UserId=n.ActorId JOIN auth.AccountSecurity actorSecurity ON actorSecurity.UserId=actor.UserId WHERE n.Kind='FORUM_REPLY' AND n.ActorId<>n.UserId AND a.AdmissionStatus='ADMITTED' AND a.EmailVerifiedAt IS NOT NULL AND actorSecurity.AdmissionStatus='ADMITTED' AND s.ForumReplyNotifications=1";

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
        var scan =
                db.queryForList(
                        "SELECT TOP ("
                                + limit
                                + ") Id FROM auth.ActivityNotifications WHERE UserId=? AND Id>? ORDER BY Id",
                        Long.class,
                        user,
                        after);
        long through = scan.isEmpty() ? after : scan.getLast();
        var rows =
                Rows.query(
                        db,
                        "SELECT TOP ("
                                + limit
                                + ") n.Id,n.RoomId,n.Sequence,actor.FirstName,actor.LastName"
                                + ELIGIBLE
                                + " AND n.UserId=? AND n.Id>? AND n.Id<=? ORDER BY n.Id",
                        user,
                        after,
                        through);
        List<Map<String, Object>> items = new ArrayList<>();
        for (var r : rows) {
            items.add(
                    Map.of(
                            "id",
                            r.get("Id").toString(),
                            "kind",
                            "DIRECT_MESSAGE",
                            "roomId",
                            r.get("RoomId").toString(),
                            "sequence",
                            r.get("Sequence").toString(),
                            "title",
                            r.get("FirstName") + " " + r.get("LastName"),
                            "body",
                            "New message"));
        }
        if (forumEnabled) {
            for (var r :
                    Rows.query(
                            db,
                            "SELECT n.Id,n.TopicId,n.ReplyId,actor.FirstName,actor.LastName"
                                    + FORUM_ELIGIBLE
                                    + " AND n.UserId=? AND n.Id>? AND n.Id<=? ORDER BY n.Id",
                            user,
                            after,
                            through)) {
                items.add(
                        Map.of(
                                "id",
                                r.get("Id").toString(),
                                "kind",
                                "FORUM_REPLY",
                                "topicId",
                                r.get("TopicId").toString(),
                                "replyId",
                                r.get("ReplyId").toString(),
                                "title",
                                r.get("FirstName") + " " + r.get("LastName"),
                                "body",
                                "Նոր պատասխան ձեր թեմայում"));
            }
        }
        if (postsEnabled)
            for (var row :
                    Rows.query(
                            db,
                            "SELECT "
                                    + POST_FIELDS
                                    + POST_ELIGIBLE
                                    + " AND n.UserId=? AND n.Id>? AND n.Id<=? ORDER BY n.Id",
                            user,
                            after,
                            through)) items.add(postItem(row));
        items.sort(Comparator.comparingLong(item -> Long.parseLong(item.get("id").toString())));
        return Map.of("items", items, "nextCursor", Long.toString(through));
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
                        "SELECT TOP (20) UserId,RoomId FROM auth.ActivityNotifications WHERE Kind='DIRECT_MESSAGE' AND EmailDone=0 AND RetryAt<=? GROUP BY UserId,RoomId",
                        now)) {
            var claimed =
                    tx.execute(
                            s -> {
                                var rows =
                                        Rows.query(
                                                db,
                                                "SELECT Id FROM auth.ActivityNotifications WITH(UPDLOCK,READPAST) WHERE Kind='DIRECT_MESSAGE' AND UserId=? AND RoomId=? AND EmailDone=0 AND RetryAt<=?",
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
        if (forumEnabled) deliverForum(now);
        if (postsEnabled) deliverPosts(now);
    }

    private void deliverPosts(OffsetDateTime now) {
        for (var event :
                Rows.query(
                        db,
                        "SELECT TOP (20) Id FROM auth.ActivityNotifications WHERE Kind='POST_COMMENT' AND EmailDone=0 AND RetryAt<=? ORDER BY Id",
                        now)) {
            if (db.update(
                            "UPDATE auth.ActivityNotifications SET RetryAt=? WHERE Id=? AND Kind='POST_COMMENT' AND EmailDone=0 AND RetryAt<=?",
                            now.plusMinutes(2),
                            event.get("Id"),
                            now)
                    != 1) continue;
            try {
                var eligible =
                        Rows.query(
                                db,
                                "SELECT u.Email,n.PostId"
                                        + POST_ELIGIBLE
                                        + " AND n.Id=? AND s.EmailEnabled=1 AND n.EmailDone=0",
                                event.get("Id"));
                if (!eligible.isEmpty()) {
                    var row = eligible.getFirst();
                    mail.sendNotice(
                            (String) row.get("Email"),
                            "PolyLink: նոր մեկնաբանություն",
                            "Ձեր հայտարարության տակ կա նոր մեկնաբանություն։ Բացեք՝ "
                                    + frontend
                                    + "/post.html?id="
                                    + row.get("PostId"));
                }
                db.update(
                        "UPDATE auth.ActivityNotifications SET EmailDone=1 WHERE Id=?",
                        event.get("Id"));
            } catch (RuntimeException ignored) {
                /* At-least-once SMTP; retry after the lease expires. */
            }
        }
    }

    private void deliverForum(OffsetDateTime now) {
        for (var event :
                Rows.query(
                        db,
                        "SELECT TOP (20) Id FROM auth.ActivityNotifications WHERE Kind='FORUM_REPLY' AND EmailDone=0 AND RetryAt<=? ORDER BY Id",
                        now)) {
            if (db.update(
                            "UPDATE auth.ActivityNotifications SET RetryAt=? WHERE Id=? AND Kind='FORUM_REPLY' AND EmailDone=0 AND RetryAt<=?",
                            now.plusMinutes(2),
                            event.get("Id"),
                            now)
                    != 1) continue;
            try {
                var eligible =
                        Rows.query(
                                db,
                                "SELECT u.Email,n.TopicId,n.ReplyId"
                                        + FORUM_ELIGIBLE
                                        + " AND n.Id=? AND s.EmailEnabled=1 AND n.EmailDone=0",
                                event.get("Id"));
                if (!eligible.isEmpty()) {
                    var row = eligible.getFirst();
                    mail.sendNotice(
                            (String) row.get("Email"),
                            "PolyLink: նոր պատասխան",
                            "Ձեր թեմայում կա նոր պատասխան։ Բացեք քննարկումը՝ "
                                    + frontend
                                    + "/topic.html?id="
                                    + row.get("TopicId")
                                    + "&reply="
                                    + row.get("ReplyId"));
                }
                db.update(
                        "UPDATE auth.ActivityNotifications SET EmailDone=1 WHERE Id=?",
                        event.get("Id"));
            } catch (RuntimeException ignored) {
                /* Lease expiration retries failed SMTP deliveries. */
            }
        }
    }
}
