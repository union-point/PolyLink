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
                        "sphereId",
                        db.queryForObject(
                                "SELECT SphereId FROM dbo.Spheres WHERE Code='other'",
                                String.class)));
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
        for (String field : List.of("title", "content", "category", "sphereId")) {
            var missing = input();
            missing.remove(field);
            call(a, "POST", "/posts", missing, 400);
            call(a, "PUT", "/posts/" + id, missing, 400);
        }
        call(b, "PUT", "/posts/" + id, input(), 403);
        call(b, "DELETE", "/posts/" + id, null, 403);
        call(a, "GET", "/posts?category=unsupported", null, 400);
        call(a, "GET", "/posts?sphereId=999999", null, 400);
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
                    posts.list(user, "job", data.get("sphereId").toString(), "" + a.id(), cursor);
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
        assertThat(legacy.get("sphereId")).isNull();
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
}
