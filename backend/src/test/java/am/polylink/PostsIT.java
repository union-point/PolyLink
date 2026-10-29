package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import am.polylink.posts.PostsService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.posts.enabled=true",
            "polylink.forum.enabled=false",
            "polylink.messenger.enabled=false",
            "polylink.frontend-origins=http://localhost:8001"
        })
class PostsIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired PostsService posts;
    @Autowired Accounts accounts;
    @Autowired Secrets secrets;
    @Autowired am.polylink.settings.NotificationService notifications;
    @Autowired am.polylink.chat.AccountLifecycle lifecycle;
    final IdentityIT fixture = new IdentityIT();

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry registry) {
        IdentityIT.configuration(registry);
    }

    @BeforeEach
    void initialize() {
        fixture.port = port;
        fixture.db = db;
        fixture.mapper = mapper;
        db.update("DELETE auth.RateLimits");
    }

    JsonNode call(IdentityIT.Enrolled user, String method, String path, Object input, int expected)
            throws Exception {
        var response =
                user.browser()
                        .call(
                                method,
                                path,
                                input == null && !method.equals("GET") ? Map.of() : input);
        assertThat(response.statusCode())
                .as(method + " " + path + ": " + response.body())
                .isEqualTo(expected);
        return expected == 204 ? mapper.createObjectNode() : user.browser().json(response);
    }

    Map<String, Object> input() {
        return new LinkedHashMap<>(
                Map.of(
                        "title",
                        "Հայտարարություն",
                        "content",
                        "<p><b>Բարև 😀</b><img src=x onerror=bad()></p>",
                        "category",
                        "job",
                        "sphereCode",
                        db.queryForObject(
                                "SELECT Code FROM dbo.Spheres WHERE Code='other'", String.class)));
    }

    int uid(IdentityIT.Enrolled user) {
        return user.id();
    }

    @Test
    void ownershipAndMandatoryFieldsAreEnforcedOnEverySurface() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        assertThat(fixture.new Browser().get("/posts/options").statusCode()).isEqualTo(401);
        assertThat(call(a, "GET", "/posts/options", null, 200).path("types").size()).isEqualTo(3);
        var post = call(a, "POST", "/posts", input(), 201);
        String id = post.path("id").asText();
        assertThat(post.path("content").asText()).contains("<b>").doesNotContain("<img");
        assertThat(post.has("comments")).isFalse();
        var forged = input();
        forged.put("userId", b.id());
        call(a, "POST", "/posts", forged, 400);
        for (String field : List.of("title", "content", "category", "sphereCode")) {
            var missing = input();
            missing.remove(field);
            call(a, "POST", "/posts", missing, 400);
            call(a, "PUT", "/posts/" + id, missing, 400);
        }
        call(b, "PUT", "/posts/" + id, input(), 403);
        call(b, "DELETE", "/posts/" + id, null, 403);
        call(a, "GET", "/posts?category=unsupported", null, 400);
        call(a, "GET", "/posts?sphereCode=999999", null, 400);
        call(a, "GET", "/posts?sphereCode=unknown-direction", null, 400);
        call(a, "GET", "/posts?sphereId=1", null, 400);
        var oldSelector = input();
        oldSelector.put("sphereId", "1");
        call(a, "POST", "/posts", oldSelector, 400);
        var unknownSphere = input();
        unknownSphere.put("sphereCode", "unknown-direction");
        call(a, "POST", "/posts", unknownSphere, 400);
        assertThat(post.path("sphereCode").asText()).isEqualTo("other");
        assertThat(post.has("sphereId")).isFalse();
        call(a, "GET", "/posts?userId=invalid", null, 400);
        call(a, "GET", "/posts?sphere=other", null, 400);
        var c =
                call(
                        b,
                        "POST",
                        "/posts/" + id + "/comments",
                        Map.of("text", "<b>plain</b>\nline"),
                        201);
        String cid = c.path("id").asText();
        assertThat(c.path("text").asText()).isEqualTo("<b>plain</b>\nline");
        call(a, "PUT", "/posts/" + id + "/comments/" + cid, Map.of("text", "forged"), 403);
        call(a, "DELETE", "/posts/" + id + "/comments/" + cid, null, 403);
        var other = call(a, "POST", "/posts", input(), 201).path("id").asText();
        call(b, "PUT", "/posts/" + other + "/comments/" + cid, Map.of("text", "wrong parent"), 404);
        call(b, "PUT", "/posts/" + id + "/comments/" + cid, Map.of("text", "edited"), 200);
        call(b, "DELETE", "/posts/" + id + "/comments/" + cid, null, 204);
        call(a, "DELETE", "/posts/" + id, null, 204);
        call(a, "GET", "/posts/" + id, null, 404);
        call(b, "POST", "/posts/" + id + "/comments", Map.of("text", "late"), 404);
        call(a, "PUT", "/posts/" + id, input(), 404);
    }

    @Test
    void feedAndCommentsPageWithTiesAndScopedCursors() throws Exception {
        var a = fixture.enroll("graduate");
        int user = uid(a);
        var data = input();
        var ids = new HashSet<String>();
        for (int i = 0; i < 45; i++) ids.add(posts.create(user, data).get("id").toString());
        db.update(
                "UPDATE dbo.Posts SET CreatedAtUtc='2025-01-01T00:00:00.1234567Z' WHERE UserId=?",
                user);
        String cursor = "";
        var seen = new ArrayList<String>();
        int page = 0;
        do {
            var result =
                    posts.list(user, "job", data.get("sphereCode").toString(), "" + a.id(), cursor);
            var items = (List<Map<String, Object>>) result.get("items");
            assertThat(items.size()).isEqualTo(page++ < 2 ? 20 : 5);
            items.forEach(p -> seen.add(p.get("id").toString()));
            cursor = (String) result.get("nextCursor");
        } while (cursor != null);
        assertThat(seen)
                .hasSize(45)
                .doesNotHaveDuplicates()
                .containsExactlyInAnyOrderElementsOf(ids);
        var first = posts.list(user, "job", "", "" + a.id(), "");
        String next = (String) first.get("nextCursor");
        call(a, "GET", "/posts?cursor=" + next, null, 400);
        call(a, "GET", "/posts?category=job&userId=" + a.id() + "&cursor=" + next + "x", null, 400);
        String post = seen.getFirst();
        for (int i = 0; i < 45; i++)
            posts.createComment(user, Integer.parseInt(post), Map.of("text", "Comment " + i));
        db.update(
                "UPDATE dbo.PostComments SET CreatedAtUtc='2025-01-01T00:00:00.7654321Z' WHERE PostId=?",
                post);
        cursor = "";
        var comments = new ArrayList<String>();
        page = 0;
        do {
            var result = posts.comments(user, Integer.parseInt(post), cursor);
            var items = (List<Map<String, Object>>) result.get("items");
            assertThat(items.size()).isEqualTo(page++ < 2 ? 20 : 5);
            items.forEach(c -> comments.add(c.get("id").toString()));
            cursor = (String) result.get("nextCursor");
        } while (cursor != null);
        assertThat(comments).hasSize(45).doesNotHaveDuplicates();
        assertThat(comments.stream().map(Integer::parseInt).toList()).isSorted();
        var page1 = posts.comments(user, Integer.parseInt(post), "");
        call(
                a,
                "GET",
                "/posts/" + seen.get(1) + "/comments?cursor=" + page1.get("nextCursor"),
                null,
                400);
        assertThat(posts.get(user, Integer.parseInt(post)).get("commentCount")).isEqualTo(45);
    }

    @Test
    void legacyPrivacyAndLastSaveWinsKeepPublicationTime() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        int user = uid(a);
        var post = posts.create(user, input());
        int id = Integer.parseInt(post.get("id").toString());
        db.update("UPDATE dbo.Users SET IsProfilePublic=0 WHERE UserId=?", user);
        db.update(
                "UPDATE dbo.Posts SET Title=NULL,PostTypeId=NULL,SphereId=NULL,Content=N'<script>bad()</script><p>Legacy</p>' WHERE PostId=?",
                id);
        var legacy = posts.get(uid(b), id);
        assertThat(legacy.get("title")).isNull();
        assertThat(legacy.get("category")).isNull();
        assertThat(legacy.get("sphereCode")).isNull();
        assertThat(legacy.get("content")).isEqualTo("<p>Legacy</p>");
        assertThat(((Map<?, ?>) legacy.get("author")).get("canOpenProfile")).isEqualTo(false);
        assertThat(((List<?>) posts.list(uid(b), "", "", "" + a.id(), "").get("items"))).hasSize(1);
        var one = input();
        one.put("title", "First save");
        var two = input();
        two.put("title", "Last save");
        posts.update(user, id, one);
        var last = posts.update(user, id, two);
        assertThat(last.get("title")).isEqualTo("Last save");
        assertThat(last.get("createdAt")).isEqualTo(post.get("createdAt"));
        assertThat(last.get("updatedAt")).isNotNull();
        assertThat(posts.update(user, id, two).get("updatedAt")).isEqualTo(last.get("updatedAt"));
    }

    @Test
    void commentsAndDeletionAreAtomicWithActivity() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        int user = uid(a);
        int id = Integer.parseInt(posts.create(user, input()).get("id").toString());
        posts.createComment(user, id, Map.of("text", "Self"));
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE PostId=?",
                                Integer.class,
                                id))
                .isZero();
        var comment = posts.createComment(uid(b), id, Map.of("text", "Other"));
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE PostId=? AND UserId=? AND Kind='POST_COMMENT'",
                                Integer.class,
                                id,
                                user))
                .isEqualTo(1);
        posts.updateComment(
                uid(b),
                id,
                Integer.parseInt(comment.get("id").toString()),
                Map.of("text", "Updated"));
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE PostId=?",
                                Integer.class,
                                id))
                .isEqualTo(1);
        posts.delete(user, id);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.PostComments WHERE PostId=?",
                                Integer.class,
                                id))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE PostId=?",
                                Integer.class,
                                id))
                .isZero();
    }

    @Test
    void concurrentSavesAndParentDeletionDoNotResurrectRows() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        int user = uid(a);
        int id = Integer.parseInt(posts.create(user, input()).get("id").toString());
        try (var pool = Executors.newFixedThreadPool(2)) {
            var gate = new CountDownLatch(1);
            var saves = new ArrayList<Future<Map<String, Object>>>();
            for (String title : List.of("One", "Two"))
                saves.add(
                        pool.submit(
                                () -> {
                                    gate.await();
                                    var data = input();
                                    data.put("title", title);
                                    return posts.update(user, id, data);
                                }));
            gate.countDown();
            for (var save : saves) assertThat(save.get(15, TimeUnit.SECONDS)).isNotNull();
            var start = new CountDownLatch(1);
            var comment =
                    pool.submit(
                            () -> {
                                start.await();
                                try {
                                    posts.createComment(uid(b), id, Map.of("text", "Race"));
                                } catch (am.polylink.posts.PostsFailure expected) {
                                }
                                return true;
                            });
            var delete =
                    pool.submit(
                            () -> {
                                start.await();
                                posts.delete(user, id);
                                return true;
                            });
            start.countDown();
            comment.get(15, TimeUnit.SECONDS);
            delete.get(15, TimeUnit.SECONDS);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.PostComments WHERE PostId=?",
                                Integer.class,
                                id))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE PostId=?",
                                Integer.class,
                                id))
                .isZero();
    }

    @Test
    void retainedActivityHonorsCategoryEmailAndDeliveryRetry() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        int id = Integer.parseInt(posts.create(a.id(), input()).get("id").toString());
        var baseline = notifications.list(a.id(), "initial", 100).get("nextCursor").toString();
        for (int i = 0; i < 45; i++)
            posts.createComment(b.id(), id, Map.of("text", "Private comment " + i));
        assertThat((List<?>) notifications.list(a.id(), baseline, 100).get("items")).hasSize(45);
        var history = notifications.history(a.id(), "");
        assertThat((List<?>) history.get("items")).hasSize(20);
        String next = history.get("nextCursor").toString();
        call(b, "GET", "/notifications/history?cursor=" + next, null, 400);
        call(a, "GET", "/notifications/history?cursor=" + next + "x", null, 400);
        var second = notifications.history(a.id(), next);
        assertThat((List<?>) second.get("items")).hasSize(20);
        assertThat(
                        (List<?>)
                                notifications
                                        .history(a.id(), second.get("nextCursor").toString())
                                        .get("items"))
                .hasSize(5);
        assertThat((List<?>) notifications.history(b.id(), "").get("items")).isEmpty();
        call(a, "PATCH", "/settings", Map.of("postCommentNotifications", false), 200);
        assertThat((List<?>) notifications.history(a.id(), "").get("items")).isEmpty();
        call(
                a,
                "PATCH",
                "/settings",
                Map.of("postCommentNotifications", true, "emailEnabled", false),
                200);
        assertThat((List<?>) notifications.history(a.id(), "").get("items")).hasSize(20);
        var future =
                java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC)
                        .plusDays(1)
                        .truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        db.update("UPDATE auth.ActivityNotifications SET RetryAt=? WHERE PostId=?", future, id);
        var notices = new ArrayList<String>();
        var fail = new java.util.concurrent.atomic.AtomicBoolean();
        MailDelivery mail =
                new MailDelivery() {
                    public void sendCode(String email, String purpose, String code) {}

                    public void sendNotice(String email, String subject, String body) {
                        if (!email.equals(a.email())) return;
                        if (fail.getAndSet(false)) throw new RuntimeException("SMTP unavailable");
                        notices.add(email + " " + body);
                    }
                };
        var transaction =
                new org.springframework.transaction.support.TransactionTemplate(
                        new org.springframework.jdbc.datasource.DataSourceTransactionManager(
                                db.getDataSource()));
        var delivery =
                new am.polylink.settings.NotificationService(
                        db,
                        java.time.Clock.fixed(future.toInstant(), java.time.ZoneOffset.UTC),
                        mail,
                        transaction,
                        false,
                        "http://localhost:8001",
                        true,
                        secrets);
        delivery.deliver();
        assertThat(notices).isEmpty();
        call(a, "PATCH", "/settings", Map.of("emailEnabled", true), 200);
        int event =
                db.queryForObject(
                        "SELECT MIN(Id) FROM auth.ActivityNotifications WHERE PostId=?",
                        Integer.class,
                        id);
        db.update(
                "UPDATE auth.ActivityNotifications SET EmailDone=CASE WHEN Id=? THEN 0 ELSE 1 END,RetryAt=? WHERE PostId=?",
                event,
                future,
                id);
        fail.set(true);
        delivery.deliver();
        assertThat(
                        db.queryForObject(
                                "SELECT EmailDone FROM auth.ActivityNotifications WHERE Id=?",
                                Boolean.class,
                                event))
                .isFalse();
        new am.polylink.settings.NotificationService(
                        db,
                        java.time.Clock.fixed(
                                future.plusMinutes(3).toInstant(), java.time.ZoneOffset.UTC),
                        mail,
                        transaction,
                        false,
                        "http://localhost:8001",
                        true,
                        secrets)
                .deliver();
        assertThat(notices).hasSize(1);
        assertThat(notices.getFirst())
                .contains(a.email(), "post.html?id=" + id)
                .doesNotContain("Private comment");
        posts.delete(a.id(), id);
        assertThat((List<?>) notifications.history(a.id(), "").get("items")).isEmpty();
    }

    @Test
    void eventFailureRollsBackCommentAndAccountDeletionRetainsNeutralContent() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        int id = Integer.parseInt(posts.create(a.id(), input()).get("id").toString());
        db.execute(
                "CREATE TRIGGER auth.TestPostsRollback ON auth.ActivityNotifications AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE PostId="
                        + id
                        + ") THROW 51000,'test rollback',1; END");
        try {
            assertThatThrownBy(() -> posts.createComment(b.id(), id, Map.of("text", "rollback")))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
        } finally {
            db.execute("DROP TRIGGER auth.TestPostsRollback");
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.PostComments WHERE PostId=?",
                                Integer.class,
                                id))
                .isZero();
        posts.createComment(a.id(), id, Map.of("text", "Retained self"));
        posts.createComment(b.id(), id, Map.of("text", "Retained other"));
        var grant =
                call(
                        a,
                        "POST",
                        "/account/export/authorize",
                        Map.of("expectedCredential", "1", "loginSecret", a.secret()),
                        200);
        a.browser().exportGrant = grant.path("grant").asText();
        var exported = call(a, "GET", "/account/export/data?category=posts", null, 200);
        assertThat(exported.path("items").get(0).has("CreatedAtUtc")).isTrue();
        assertThat(exported.path("items").get(0).has("UpdatedAtUtc")).isTrue();
        assertThat(
                        call(a, "GET", "/account/export/data?category=comments", null, 200)
                                .path("items")
                                .get(0)
                                .has("CreatedAtUtc"))
                .isTrue();
        assertThat(
                        call(a, "GET", "/account/export/data?category=settings", null, 200)
                                .path("items")
                                .get(0)
                                .has("postCommentNotifications"))
                .isTrue();
        lifecycle.apply(
                new Sessions.Principal(accounts.get(a.id()), UUID.randomUUID()),
                new am.polylink.chat.AccountLifecycle.Request("1", a.secret()),
                true);
        var surviving = posts.get(b.id(), id);
        assertThat(surviving.get("commentCount")).isEqualTo(2);
        assertThat(((Map<?, ?>) surviving.get("author")).get("id")).isNull();
        posts.createComment(b.id(), id, Map.of("text", "Still readable"));
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE UserId=? OR ActorId=?",
                                Integer.class,
                                a.id(),
                                a.id()))
                .isZero();
        lifecycle.replayDeletion(a.id());
        assertThat(posts.get(b.id(), id).get("commentCount")).isEqualTo(3);
    }

    @Test
    void combinedFiltersApplyBeforePagingAndAdmissionIsRechecked() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        var sphereCodes = new ArrayList<String>();
        sphereCodes.add(input().get("sphereCode").toString());
        for (int i = 0; i < 2; i++)
            sphereCodes.add(
                    db.queryForObject(
                            "INSERT dbo.Spheres(Name,Code) OUTPUT INSERTED.Code VALUES (?,?)",
                            String.class,
                            "Filter " + UUID.randomUUID(),
                            "filter-" + UUID.randomUUID().toString().substring(0, 20)));
        for (String category : List.of("job", "internship", "training"))
            for (String sphere : sphereCodes)
                for (int i = 0; i < 3; i++) {
                    var data = input();
                    data.put("category", category);
                    data.put("sphereCode", sphere);
                    posts.create(a.id(), data);
                }
        for (String category : List.of("job", "internship", "training")) {
            assertThat((List<?>) posts.list(b.id(), category, "", "" + a.id(), "").get("items"))
                    .hasSize(9);
            for (String sphere : sphereCodes)
                assertThat(
                                (List<?>)
                                        posts.list(b.id(), category, sphere, "" + a.id(), "")
                                                .get("items"))
                        .hasSize(3);
        }
        for (String sphere : sphereCodes)
            assertThat((List<?>) posts.list(b.id(), "", sphere, "" + a.id(), "").get("items"))
                    .hasSize(9);
        assertThat((List<?>) posts.list(b.id(), "", "", "" + b.id(), "").get("items")).isEmpty();
        try (var connection = Objects.requireNonNull(db.getDataSource()).getConnection();
                var statement = connection.createStatement()) {
            statement.execute("SET STATISTICS XML ON");
            int type =
                    db.queryForObject(
                            "SELECT PostTypeId FROM dbo.PostTypes WHERE Code='job'", Integer.class);
            statement.execute(
                    "SELECT TOP (21) PostId,CreatedAtUtc FROM dbo.Posts WHERE PostTypeId="
                            + type
                            + " AND SphereId="
                            + db.queryForObject(
                                    "SELECT SphereId FROM dbo.Spheres WHERE Code=?",
                                    Integer.class,
                                    sphereCodes.getFirst())
                            + " ORDER BY CreatedAtUtc DESC,PostId DESC");
            try (var rows = statement.getResultSet()) {
                while (rows.next()) {}
            }
            String plan = null;
            while (statement.getMoreResults() || statement.getUpdateCount() != -1)
                if (statement.getResultSet() != null) {
                    try (var result = statement.getResultSet()) {
                        if (result.next()) plan = result.getString(1);
                    }
                }
            statement.execute("SET STATISTICS XML OFF");
            assertThat(plan).contains("IX_Posts_TypeSphereDate", "ActualRows");
            System.out.println(
                    "Posts actual covering-filter plan uses IX_Posts_TypeSphereDate on disposable fixtures");
        }
        int role =
                db.queryForObject(
                        "INSERT dbo.Roles(Name) OUTPUT INSERTED.RoleId VALUES (?)",
                        Integer.class,
                        "reader-" + UUID.randomUUID());
        db.update("UPDATE dbo.Users SET RoleId=? WHERE UserId=?", role, b.id());
        call(b, "GET", "/posts/options", null, 200);
        call(b, "POST", "/posts", input(), 403);
        db.update(
                "UPDATE auth.AccountSecurity SET AdmissionStatus='PENDING' WHERE UserId=?", b.id());
        call(b, "GET", "/posts/options", null, 401);
    }

    @Test
    void commentCreationSerializesWithAccountDeactivationAndDeletion() throws Exception {
        for (boolean delete : List.of(false, true)) {
            var a = fixture.enroll("graduate");
            var b = fixture.enroll("lecturer");
            int id = Integer.parseInt(posts.create(a.id(), input()).get("id").toString());
            try (var pool = Executors.newFixedThreadPool(2)) {
                var start = new CountDownLatch(1);
                var comment =
                        pool.submit(
                                () -> {
                                    start.await();
                                    try {
                                        posts.createComment(
                                                b.id(), id, Map.of("text", "Lifecycle race"));
                                    } catch (AuthFailure expected) {
                                    }
                                    return true;
                                });
                var change =
                        pool.submit(
                                () -> {
                                    start.await();
                                    lifecycle.apply(
                                            new Sessions.Principal(
                                                    accounts.get(a.id()), UUID.randomUUID()),
                                            new am.polylink.chat.AccountLifecycle.Request(
                                                    "1", a.secret()),
                                            delete);
                                    return true;
                                });
                start.countDown();
                comment.get(15, TimeUnit.SECONDS);
                change.get(15, TimeUnit.SECONDS);
            }
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE UserId=? OR ActorId=?",
                                    Integer.class,
                                    a.id(),
                                    a.id()))
                    .isZero();
            assertThat((List<?>) notifications.history(b.id(), "").get("items")).isEmpty();
            if (delete) {
                assertThat(((Map<?, ?>) posts.get(b.id(), id).get("author")).get("id")).isNull();
                lifecycle.replayDeletion(a.id());
            }
        }
    }
}
