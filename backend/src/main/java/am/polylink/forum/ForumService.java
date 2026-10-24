package am.polylink.forum;

import am.polylink.auth.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.forum.enabled", havingValue = "true")
public class ForumService {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Secrets secrets;
    private static final String TOPIC =
            "SELECT t.*,c.Code,c.Name AS CategoryName,u.FirstName,u.LastName,u.ProfilePhotoUrl,u.IsProfilePublic,a.AdmissionStatus,(SELECT COUNT(*) FROM dbo.ForumReplies r WHERE r.TopicId=t.TopicId) AS ReplyCount FROM dbo.ForumTopics t JOIN dbo.ForumCategories c ON c.CategoryId=t.CategoryId JOIN dbo.Users u ON u.UserId=t.UserId LEFT JOIN auth.AccountSecurity a ON a.UserId=u.UserId";
    private static final String REPLY =
            "SELECT r.*,t.UserId AS TopicAuthorId,u.FirstName,u.LastName,u.ProfilePhotoUrl,u.IsProfilePublic,a.AdmissionStatus,(SELECT COUNT(*) FROM dbo.ForumReplyLikes l WHERE l.ReplyId=r.ReplyId) AS LikeCount,CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.ForumReplyLikes l WHERE l.ReplyId=r.ReplyId AND l.UserId=?) THEN 1 ELSE 0 END AS bit) AS Liked FROM dbo.ForumReplies r JOIN dbo.ForumTopics t ON t.TopicId=r.TopicId JOIN dbo.Users u ON u.UserId=r.UserId LEFT JOIN auth.AccountSecurity a ON a.UserId=u.UserId";

    public ForumService(
            JdbcTemplate db,
            Accounts accounts,
            TransactionTemplate tx,
            Clock clock,
            Secrets secrets) {
        this.db = db;
        this.accounts = accounts;
        this.tx = tx;
        this.clock = clock;
        this.secrets = secrets;
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 600000)
    public void expireCreateRequests() {
        db.update(
                "DELETE TOP (1000) FROM forum.CreateRequests WHERE CreatedAt<?",
                now().minusHours(24));
    }

    /** Admission is set only by registry enrollment or the grandfathered rollout policy. */
    public void requireAccess(Accounts.Account account) {
        account.requireAdmitted();
        if (!Set.of("graduate", "lecturer").contains(account.role()))
            throw ForumFailure.forbidden();
    }

    public List<Map<String, Object>> categories() {
        return Rows.query(
                        db,
                        "SELECT CategoryId,Code,Name FROM dbo.ForumCategories ORDER BY CategoryId")
                .stream()
                .map(
                        r ->
                                Map.<String, Object>of(
                                        "id",
                                        r.get("CategoryId").toString(),
                                        "code",
                                        r.get("Code"),
                                        "name",
                                        r.get("Name")))
                .toList();
    }

    private int category(Object value) {
        if (!(value instanceof String code) || !code.matches("[a-z][a-z0-9_-]{0,31}"))
            throw ForumFailure.invalid("categoryCode", "Ընտրեք կատեգորիան։");
        var ids =
                db.queryForList(
                        "SELECT CategoryId FROM dbo.ForumCategories WHERE Code=?",
                        Integer.class,
                        code);
        if (ids.isEmpty()) throw ForumFailure.invalid("categoryCode", "Անվավեր կատեգորիա։");
        return ids.getFirst();
    }

    public Map<String, Object> topics(int user, String category, String cursor, int limit) {
        pageLimit(limit);
        var args = new ArrayList<Object>();
        String where = " WHERE 1=1";
        if (!category.isEmpty()) {
            where += " AND t.CategoryId=?";
            args.add(category(category));
        }
        var next = cursor(cursor, "topics:" + category);
        if (next != null) {
            where += " AND (t.CreatedAtUtc<? OR (t.CreatedAtUtc=? AND t.TopicId<?))";
            args.add(next.time());
            args.add(next.time());
            args.add(next.id());
        }
        var rows =
                Rows.query(
                        db,
                        TOPIC
                                + where
                                + " ORDER BY t.CreatedAtUtc DESC,t.TopicId DESC OFFSET 0 ROWS FETCH NEXT "
                                + (limit + 1)
                                + " ROWS ONLY",
                        args.toArray());
        return page(rows, limit, "topics:" + category, user, false);
    }

    public Map<String, Object> topic(int user, int id) {
        return view(one(Rows.query(db, TOPIC + " WHERE t.TopicId=?", id)), user, false);
    }

    public Map<String, Object> replies(int user, int topic, String sort, String cursor, int limit) {
        pageLimit(limit);
        if (!Set.of("newest", "oldest", "popular").contains(sort))
            throw ForumFailure.invalid("sort", "Անվավեր դասավորում։");
        existsTopic(topic, false);
        var args = new ArrayList<Object>();
        args.add(user);
        args.add(topic);
        String where = " WHERE r.TopicId=?";
        String direction = sort.equals("oldest") ? "ASC" : "DESC";
        String comparison = sort.equals("oldest") ? ">" : "<";
        String scope = "replies:" + topic + ":" + sort;
        var next = cursor(cursor, scope);
        // Derived counts are evaluated before the outer paging predicate.
        if (next != null) {
            where = " WHERE q.TopicId=? AND ";
            String date =
                    "(q.CreatedAtUtc"
                            + comparison
                            + "? OR (q.CreatedAtUtc=? AND q.ReplyId"
                            + comparison
                            + "?))";
            if (sort.equals("popular")) {
                where += "(q.LikeCount<? OR (q.LikeCount=? AND " + date + "))";
                args.add(next.likes());
                args.add(next.likes());
            } else where += date;
            args.add(next.time());
            args.add(next.time());
            args.add(next.id());
        } else where = " WHERE q.TopicId=?";
        var rows =
                Rows.query(
                        db,
                        "SELECT q.* FROM ("
                                + REPLY
                                + ") q"
                                + where
                                + " ORDER BY "
                                + (sort.equals("popular") ? "q.LikeCount DESC," : "")
                                + "q.CreatedAtUtc "
                                + direction
                                + ",q.ReplyId "
                                + direction
                                + " OFFSET 0 ROWS FETCH NEXT "
                                + (limit + 1)
                                + " ROWS ONLY",
                        args.toArray());
        return page(rows, limit, scope, user, true);
    }

    private Map<String, Object> page(
            List<Map<String, Object>> rows, int limit, String scope, int user, boolean reply) {
        boolean more = rows.size() > limit;
        var visible = more ? rows.subList(0, limit) : rows;
        var result = new LinkedHashMap<String, Object>();
        result.put("items", visible.stream().map(r -> view(r, user, reply)).toList());
        result.put("nextCursor", more ? encode(scope, visible.getLast(), reply) : null);
        return result;
    }

    private Map<String, Object> view(Map<String, Object> row, int user, boolean reply) {
        boolean deleted = "DELETED".equals(row.get("AdmissionStatus"));
        int owner = ((Number) row.get("UserId")).intValue();
        var author = new LinkedHashMap<String, Object>();
        author.put("id", deleted ? null : "" + owner);
        author.put(
                "name",
                deleted ? "Ջնջված օգտատեր" : row.get("FirstName") + " " + row.get("LastName"));
        author.put(
                "avatar",
                deleted || row.get("ProfilePhotoUrl") == null ? "" : row.get("ProfilePhotoUrl"));
        author.put(
                "canOpenProfile",
                !deleted
                        && "ADMITTED".equals(row.get("AdmissionStatus"))
                        && (owner == user || Boolean.TRUE.equals(row.get("IsProfilePublic"))));
        String content = ForumContent.sanitize((String) row.get("Content"));
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get(reply ? "ReplyId" : "TopicId").toString());
        result.put("content", content);
        result.put("author", author);
        result.put("createdAt", row.get("CreatedAtUtc").toString());
        result.put(
                "updatedAt",
                row.get("UpdatedAtUtc") == null ? null : row.get("UpdatedAtUtc").toString());
        result.put("version", row.get("ContentVersion").toString());
        result.put("canEdit", !deleted && owner == user);
        result.put("canDelete", !deleted && owner == user);
        if (reply) {
            result.put("topicId", row.get("TopicId").toString());
            result.put("likeCount", row.get("LikeCount"));
            result.put("liked", row.get("Liked"));
            result.put(
                    "isTopicAuthor", Objects.equals(row.get("UserId"), row.get("TopicAuthorId")));
        } else {
            result.put("title", row.get("Title"));
            result.put("categoryCode", row.get("Code"));
            result.put("categoryName", row.get("CategoryName"));
            String plain = ForumContent.plain(content);
            result.put("excerpt", plain.substring(0, Math.min(plain.length(), 220)));
            result.put("replyCount", row.get("ReplyCount"));
        }
        return result;
    }

    public Map<String, Object> reply(int user, int id) {
        return view(one(Rows.query(db, REPLY + " WHERE r.ReplyId=?", user, id)), user, true);
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
    }

    private <T> T write(int user, Supplier<T> operation) {
        return tx.execute(
                s -> {
                    requireAccess(accounts.lock(user));
                    return operation.get();
                });
    }

    public Map<String, Object> createTopic(int user, Map<String, Object> input) {
        fields(input, Set.of("title", "content", "categoryCode", "requestId"));
        String title = ForumContent.title(input.get("title")),
                content = ForumContent.content(input.get("content"));
        int category = category(input.get("categoryCode"));
        UUID request = request(input.get("requestId"));
        String fingerprint = fingerprint(List.of(title, content, category));
        return write(
                user,
                () -> {
                    Integer replay = replay(user, "topic", request, fingerprint);
                    if (replay != null) return topic(user, replay);
                    var time = now();
                    int id =
                            db.queryForObject(
                                    "INSERT dbo.ForumTopics(UserId,Title,Content,CategoryId,CreatedAt,CreatedAtUtc) OUTPUT INSERTED.TopicId VALUES (?,?,?,?,?,?)",
                                    Integer.class,
                                    user,
                                    title,
                                    content,
                                    category,
                                    time.toLocalDateTime(),
                                    time);
                    remember(user, "topic", request, fingerprint, id);
                    return topic(user, id);
                });
    }

    public Map<String, Object> createReply(int user, int topic, Map<String, Object> input) {
        fields(input, Set.of("content", "requestId"));
        String content = ForumContent.content(input.get("content"));
        UUID request = request(input.get("requestId"));
        String fingerprint = fingerprint(List.of(topic, content));
        return write(
                user,
                () -> {
                    Integer replay = replay(user, "reply", request, fingerprint);
                    if (replay != null) return reply(user, replay);
                    var parent = existsTopic(topic, true);
                    var time = now();
                    int id =
                            db.queryForObject(
                                    "INSERT dbo.ForumReplies(TopicId,UserId,Content,CreatedAt,CreatedAtUtc) OUTPUT INSERTED.ReplyId VALUES (?,?,?,?,?)",
                                    Integer.class,
                                    topic,
                                    user,
                                    content,
                                    time.toLocalDateTime(),
                                    time);
                    remember(user, "reply", request, fingerprint, id);
                    int recipient = ((Number) parent.get("UserId")).intValue();
                    if (recipient != user)
                        db.update(
                                "INSERT auth.ActivityNotifications(UserId,Kind,EventKey,ActorId,TopicId,ReplyId,CreatedAt,RetryAt) SELECT ?,'FORUM_REPLY',?,?, ?,?,?,? WHERE EXISTS(SELECT 1 FROM auth.AccountSecurity WHERE UserId=? AND AdmissionStatus='ADMITTED')",
                                recipient,
                                "forum-reply:" + id,
                                user,
                                topic,
                                id,
                                time,
                                time,
                                recipient);
                    return reply(user, id);
                });
    }

    public Map<String, Object> updateTopic(int user, int id, Map<String, Object> input) {
        fields(input, Set.of("title", "content", "categoryCode", "expectedVersion"));
        if (input.size() < 2) throw ForumFailure.invalid("content", "Փոփոխություն նշված չէ։");
        long version = version(input.get("expectedVersion"));
        return write(
                user,
                () -> {
                    var row = existsTopic(id, true);
                    own(row, user, version);
                    db.update(
                            "UPDATE dbo.ForumTopics SET Title=?,Content=?,CategoryId=?,ContentVersion=ContentVersion+1,UpdatedAtUtc=? WHERE TopicId=?",
                            input.containsKey("title")
                                    ? ForumContent.title(input.get("title"))
                                    : row.get("Title"),
                            input.containsKey("content")
                                    ? ForumContent.content(input.get("content"))
                                    : row.get("Content"),
                            input.containsKey("categoryCode")
                                    ? category(input.get("categoryCode"))
                                    : row.get("CategoryId"),
                            now(),
                            id);
                    return topic(user, id);
                });
    }

    public Map<String, Object> updateReply(int user, int id, Map<String, Object> input) {
        fields(input, Set.of("content", "expectedVersion"));
        String content = ForumContent.content(input.get("content"));
        long version = version(input.get("expectedVersion"));
        return write(
                user,
                () -> {
                    var row = lockReply(id);
                    own(row, user, version);
                    db.update(
                            "UPDATE dbo.ForumReplies SET Content=?,ContentVersion=ContentVersion+1,UpdatedAtUtc=? WHERE ReplyId=?",
                            content,
                            now(),
                            id);
                    return reply(user, id);
                });
    }

    public void deleteTopic(int user, int id, String version) {
        long expected = version(version);
        write(
                user,
                () -> {
                    own(existsTopic(id, true), user, expected);
                    ForumMaintenanceCommand.deleteTopic(db, id);
                    return null;
                });
    }

    public void deleteReply(int user, int id, String version) {
        long expected = version(version);
        write(
                user,
                () -> {
                    own(lockReply(id), user, expected);
                    db.update(
                            "DELETE auth.ActivityNotifications WHERE Kind='FORUM_REPLY' AND ReplyId=?",
                            id);
                    db.update("DELETE dbo.ForumReplyLikes WHERE ReplyId=?", id);
                    db.update("DELETE dbo.ForumReplies WHERE ReplyId=?", id);
                    return null;
                });
    }

    public Map<String, Object> like(int user, int id, Map<String, Object> input) {
        fields(input, Set.of("liked"));
        if (!(input.get("liked") instanceof Boolean liked))
            throw ForumFailure.invalid("liked", "Անվավեր արժեք։");
        return write(
                user,
                () -> {
                    lockReply(id);
                    db.update("DELETE dbo.ForumReplyLikes WHERE ReplyId=? AND UserId=?", id, user);
                    if (liked)
                        db.update(
                                "INSERT dbo.ForumReplyLikes(UserId,ReplyId,CreatedAt) VALUES (?,?,?)",
                                user,
                                id,
                                now().toLocalDateTime());
                    return reply(user, id);
                });
    }

    private Map<String, Object> existsTopic(int id, boolean lock) {
        return one(
                Rows.query(
                        db,
                        "SELECT * FROM dbo.ForumTopics"
                                + (lock ? " WITH(UPDLOCK,HOLDLOCK)" : "")
                                + " WHERE TopicId=?",
                        id));
    }

    private Map<String, Object> lockReply(int id) {
        var initial =
                one(Rows.query(db, "SELECT TopicId FROM dbo.ForumReplies WHERE ReplyId=?", id));
        existsTopic(((Number) initial.get("TopicId")).intValue(), true);
        return one(
                Rows.query(
                        db,
                        "SELECT * FROM dbo.ForumReplies WITH(UPDLOCK,HOLDLOCK) WHERE ReplyId=?",
                        id));
    }

    private static Map<String, Object> one(List<Map<String, Object>> rows) {
        if (rows.isEmpty()) throw ForumFailure.missing();
        return rows.getFirst();
    }

    private static void own(Map<String, Object> row, int user, long version) {
        if (((Number) row.get("UserId")).intValue() != user) throw ForumFailure.forbidden();
        if (((Number) row.get("ContentVersion")).longValue() != version) throw ForumFailure.stale();
    }

    private static long version(Object value) {
        try {
            if (!(value instanceof String s) || !s.matches("[1-9][0-9]{0,18}"))
                throw new IllegalArgumentException();
            return Long.parseLong(s);
        } catch (IllegalArgumentException e) {
            throw ForumFailure.invalid("expectedVersion", "Պահանջվում է վավեր տարբերակ։");
        }
    }

    private static UUID request(Object value) {
        try {
            if (!(value instanceof String s)) throw new IllegalArgumentException();
            var id = UUID.fromString(s);
            if (!id.toString().equals(s)) throw new IllegalArgumentException();
            return id;
        } catch (IllegalArgumentException e) {
            throw ForumFailure.invalid("requestId", "Պահանջվում է հարցման UUID։");
        }
    }

    private static void fields(Map<String, Object> input, Set<String> allowed) {
        for (String key : input.keySet())
            if (!allowed.contains(key)) throw ForumFailure.invalid(key, "Անհայտ դաշտ։");
    }

    private String fingerprint(List<?> values) {
        return HexFormat.of()
                .formatHex(
                        Secrets.hash(
                                values.stream()
                                        .map(v -> v.toString().length() + ":" + v)
                                        .reduce("", String::concat)));
    }

    private Integer replay(int user, String operation, UUID key, String fingerprint) {
        db.update(
                "DELETE forum.CreateRequests WHERE UserId=? AND CreatedAt<?",
                user,
                now().minusHours(24));
        var rows =
                Rows.query(
                        db,
                        "SELECT Fingerprint,ResourceId FROM forum.CreateRequests WHERE UserId=? AND Operation=? AND RequestId=?",
                        user,
                        operation,
                        key);
        if (rows.isEmpty()) return null;
        if (!rows.getFirst().get("Fingerprint").equals(fingerprint))
            throw ForumFailure.requestConflict();
        return ((Number) rows.getFirst().get("ResourceId")).intValue();
    }

    private void remember(int user, String op, UUID key, String fingerprint, int id) {
        db.update(
                "INSERT forum.CreateRequests VALUES (?,?,?,?,?,?)",
                user,
                op,
                key,
                fingerprint,
                id,
                now());
    }

    private static void pageLimit(int limit) {
        if (limit < 1 || limit > 100)
            throw ForumFailure.invalid("limit", "Էջի չափը պետք է լինի 1–100։");
    }

    private record Cursor(int id, OffsetDateTime time, int likes) {}

    private String encode(String scope, Map<String, Object> row, boolean reply) {
        String payload =
                scope
                        + "\n"
                        + row.get(reply ? "ReplyId" : "TopicId")
                        + "\n"
                        + row.get("CreatedAtUtc")
                        + "\n"
                        + (reply ? row.get("LikeCount") : 0);
        return Secrets.encode(payload.getBytes(StandardCharsets.UTF_8))
                + "."
                + Secrets.encode(secrets.mac("forum-cursor", payload));
    }

    private Cursor cursor(String cursor, String scope) {
        if (cursor == null || cursor.isEmpty()) return null;
        try {
            if (cursor.length() > 1000) throw new IllegalArgumentException();
            String[] parts = cursor.split("\\.", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            String payload =
                    new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            if (!Secrets.equal(secrets.mac("forum-cursor", payload), Secrets.decode(parts[1], 32)))
                throw new IllegalArgumentException();
            String[] fields = payload.split("\n", -1);
            if (fields.length != 4 || !fields[0].equals(scope))
                throw new IllegalArgumentException();
            int id = Integer.parseInt(fields[1]), likes = Integer.parseInt(fields[3]);
            if (id < 1 || likes < 0) throw new IllegalArgumentException();
            return new Cursor(id, OffsetDateTime.parse(fields[2]), likes);
        } catch (RuntimeException e) {
            throw ForumFailure.invalid("cursor", "Անվավեր էջի հղում։ Թարմացրեք ցուցակը։");
        }
    }
}
