package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import am.polylink.forum.ForumService;
import am.polylink.settings.NotificationService;
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
    void forumNotificationEligibilityRetriesAndSelfSuppression() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        db.update("UPDATE auth.ActivityNotifications SET EmailDone=1");
        String topic = topic(a).path("id").asText();
        reply(a, topic);
        var response = reply(b, topic);
        int reply = Integer.parseInt(response.path("id").asText());
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE TopicId=?",
                                Integer.class,
                                Integer.parseInt(topic)))
                .isEqualTo(1);
        var notices = new ArrayList<String>();
        var fail = new java.util.concurrent.atomic.AtomicBoolean(false);
        MailDelivery mail =
                new MailDelivery() {
                    public void sendCode(String email, String purpose, String code) {}

                    public void sendNotice(String email, String subject, String body) {
                        if (fail.getAndSet(false))
                            throw new IllegalStateException("SMTP unavailable");
                        notices.add(email + " " + body);
                    }
                };
        var transaction =
                new org.springframework.transaction.support.TransactionTemplate(
                        new org.springframework.jdbc.support.JdbcTransactionManager(
                                db.getDataSource()));
        var future =
                java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC)
                        .plusDays(1)
                        .truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        db.update(
                "UPDATE auth.ActivityNotifications SET RetryAt=? WHERE TopicId=?",
                future,
                Integer.parseInt(topic));
        var delivery =
                new NotificationService(
                        db,
                        java.time.Clock.fixed(future.toInstant(), java.time.ZoneOffset.UTC),
                        mail,
                        transaction,
                        true,
                        ORIGIN());
        assertThat(((List<?>) delivery.list(a.id(), "0", 100).get("items")).size()).isEqualTo(1);
        db.update("UPDATE dbo.UserNotificationSettings SET EmailEnabled=0 WHERE UserId=?", a.id());
        delivery.deliver();
        assertThat(notices).isEmpty();
        assertThat(((List<?>) delivery.list(a.id(), "0", 100).get("items")).size()).isEqualTo(1);
        db.update("UPDATE dbo.UserNotificationSettings SET EmailEnabled=1 WHERE UserId=?", a.id());
        db.update(
                "UPDATE auth.ActivityNotifications SET EmailDone=0,RetryAt=? WHERE ReplyId=?",
                future,
                reply);
        fail.set(true);
        delivery.deliver();
        assertThat(
                        db.queryForObject(
                                "SELECT EmailDone FROM auth.ActivityNotifications WHERE ReplyId=?",
                                Boolean.class,
                                reply))
                .isFalse();
        new NotificationService(
                        db,
                        java.time.Clock.fixed(
                                future.plusMinutes(3).toInstant(), java.time.ZoneOffset.UTC),
                        mail,
                        transaction,
                        true,
                        ORIGIN())
                .deliver();
        assertThat(notices).hasSize(1);
        assertThat(notices.getFirst())
                .contains(a.email(), "topic.html?id=" + topic + "&reply=" + reply)
                .doesNotContain("<p>", "Պատասխան");
        db.update(
                "UPDATE dbo.UserNotificationSettings SET ForumReplyNotifications=0 WHERE UserId=?",
                a.id());
        assertThat((List<?>) delivery.list(a.id(), "0", 100).get("items")).isEmpty();
        db.update(
                "UPDATE dbo.UserNotificationSettings SET ForumReplyNotifications=1 WHERE UserId=?",
                a.id());
        forum.deleteReply(b.id(), reply, "1");
        assertThat((List<?>) delivery.list(a.id(), "0", 100).get("items")).isEmpty();
    }

    private static String ORIGIN() {
        return "http://localhost:8001";
    }

    @Test
    void exportAndAccountDeletionPreserveDiscussionsWithoutIdentity() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        String id = topic(a).path("id").asText();
        var own = reply(a, id);
        reply(b, id);
        call(
                a,
                "PUT",
                "/forum/replies/" + own.path("id").asText() + "/like",
                Map.of("liked", true),
                200);
        var grant =
                call(
                        a,
                        "POST",
                        "/account/export/authorize",
                        Map.of("expectedCredential", "1", "loginSecret", a.secret()),
                        200);
        a.browser().exportGrant = grant.path("grant").asText();
        var exported = call(a, "GET", "/account/export/data?category=topics", null, 200);
        assertThat(exported.path("items").get(0).path("TopicId").asText()).isEqualTo(id);
        assertThat(exported.path("items").get(0).has("CategoryId")).isTrue();
        lifecycle.apply(
                new Sessions.Principal(accounts.get(a.id()), UUID.randomUUID()),
                new am.polylink.chat.AccountLifecycle.Request("1", a.secret()),
                true);
        var surviving = call(b, "GET", "/forum/topics/" + id, null, 200);
        assertThat(surviving.path("replyCount").asInt()).isEqualTo(2);
        assertThat(surviving.path("author").path("id").isNull()).isTrue();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.ForumReplyLikes WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM forum.CreateRequests WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ActivityNotifications WHERE UserId=? OR ActorId=?",
                                Integer.class,
                                a.id(),
                                a.id()))
                .isZero();
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
