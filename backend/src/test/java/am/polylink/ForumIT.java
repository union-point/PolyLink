package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import am.polylink.forum.ForumService;
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
            "polylink.forum.enabled=true",
            "polylink.messenger.enabled=false",
            "polylink.frontend-origins=http://localhost:8001"
        })
class ForumIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired ForumService forum;
    @Autowired Accounts accounts;
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
        var response = user.browser().call(method, path, input);
        assertThat(response.statusCode())
                .as(method + " " + path + ": " + response.body())
                .isEqualTo(expected);
        return expected == 204 ? mapper.createObjectNode() : user.browser().json(response);
    }

    Map<String, Object> creation(String category) {
        return Map.of(
                "title",
                "Քննարկում",
                "content",
                "<p><strong>Բարև</strong><img src=x onerror=bad()></p>",
                "categoryCode",
                category,
                "requestId",
                UUID.randomUUID().toString());
    }

    JsonNode topic(IdentityIT.Enrolled user) throws Exception {
        return call(user, "POST", "/forum/topics", creation("informatics"), 201);
    }

    JsonNode reply(IdentityIT.Enrolled user, String topic) throws Exception {
        return call(
                user,
                "POST",
                "/forum/topics/" + topic + "/replies",
                Map.of("content", "<p>Պատասխան</p>", "requestId", UUID.randomUUID().toString()),
                201);
    }

    @Test
    void permissionsVersionsLikesAndDeletionAreAuthoritative() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        assertThat(fixture.new Browser().get("/forum/categories").statusCode()).isEqualTo(401);
        assertThat(call(a, "GET", "/forum/categories", null, 200).size()).isEqualTo(6);
        var input = creation("informatics");
        var topic = call(a, "POST", "/forum/topics", input, 201);
        String id = topic.path("id").asText();
        assertThat(topic.path("content").asText()).contains("<strong>").doesNotContain("<img");
        assertThat(call(a, "POST", "/forum/topics", input, 201).path("id").asText()).isEqualTo(id);
        var changed = new LinkedHashMap<>(input);
        changed.put("title", "different");
        call(a, "POST", "/forum/topics", changed, 409);
        call(
                b,
                "PATCH",
                "/forum/topics/" + id,
                Map.of("title", "stolen", "expectedVersion", "1"),
                403);
        var first = reply(b, id);
        String rid = first.path("id").asText();
        call(
                a,
                "PATCH",
                "/forum/replies/" + rid,
                Map.of("content", "wrong", "expectedVersion", "1"),
                403);
        call(a, "DELETE", "/forum/replies/" + rid + "?expectedVersion=1", Map.of(), 403);
        assertThat(
                        call(
                                        b,
                                        "PUT",
                                        "/forum/replies/" + rid + "/like",
                                        Map.of("liked", true),
                                        200)
                                .path("likeCount")
                                .asInt())
                .isEqualTo(1);
        assertThat(
                        call(
                                        b,
                                        "PUT",
                                        "/forum/replies/" + rid + "/like",
                                        Map.of("liked", true),
                                        200)
                                .path("likeCount")
                                .asInt())
                .isEqualTo(1);
        assertThat(call(a, "GET", "/forum/topics/" + id, null, 200).path("version").asText())
                .isEqualTo("1");
        assertThat(call(a, "GET", "/forum/topics/" + id, null, 200).path("replyCount").asInt())
                .isEqualTo(1);
        assertThat(
                        call(
                                        b,
                                        "PATCH",
                                        "/forum/replies/" + rid,
                                        Map.of(
                                                "content",
                                                "<em>edited</em>",
                                                "expectedVersion",
                                                "1"),
                                        200)
                                .path("version")
                                .asText())
                .isEqualTo("2");
        assertThat(
                        call(
                                        b,
                                        "PATCH",
                                        "/forum/replies/" + rid,
                                        Map.of("content", "stale", "expectedVersion", "1"),
                                        409)
                                .path("code")
                                .asText())
                .isEqualTo("EDIT_CONFLICT");
        call(
                a,
                "PATCH",
                "/forum/topics/" + id,
                Map.of("author", b.id(), "expectedVersion", "1"),
                400);
        call(
                a,
                "PATCH",
                "/forum/topics/" + id,
                Map.of("categoryCode", "bad", "expectedVersion", "1"),
                400);
        call(a, "PATCH", "/forum/topics/" + id, Map.of("title", "", "expectedVersion", "1"), 400);
        call(
                a,
                "PATCH",
                "/forum/topics/" + id,
                Map.of("title", "Updated", "expectedVersion", "1"),
                200);
        call(a, "DELETE", "/forum/topics/" + id + "?expectedVersion=1", Map.of(), 409);
        call(a, "DELETE", "/forum/topics/" + id + "?expectedVersion=2", Map.of(), 204);
        call(a, "POST", "/forum/topics", input, 404);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.ForumReplies WHERE TopicId=?",
                                Integer.class,
                                Integer.parseInt(id)))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.ForumReplyLikes WHERE ReplyId=?",
                                Integer.class,
                                Integer.parseInt(rid)))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE TopicId=?",
                                Integer.class,
                                Integer.parseInt(id)))
                .isZero();
    }

    @Test
    void pagingFilteringPrivacyAndAuthorTombstones() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        var topic = topic(a);
        String id = topic.path("id").asText();
        call(a, "POST", "/forum/topics", creation("energy"), 201);
        var filtered = call(b, "GET", "/forum/topics?categoryCode=informatics&limit=1", null, 200);
        assertThat(filtered.path("items").size()).isEqualTo(1);
        assertThat(filtered.path("items").get(0).path("categoryCode").asText())
                .isEqualTo("informatics");
        var first = reply(a, id);
        var second = reply(b, id);
        String rid = first.path("id").asText();
        var page =
                call(a, "GET", "/forum/topics/" + id + "/replies?sort=oldest&limit=1", null, 200);
        assertThat(page.path("items").get(0).path("id").asText()).isEqualTo(rid);
        String cursor =
                java.net.URLEncoder.encode(
                        page.path("nextCursor").asText(), java.nio.charset.StandardCharsets.UTF_8);
        var next =
                call(
                        a,
                        "GET",
                        "/forum/topics/" + id + "/replies?sort=oldest&limit=1&cursor=" + cursor,
                        null,
                        200);
        assertThat(next.path("items").get(0).path("id").asText())
                .isEqualTo(second.path("id").asText());
        assertThat(next.path("nextCursor").isNull()).isTrue();
        call(a, "GET", "/forum/topics/" + id + "/replies?sort=newest&cursor=" + cursor, null, 400);
        call(a, "GET", "/forum/topics?cursor=bad", null, 400);
        call(a, "GET", "/forum/topics?limit=101", null, 400);
        call(a, "PUT", "/forum/replies/" + rid + "/like", Map.of("liked", true), 200);
        assertThat(
                        call(a, "GET", "/forum/topics/" + id + "/replies?sort=popular", null, 200)
                                .path("items")
                                .get(0)
                                .path("id")
                                .asText())
                .isEqualTo(rid);
        db.update("UPDATE dbo.Users SET IsProfilePublic=0 WHERE UserId=?", a.id());
        assertThat(
                        call(b, "GET", "/forum/topics/" + id, null, 200)
                                .path("author")
                                .path("canOpenProfile")
                                .asBoolean())
                .isFalse();
        db.update(
                "UPDATE auth.AccountSecurity SET AdmissionStatus='DELETED' WHERE UserId=?", a.id());
        var anonymous = call(b, "GET", "/forum/topics/" + id, null, 200);
        assertThat(anonymous.path("author").path("id").isNull()).isTrue();
        assertThat(anonymous.path("author").has("email")).isFalse();
        assertThat(
                        call(b, "GET", "/forum/topics/" + id + "/replies", null, 200)
                                .path("items")
                                .get(1)
                                .path("isTopicAuthor")
                                .asBoolean())
                .isTrue();
        assertThat(a.browser().get("/forum/topics").statusCode()).isEqualTo(401);
    }

    @Test
    void concurrentCreatesLikesAndDeleteLeaveNoOrphans() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        var input = creation("mechanics");
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one = pool.submit(() -> forum.createTopic(a.id(), input));
            var two = pool.submit(() -> forum.createTopic(a.id(), input));
            String topic = one.get(10, TimeUnit.SECONDS).get("id").toString();
            assertThat(two.get(10, TimeUnit.SECONDS).get("id")).isEqualTo(topic);
            var r = reply(b, topic);
            int reply = Integer.parseInt(r.path("id").asText());
            var l1 = pool.submit(() -> forum.like(a.id(), reply, Map.of("liked", true)));
            var l2 = pool.submit(() -> forum.like(b.id(), reply, Map.of("liked", true)));
            l1.get(10, TimeUnit.SECONDS);
            l2.get(10, TimeUnit.SECONDS);
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM dbo.ForumReplyLikes WHERE ReplyId=?",
                                    Integer.class,
                                    reply))
                    .isEqualTo(2);
            var deletion =
                    pool.submit(
                            () -> {
                                forum.deleteTopic(a.id(), Integer.parseInt(topic), "1");
                                return true;
                            });
            var create =
                    pool.submit(
                            () -> {
                                try {
                                    forum.createReply(
                                            b.id(),
                                            Integer.parseInt(topic),
                                            Map.of(
                                                    "content",
                                                    "late",
                                                    "requestId",
                                                    UUID.randomUUID().toString()));
                                } catch (RuntimeException failure) {
                                    assertThat(failure.getMessage()).doesNotContain("SQL");
                                }
                                return true;
                            });
            deletion.get(10, TimeUnit.SECONDS);
            create.get(10, TimeUnit.SECONDS);
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM dbo.ForumReplies WHERE TopicId=?",
                                    Integer.class,
                                    Integer.parseInt(topic)))
                    .isZero();
        }
    }
}
