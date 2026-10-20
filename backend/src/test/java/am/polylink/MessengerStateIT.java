package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.chat.*;
import java.net.*;
import java.net.http.*;
import java.time.OffsetDateTime;
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
            "polylink.messenger.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class MessengerStateIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired AttachmentCleanup cleanup;
    final ChatIT fixture = new ChatIT();

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void init() {
        fixture.port = port;
        fixture.db = db;
        fixture.mapper = mapper;
        fixture.initialize();
        db.update("DELETE auth.RateLimits");
    }

    String direct(IdentityIT.Enrolled a, IdentityIT.Enrolled b) throws Exception {
        return a.browser()
                .json(a.browser().post("/chat/direct", Map.of("userId", "" + b.id())))
                .path("id")
                .asText();
    }

    HttpResponse<byte[]> binary(IdentityIT.Enrolled a, String path, String id, byte[] bytes)
            throws Exception {
        var request =
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                        .header("Origin", IdentityIT.ORIGIN)
                        .header("Authorization", "Bearer " + a.browser().access);
        if (bytes == null) request.GET();
        else
            request.header("X-Attachment-Id", id)
                    .header("Content-Type", "application/octet-stream")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(bytes));
        return HttpClient.newHttpClient()
                .send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    int put(IdentityIT.Enrolled a, String path, Object data) throws Exception {
        return a.browser().call("PUT", path, data).statusCode();
    }

    JsonNode list(IdentityIT.Enrolled a) throws Exception {
        return a.browser().json(a.browser().get("/chat/rooms")).path("items");
    }

    @Test
    void imageUploadsArePrivateImmutableAtomicallyBoundAndFilteredByPersonalCutoff()
            throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var outsider = fixture.configured();
        String room = direct(a, b), path = "/chat/rooms/" + room;
        var snapshot = fixture.activate(a, room);
        String id = UUID.randomUUID().toString();
        byte[] bytes = new byte[5242896];
        new Random(5).nextBytes(bytes);
        assertThat(binary(a, path + "/attachments", id, bytes).statusCode()).isEqualTo(201);
        assertThat(binary(a, path + "/attachments", id, bytes).statusCode()).isEqualTo(201);
        assertThat(binary(b, path + "/attachments", id, bytes).statusCode()).isEqualTo(404);
        assertThat(binary(a, path + "/attachments", id, new byte[18]).statusCode()).isEqualTo(409);
        assertThat(binary(a, "/chat/attachments/" + id, null, null).statusCode()).isEqualTo(404);
        assertThat(
                        binary(
                                        a,
                                        path + "/attachments",
                                        UUID.randomUUID().toString(),
                                        new byte[5242897])
                                .statusCode())
                .isEqualTo(413);
        var input = fixture.packet(snapshot);
        input.put("attachmentId", id);
        assertThat(b.browser().post(path + "/messages", input).statusCode()).isEqualTo(404);
        var response = a.browser().post(path + "/messages", input);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        assertThat(a.browser().json(response).path("attachmentId").asText()).isEqualTo(id);
        assertThat(a.browser().post(path + "/messages", input).body()).isEqualTo(response.body());
        var reused = fixture.packet(snapshot);
        reused.put("attachmentId", id);
        assertThat(a.browser().post(path + "/messages", reused).statusCode()).isEqualTo(409);
        assertThat(binary(b, "/chat/attachments/" + id, null, null).body()).isEqualTo(bytes);
        assertThat(binary(outsider, "/chat/attachments/" + id, null, null).statusCode())
                .isEqualTo(404);
        assertThat(a.browser().post(path + "/hide", Map.of()).statusCode()).isEqualTo(200);
        assertThat(binary(a, "/chat/attachments/" + id, null, null).statusCode()).isEqualTo(404);
        assertThat(binary(b, "/chat/attachments/" + id, null, null).body()).isEqualTo(bytes);
        assertThat(a.browser().post(path + "/messages", input).statusCode()).isEqualTo(404);
        assertThat(a.browser().json(a.browser().get(path + "/messages")).path("items").size())
                .isZero();
        assertThat(b.browser().post(path + "/messages", fixture.packet(snapshot)).statusCode())
                .isEqualTo(200);
        var visible = a.browser().json(a.browser().get(path + "/messages")).path("items");
        assertThat(visible.size()).isEqualTo(1);
        assertThat(visible.get(0).path("sequence").asText()).isEqualTo("2");
        assertThat(list(a).size()).isEqualTo(1);
        assertThat(
                        a.browser()
                                .json(
                                        a.browser()
                                                .post(
                                                        "/chat/direct",
                                                        Map.of("userId", "" + b.id())))
                                .path("historyCutoff")
                                .asText())
                .isEqualTo("1");
    }

    @Test
    void readMarkersAreMonotonicAndBlocksAreBilateralOnlyForDirectRooms() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        String room = direct(a, b), path = "/chat/rooms/" + room;
        var snapshot = fixture.activate(a, room);
        for (int i = 0; i < 3; i++)
            assertThat(a.browser().post(path + "/messages", fixture.packet(snapshot)).statusCode())
                    .isEqualTo(200);
        assertThat(list(b).get(0).path("unreadCount").asText()).isEqualTo("3");
        assertThat(put(b, path + "/read", Map.of("throughSequence", "1"))).isEqualTo(200);
        assertThat(list(b).get(0).path("unreadCount").asText()).isEqualTo("2");
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures =
                    List.of(
                            pool.submit(
                                    () -> put(b, path + "/read", Map.of("throughSequence", "3"))),
                            pool.submit(
                                    () -> put(b, path + "/read", Map.of("throughSequence", "2"))));
            for (var f : futures) assertThat(f.get()).isEqualTo(200);
        }
        assertThat(list(b).get(0).path("lastReadSequence").asText()).isEqualTo("3");
        assertThat(put(b, path + "/read", Map.of("throughSequence", "4"))).isEqualTo(400);
        assertThat(put(a, path + "/mute", Map.of("enabled", true))).isEqualTo(200);
        assertThat(list(a).get(0).path("muted").asBoolean()).isTrue();
        assertThat(list(b).get(0).path("muted").asBoolean()).isFalse();
        assertThat(put(a, "/chat/blocks/" + b.id(), Map.of("enabled", true))).isEqualTo(204);
        assertThat(list(a).get(0).path("blocked").asBoolean()).isTrue();
        assertThat(list(b).get(0).path("blocked").asBoolean()).isFalse();
        assertThat(list(b).get(0).path("canSend").asBoolean()).isFalse();
        assertThat(a.browser().post(path + "/messages", fixture.packet(snapshot)).statusCode())
                .isEqualTo(403);
        assertThat(b.browser().post(path + "/messages", fixture.packet(snapshot)).statusCode())
                .isEqualTo(403);
        UUID group = UUID.randomUUID();
        db.update(
                "INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (?,1,0,1,0,?)",
                group,
                OffsetDateTime.now());
        for (int user : List.of(a.id(), b.id()))
            db.update("INSERT messaging.Participants VALUES (?,?,1,0,0,0,0)", group, user);
        var groupSnapshot = fixture.activate(a, group.toString());
        assertThat(
                        a.browser()
                                .post(
                                        "/chat/rooms/" + group + "/messages",
                                        fixture.packet(groupSnapshot))
                                .statusCode())
                .isEqualTo(200);
        assertThat(put(a, "/chat/blocks/" + b.id(), Map.of("enabled", false))).isEqualTo(204);
        assertThat(b.browser().post(path + "/messages", fixture.packet(snapshot)).statusCode())
                .isEqualTo(200);
    }

    @Test
    void hiddenDirectReportsOwnBlockBeforeGenericUnavailability() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        String room = direct(a, b);
        assertThat(put(a, "/chat/blocks/" + b.id(), Map.of("enabled", true))).isEqualTo(204);
        assertThat(a.browser().post("/chat/rooms/" + room + "/hide", Map.of()).statusCode())
                .isEqualTo(200);
        var own = a.browser().post("/chat/direct", Map.of("userId", "" + b.id()));
        assertThat(own.statusCode()).isEqualTo(403);
        assertThat(a.browser().json(own).path("code").asText()).isEqualTo("DIRECT_BLOCKED_BY_YOU");
        var peer = b.browser().post("/chat/direct", Map.of("userId", "" + a.id()));
        assertThat(peer.statusCode()).isEqualTo(403);
        assertThat(b.browser().json(peer).path("code").asText()).isEqualTo("DIRECT_UNAVAILABLE");
        assertThat(put(b, "/chat/blocks/" + a.id(), Map.of("enabled", true))).isEqualTo(204);
        var mutual = a.browser().post("/chat/direct", Map.of("userId", "" + b.id()));
        assertThat(a.browser().json(mutual).path("code").asText())
                .isEqualTo("DIRECT_BLOCKED_BY_YOU");
        assertThat(put(a, "/chat/blocks/" + b.id(), Map.of("enabled", false))).isEqualTo(204);
        var stillUnavailable = a.browser().post("/chat/direct", Map.of("userId", "" + b.id()));
        assertThat(a.browser().json(stillUnavailable).path("code").asText())
                .isEqualTo("DIRECT_UNAVAILABLE");
        assertThat(put(b, "/chat/blocks/" + a.id(), Map.of("enabled", false))).isEqualTo(204);
        assertThat(direct(a, b)).isEqualTo(room);
    }

    @Test
    void roomScanCannotReturnAHiddenPreviewFromAnEarlierSnapshot() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var c = fixture.configured();
        String first = direct(a, b), second = direct(a, c);
        for (String room : List.of(first, second))
            assertThat(
                            a.browser()
                                    .post(
                                            "/chat/rooms/" + room + "/messages",
                                            fixture.packet(fixture.activate(a, room)))
                                    .statusCode())
                    .isEqualTo(200);
        var scan = a.browser().json(a.browser().get("/chat/rooms?limit=1"));
        String cursor = scan.path("nextCursor").asText();
        assertThat(cursor).isNotBlank();
        for (String room : List.of(first, second))
            assertThat(a.browser().post("/chat/rooms/" + room + "/hide", Map.of()).statusCode())
                    .isEqualTo(200);
        var remainder =
                a.browser().json(a.browser().get("/chat/rooms?cursor=" + cursor + "&limit=1"));
        assertThat(remainder.path("items").size()).isZero();
    }

    @Test
    void expiredUploadsAreRemovedAndInterruptedBindingRollsBackWithoutLosingTheStagedObject()
            throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        String room = direct(a, b), path = "/chat/rooms/" + room;
        var snapshot = fixture.activate(a, room);
        String expired = UUID.randomUUID().toString(), id = UUID.randomUUID().toString();
        for (String object : List.of(expired, id))
            assertThat(binary(a, path + "/attachments", object, new byte[20]).statusCode())
                    .isEqualTo(201);
        db.update(
                "UPDATE messaging.Attachments SET ExpiresAt=? WHERE AttachmentId=?",
                OffsetDateTime.now().minusSeconds(1),
                expired);
        cleanup.expire();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM messaging.AttachmentBodies WHERE AttachmentId=?",
                                Integer.class,
                                expired))
                .isZero();
        assertThat(binary(a, path + "/attachments", expired, new byte[20]).statusCode())
                .isEqualTo(409);
        var input = fixture.packet(snapshot);
        input.put("attachmentId", id);
        db.execute(
                "CREATE TRIGGER messaging.M5RejectBinding ON messaging.SendOperations AFTER INSERT AS THROW 51000,'Synthetic binding interruption',1;");
        try {
            assertThat(a.browser().post(path + "/messages", input).statusCode()).isEqualTo(503);
            assertThat(
                            db.queryForObject(
                                    "SELECT Sequence FROM messaging.Attachments WHERE AttachmentId=?",
                                    Long.class,
                                    id))
                    .isNull();
            assertThat(a.browser().json(a.browser().get(path + "/messages")).path("items").size())
                    .isZero();
        } finally {
            db.execute("DROP TRIGGER messaging.M5RejectBinding");
        }
        assertThat(a.browser().post(path + "/messages", input).statusCode()).isEqualTo(200);
        db.update(
                "UPDATE messaging.Attachments SET ExpiresAt=? WHERE AttachmentId=?",
                OffsetDateTime.now().minusDays(1),
                id);
        cleanup.expire();
        assertThat(binary(b, "/chat/attachments/" + id, null, null).statusCode()).isEqualTo(200);
    }
}
