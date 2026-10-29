package am.polylink.posts;

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
@ConditionalOnProperty(name = "polylink.posts.enabled", havingValue = "true")
public class PostsService {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final Secrets secrets;
    private static final String AUTHOR =
            "u.FirstName,u.LastName,u.ProfilePhotoUrl,u.IsProfilePublic,a.AdmissionStatus";
    private static final String POST =
            "SELECT p.*,t.Code AS Category,t.Name AS CategoryName,s.Name AS SphereName,s.Code AS SphereCode,"
                    + AUTHOR
                    + ",(SELECT COUNT(*) FROM dbo.PostComments c WHERE c.PostId=p.PostId) AS CommentCount FROM dbo.Posts p LEFT JOIN dbo.PostTypes t ON t.PostTypeId=p.PostTypeId LEFT JOIN dbo.Spheres s ON s.SphereId=p.SphereId LEFT JOIN dbo.Users u ON u.UserId=p.UserId LEFT JOIN auth.AccountSecurity a ON a.UserId=p.UserId";
    private static final String COMMENT =
            "SELECT c.*,"
                    + AUTHOR
                    + " FROM dbo.PostComments c LEFT JOIN dbo.Users u ON u.UserId=c.UserId LEFT JOIN auth.AccountSecurity a ON a.UserId=c.UserId";

    public PostsService(
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

    public void requireAccess(Accounts.Account account, boolean write) {
        account.requireAdmitted();
        if (write && !Set.of("graduate", "lecturer").contains(account.role()))
            throw PostsFailure.forbidden();
    }

    public Map<String, Object> options() {
        return Map.of(
                "types",
                Rows.query(db, "SELECT Code,Name FROM dbo.PostTypes ORDER BY PostTypeId").stream()
                        .map(r -> Map.of("code", r.get("Code"), "name", r.get("Name")))
                        .toList(),
                "spheres",
                Rows.query(
                                db,
                                "SELECT Code,Name FROM dbo.Spheres ORDER BY CASE WHEN Code='other' THEN 1 ELSE 0 END,Name,SphereId")
                        .stream()
                        .map(r -> Map.of("code", r.get("Code"), "name", r.get("Name")))
                        .toList());
    }

    public Map<String, Object> list(
            int user, String category, String sphere, String author, String cursor) {
        var args = new ArrayList<Object>();
        String where = " WHERE 1=1";
        if (!category.isEmpty()) {
            where += " AND p.PostTypeId=?";
            args.add(type(category));
        }
        if (!sphere.isEmpty()) {
            where += " AND p.SphereId=?";
            args.add(sphere(sphere));
        }
        if (!author.isEmpty()) {
            where += " AND p.UserId=?";
            args.add(id(author, "userId"));
        }
        String scope = "feed:" + category + ":" + sphere + ":" + author;
        var next = cursor(cursor, scope);
        if (next != null) {
            where += " AND (p.CreatedAtUtc<? OR (p.CreatedAtUtc=? AND p.PostId<?))";
            args.add(next.time());
            args.add(next.time());
            args.add(next.id());
        }
        return page(
                Rows.query(
                        db,
                        POST
                                + where
                                + " ORDER BY p.CreatedAtUtc DESC,p.PostId DESC OFFSET 0 ROWS FETCH NEXT 21 ROWS ONLY",
                        args.toArray()),
                scope,
                user,
                false);
    }

    public Map<String, Object> get(int user, int post) {
        return view(one(Rows.query(db, POST + " WHERE p.PostId=?", post)), user, false);
    }

    public Map<String, Object> comments(int user, int post, String cursor) {
        parent(post, false);
        String scope = "comments:" + post;
        var next = cursor(cursor, scope);
        var args = new ArrayList<Object>();
        args.add(post);
        String where = " WHERE c.PostId=?";
        if (next != null) {
            where += " AND (c.CreatedAtUtc>? OR (c.CreatedAtUtc=? AND c.CommentId>?))";
            args.add(next.time());
            args.add(next.time());
            args.add(next.id());
        }
        return page(
                Rows.query(
                        db,
                        COMMENT
                                + where
                                + " ORDER BY c.CreatedAtUtc,c.CommentId OFFSET 0 ROWS FETCH NEXT 21 ROWS ONLY",
                        args.toArray()),
                scope,
                user,
                true);
    }

    private Map<String, Object> comment(int user, int post, int id) {
        return view(
                one(Rows.query(db, COMMENT + " WHERE c.PostId=? AND c.CommentId=?", post, id)),
                user,
                true);
    }

    private Map<String, Object> page(
            List<Map<String, Object>> rows, String scope, int user, boolean comment) {
        boolean more = rows.size() > 20;
        var visible = more ? rows.subList(0, 20) : rows;
        var result = new LinkedHashMap<String, Object>();
        result.put("items", visible.stream().map(r -> view(r, user, comment)).toList());
        result.put("nextCursor", more ? encode(scope, visible.getLast(), comment) : null);
        return result;
    }

    private Map<String, Object> view(Map<String, Object> row, int user, boolean comment) {
        int owner = ((Number) row.get("UserId")).intValue();
        boolean deleted =
                "DELETED".equals(row.get("AdmissionStatus")) || row.get("FirstName") == null;
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
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get(comment ? "CommentId" : "PostId").toString());
        result.put("author", author);
        result.put("createdAt", row.get("CreatedAtUtc").toString());
        result.put(
                "updatedAt",
                row.get("UpdatedAtUtc") == null ? null : row.get("UpdatedAtUtc").toString());
        result.put("canEdit", !deleted && owner == user);
        result.put("canDelete", !deleted && owner == user);
        if (comment) {
            result.put("postId", row.get("PostId").toString());
            result.put("text", row.get("Content"));
        } else {
            String title = (String) row.get("Title");
            result.put("title", title == null || PostsContent.trim(title).isEmpty() ? null : title);
            result.put("content", PostsContent.sanitize((String) row.get("Content")));
            result.put("category", row.get("Category"));
            result.put("categoryName", row.get("CategoryName"));
            result.put("sphereCode", row.get("SphereCode"));
            result.put("sphereName", row.get("SphereName"));
            result.put("commentCount", row.get("CommentCount"));
        }
        return result;
    }

    private record Input(String title, String content, int type, int sphere) {}

    private Input input(Map<String, Object> input) {
        fields(input, Set.of("title", "content", "category", "sphereCode"));
        return new Input(
                PostsContent.title(input.get("title")),
                PostsContent.content(input.get("content")),
                type(input.get("category")),
                sphere(input.get("sphereCode")));
    }

    private int type(Object value) {
        return reference(value, "category", "PostTypes", "PostTypeId", 16);
    }

    private int sphere(Object value) {
        return reference(value, "sphereCode", "Spheres", "SphereId", 32);
    }

    private int reference(Object value, String field, String table, String key, int max) {
        if (!(value instanceof String code)
                || code.length() > max
                || !code.matches("[a-z][a-z0-9]*(?:-[a-z0-9]+)*"))
            throw PostsFailure.invalid(field, "Ընտրեք վավեր արժեք։");
        var ids =
                db.queryForList(
                        "SELECT " + key + " FROM dbo." + table + " WHERE Code=?",
                        Integer.class,
                        code);
        if (ids.size() != 1) throw PostsFailure.invalid(field, "Ընտրեք վավեր արժեք։");
        return ids.getFirst();
    }

    public static int id(Object value, String field) {
        try {
            if (!(value instanceof String s) || !s.matches("[1-9][0-9]{0,9}"))
                throw new IllegalArgumentException();
            return Integer.parseInt(s);
        } catch (IllegalArgumentException e) {
            throw PostsFailure.invalid(field, "Անվավեր նույնացուցիչ։");
        }
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
    }

    // Account locks precede parent/child locks, matching account lifecycle. Never lock accounts
    // after a post.
    private <T> T write(int user, Integer post, Supplier<T> operation) {
        Integer discovered =
                post == null ? null : ((Number) parent(post, false).get("UserId")).intValue();
        return tx.execute(
                s -> {
                    var people = new TreeSet<Integer>();
                    people.add(user);
                    if (discovered != null) people.add(discovered);
                    for (int person : people)
                        db.queryForList(
                                "SELECT UserId FROM auth.AccountSecurity WITH(UPDLOCK,HOLDLOCK) WHERE UserId=?",
                                person);
                    requireAccess(accounts.get(user), true);
                    if (post != null) {
                        var locked = parent(post, true);
                        if (!Objects.equals(locked.get("UserId"), discovered))
                            throw PostsFailure.missing();
                    }
                    return operation.get();
                });
    }

    public Map<String, Object> create(int user, Map<String, Object> fields) {
        var input = input(fields);
        return write(
                user,
                null,
                () -> {
                    var time = now();
                    int id =
                            db.queryForObject(
                                    "INSERT dbo.Posts(UserId,Title,Content,PostTypeId,SphereId,CreatedAtUtc) OUTPUT INSERTED.PostId VALUES (?,?,?,?,?,?)",
                                    Integer.class,
                                    user,
                                    input.title(),
                                    input.content(),
                                    input.type(),
                                    input.sphere(),
                                    time);
                    return get(user, id);
                });
    }

    public Map<String, Object> update(int user, int post, Map<String, Object> fields) {
        var input = input(fields);
        return write(
                user,
                post,
                () -> {
                    var row = parent(post, true);
                    own(row, user);
                    if (!Objects.equals(input.title(), row.get("Title"))
                            || !Objects.equals(input.content(), row.get("Content"))
                            || !Objects.equals(input.type(), row.get("PostTypeId"))
                            || !Objects.equals(input.sphere(), row.get("SphereId")))
                        db.update(
                                "UPDATE dbo.Posts SET Title=?,Content=?,PostTypeId=?,SphereId=?,UpdatedAtUtc=? WHERE PostId=?",
                                input.title(),
                                input.content(),
                                input.type(),
                                input.sphere(),
                                now(),
                                post);
                    return get(user, post);
                });
    }

    public void delete(int user, int post) {
        write(
                user,
                post,
                () -> {
                    own(parent(post, true), user);
                    db.update(
                            "DELETE auth.ActivityNotifications WHERE Kind='POST_COMMENT' AND PostId=?",
                            post);
                    db.update("DELETE dbo.PostComments WHERE PostId=?", post);
                    db.update("DELETE dbo.Posts WHERE PostId=?", post);
                    return null;
                });
    }

    public Map<String, Object> createComment(int user, int post, Map<String, Object> input) {
        fields(input, Set.of("text"));
        String text = PostsContent.comment(input.get("text"));
        return write(
                user,
                post,
                () -> {
                    int recipient = ((Number) parent(post, true).get("UserId")).intValue();
                    var time = now();
                    int id =
                            db.queryForObject(
                                    "INSERT dbo.PostComments(PostId,UserId,Content,CreatedAtUtc) OUTPUT INSERTED.CommentId VALUES (?,?,?,?)",
                                    Integer.class,
                                    post,
                                    user,
                                    text,
                                    time);
                    if (recipient != user)
                        db.update(
                                "INSERT auth.ActivityNotifications(UserId,Kind,EventKey,ActorId,PostId,CommentId,CreatedAt,RetryAt) SELECT ?,'POST_COMMENT',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM auth.AccountSecurity WHERE UserId=? AND AdmissionStatus='ADMITTED' AND EmailVerifiedAt IS NOT NULL)",
                                recipient,
                                "post-comment:" + id,
                                user,
                                post,
                                id,
                                time,
                                time,
                                recipient);
                    return comment(user, post, id);
                });
    }

    public Map<String, Object> updateComment(
            int user, int post, int id, Map<String, Object> input) {
        fields(input, Set.of("text"));
        String text = PostsContent.comment(input.get("text"));
        return write(
                user,
                post,
                () -> {
                    var row = lockedComment(post, id);
                    own(row, user);
                    if (!text.equals(row.get("Content")))
                        db.update(
                                "UPDATE dbo.PostComments SET Content=?,UpdatedAtUtc=? WHERE PostId=? AND CommentId=?",
                                text,
                                now(),
                                post,
                                id);
                    return comment(user, post, id);
                });
    }

    public void deleteComment(int user, int post, int id) {
        write(
                user,
                post,
                () -> {
                    own(lockedComment(post, id), user);
                    db.update(
                            "DELETE auth.ActivityNotifications WHERE Kind='POST_COMMENT' AND PostId=? AND CommentId=?",
                            post,
                            id);
                    db.update("DELETE dbo.PostComments WHERE PostId=? AND CommentId=?", post, id);
                    return null;
                });
    }

    private Map<String, Object> parent(int post, boolean lock) {
        return one(
                Rows.query(
                        db,
                        "SELECT * FROM dbo.Posts"
                                + (lock ? " WITH(UPDLOCK,HOLDLOCK)" : "")
                                + " WHERE PostId=?",
                        post));
    }

    private Map<String, Object> lockedComment(int post, int id) {
        return one(
                Rows.query(
                        db,
                        "SELECT * FROM dbo.PostComments WITH(UPDLOCK,HOLDLOCK) WHERE PostId=? AND CommentId=?",
                        post,
                        id));
    }

    private static Map<String, Object> one(List<Map<String, Object>> rows) {
        if (rows.isEmpty()) throw PostsFailure.missing();
        return rows.getFirst();
    }

    private static void own(Map<String, Object> row, int user) {
        if (((Number) row.get("UserId")).intValue() != user) throw PostsFailure.forbidden();
    }

    private static void fields(Map<String, Object> input, Set<String> allowed) {
        for (String key : input.keySet())
            if (!allowed.contains(key)) throw PostsFailure.invalid(key, "Անհայտ դաշտ։");
    }

    private record Cursor(int id, OffsetDateTime time) {}

    private String encode(String scope, Map<String, Object> row, boolean comment) {
        String payload =
                scope
                        + "\n"
                        + row.get(comment ? "CommentId" : "PostId")
                        + "\n"
                        + row.get("CreatedAtUtc");
        return Secrets.encode(payload.getBytes(StandardCharsets.UTF_8))
                + "."
                + Secrets.encode(secrets.mac("posts-cursor", payload));
    }

    private Cursor cursor(String cursor, String scope) {
        if (cursor == null || cursor.isEmpty()) return null;
        try {
            if (cursor.length() > 1000) throw new IllegalArgumentException();
            String[] parts = cursor.split("\\.", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            String payload =
                    new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            if (!Secrets.equal(secrets.mac("posts-cursor", payload), Secrets.decode(parts[1], 32)))
                throw new IllegalArgumentException();
            String[] fields = payload.split("\n", -1);
            if (fields.length != 3 || !fields[0].equals(scope))
                throw new IllegalArgumentException();
            return new Cursor(id(fields[1], "cursor"), OffsetDateTime.parse(fields[2]));
        } catch (RuntimeException e) {
            throw PostsFailure.invalid("cursor", "Անվավեր էջի հղում։ Թարմացրեք ցուցակը։");
        }
    }
}
