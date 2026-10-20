package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.Secrets;
import am.polylink.chat.*;
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
class GroupIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired ChatService service;
    @Autowired GroupService groups;
    @Autowired AccountLifecycle lifecycle;
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

    JsonNode json(IdentityIT.Enrolled a, String method, String path, Object input)
            throws Exception {
        var result = a.browser().call(method, path, input);
        assertThat(result.statusCode()).as(result.body()).isEqualTo(200);
        return a.browser().json(result);
    }

    Map<String, Object> activation(JsonNode snapshot) {
        var envelopes = new ArrayList<Object>();
        for (var r : snapshot.path("recipients"))
            envelopes.add(
                    Map.of(
                            "userId",
                            r.path("userId").asText(),
                            "identityVersion",
                            r.path("identityVersion").asText(),
                            "sealedPacket",
                            Secrets.encode(new byte[128])));
        return Map.of(
                "expected",
                snapshot,
                "newKeyVersion",
                "" + (Long.parseLong(snapshot.path("versions").path("roomKey").asText()) + 1),
                "envelopes",
                envelopes);
    }

    Map<String, Object> creation(IdentityIT.Enrolled a, IdentityIT.Enrolled b) throws Exception {
        String room = UUID.randomUUID().toString();
        var snap =
                json(
                        a,
                        "POST",
                        "/chat/groups/prepare",
                        Map.of("roomId", room, "userIds", List.of("" + b.id())));
        return new LinkedHashMap<>(
                Map.of(
                        "operationId",
                        UUID.randomUUID().toString(),
                        "roomId",
                        room,
                        "name",
                        "Study group",
                        "activation",
                        activation(snap)));
    }

    JsonNode summary(IdentityIT.Enrolled a, String room) throws Exception {
        return json(a, "GET", "/chat/rooms/" + room + "/participants", null);
    }

    Map<String, Object> change(IdentityIT.Enrolled a, String room) throws Exception {
        var s = summary(a, room);
        return new LinkedHashMap<>(
                Map.of(
                        "operationId",
                        UUID.randomUUID().toString(),
                        "expectedMembership",
                        s.path("keySnapshot").path("versions").path("membership").asText(),
                        "expectedMetadata",
                        s.path("metadataVersion").asText()));
    }

    JsonNode add(IdentityIT.Enrolled a, String room, IdentityIT.Enrolled b) throws Exception {
        var request = change(a, room);
        request.put("userId", "" + b.id());
        var snap =
                json(
                        a,
                        "POST",
                        "/chat/rooms/" + room + "/participants/prepare",
                        Map.of("roomId", room, "userIds", List.of("" + b.id())));
        request.put("activation", activation(snap));
        return json(a, "POST", "/chat/rooms/" + room + "/participants", request);
    }

    JsonNode rotate(IdentityIT.Enrolled a, String room) throws Exception {
        var snap = json(a, "GET", "/chat/rooms/" + room + "/keys", null).path("snapshot");
        return json(a, "POST", "/chat/rooms/" + room + "/keys/activate", activation(snap));
    }

    @Test
    void concurrentCreateIsDurableAndOwnerRightsUseIndependentRevisions() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var request = creation(a, b);
        String room = request.get("roomId").toString();
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one = pool.submit(() -> a.browser().post("/chat/groups", request));
            var two = pool.submit(() -> a.browser().post("/chat/groups", request));
            assertThat(one.get().statusCode()).isEqualTo(200);
            assertThat(two.get().statusCode()).isEqualTo(200);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM messaging.Rooms WHERE RoomId=?",
                                Integer.class,
                                room))
                .isEqualTo(1);
        request.put("name", "Different");
        assertThat(a.browser().post("/chat/groups", request).statusCode()).isEqualTo(409);
        var rename = change(a, room);
        rename.put("name", "Renamed");
        assertThat(b.browser().call("PATCH", "/chat/rooms/" + room, rename).statusCode())
                .isEqualTo(403);
        json(a, "PATCH", "/chat/rooms/" + room, rename);
        json(a, "PATCH", "/chat/rooms/" + room, rename);
        var s = summary(a, room);
        assertThat(s.path("name").asText()).isEqualTo("Renamed");
        assertThat(s.path("metadataVersion").asText()).isEqualTo("2");
        assertThat(s.path("keySnapshot").path("versions").path("roomKey").asText()).isEqualTo("1");
        assertThat(a.browser().post("/chat/rooms/" + room + "/leave", change(a, room)).statusCode())
                .isEqualTo(409);
        var transfer = change(a, room);
        transfer.put("userId", "" + b.id());
        json(a, "PUT", "/chat/rooms/" + room + "/owner", transfer);
        var leave = change(a, room);
        json(a, "POST", "/chat/rooms/" + room + "/leave", leave);
        json(a, "POST", "/chat/rooms/" + room + "/leave", leave);
        assertThat(a.browser().get("/chat/rooms/" + room + "/keys").statusCode()).isEqualTo(404);
        var single = rotate(b, room);
        assertThat(
                        b.browser()
                                .post("/chat/rooms/" + room + "/messages", fixture.packet(single))
                                .statusCode())
                .isEqualTo(200);
        json(b, "POST", "/chat/rooms/" + room + "/leave", change(b, room));
        assertThat(
                        db.queryForObject(
                                "SELECT Closed FROM messaging.Rooms WHERE RoomId=?",
                                Boolean.class,
                                room))
                .isTrue();
    }

    @Test
    void addRemoveRejoinRestrictHistoryEnvelopesAttachmentsAndSavedSendReplay() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var c = fixture.configured();
        var create = creation(a, b);
        String room = create.get("roomId").toString(), path = "/chat/rooms/" + room;
        json(a, "POST", "/chat/groups", create);
        var old = summary(a, room).path("keySnapshot");
        var oldSend = fixture.packet(old);
        json(b, "POST", path + "/messages", oldSend);
        add(a, room, c);
        assertThat(json(c, "GET", path + "/messages", null).path("items").size()).isZero();
        assertThat(json(c, "GET", path + "/keys", null).path("envelopes").size()).isEqualTo(1);
        assertThat(a.browser().post(path + "/messages", fixture.packet(old)).statusCode())
                .isEqualTo(409);
        var current = summary(a, room).path("keySnapshot");
        var state = new MessengerStateIT();
        state.port = port;
        String attachment = UUID.randomUUID().toString();
        assertThat(state.binary(b, path + "/attachments", attachment, new byte[20]).statusCode())
                .isEqualTo(201);
        var sent = fixture.packet(current);
        sent.put("attachmentId", attachment);
        json(b, "POST", path + "/messages", sent);
        var remove = change(a, room);
        json(a, "DELETE", path + "/participants/" + b.id(), remove);
        json(a, "DELETE", path + "/participants/" + b.id(), remove);
        assertThat(b.browser().get(path + "/messages").statusCode()).isEqualTo(404);
        assertThat(state.binary(b, "/chat/attachments/" + attachment, null, null).statusCode())
                .isEqualTo(404);
        assertThat(a.browser().post(path + "/messages", fixture.packet(current)).statusCode())
                .isEqualTo(409);
        add(a, room, b);
        assertThat(json(b, "GET", path + "/messages", null).path("items").size()).isZero();
        assertThat(json(b, "GET", path + "/keys", null).path("envelopes").size()).isEqualTo(1);
        assertThat(b.browser().post(path + "/messages", oldSend).statusCode()).isEqualTo(404);
        assertThat(b.browser().post(path + "/messages", sent).statusCode()).isEqualTo(404);
        assertThat(state.binary(b, "/chat/attachments/" + attachment, null, null).statusCode())
                .isEqualTo(404);
        assertThat(json(a, "GET", path + "/messages", null).path("items").size()).isEqualTo(2);
    }

    @Test
    void missingIdentitiesAndStalePreparedAdditionLeaveTheGroupWorking() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var c = fixture.configured();
        var unconfigured = fixture.fixture.enroll("graduate");
        var create = creation(a, b);
        String room = create.get("roomId").toString(), path = "/chat/rooms/" + room;
        json(a, "POST", "/chat/groups", create);
        assertThat(
                        a.browser()
                                .post(
                                        path + "/participants/prepare",
                                        Map.of(
                                                "roomId",
                                                room,
                                                "userIds",
                                                List.of("" + unconfigured.id())))
                                .statusCode())
                .isEqualTo(409);
        var request = change(a, room);
        request.put("userId", "" + c.id());
        var snap =
                json(
                        a,
                        "POST",
                        path + "/participants/prepare",
                        Map.of("roomId", room, "userIds", List.of("" + c.id())));
        request.put("activation", activation(snap));
        var rename = change(a, room);
        rename.put("name", "Another name");
        json(a, "PATCH", path, rename);
        assertThat(a.browser().post(path + "/participants", request).statusCode()).isEqualTo(409);
        assertThat(summary(a, room).path("participants").size()).isEqualTo(2);
        assertThat(
                        a.browser()
                                .post(
                                        path + "/messages",
                                        fixture.packet(summary(a, room).path("keySnapshot")))
                                .statusCode())
                .isEqualTo(200);
    }

    @Test
    void removalAndSendSerializeAndCannotReactivateAnOldSnapshot() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var create = creation(a, b);
        String room = create.get("roomId").toString(), path = "/chat/rooms/" + room;
        json(a, "POST", "/chat/groups", create);
        var snapshot = summary(a, room).path("keySnapshot");
        var send = fixture.packet(snapshot);
        var remove = change(a, room);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one =
                    pool.submit(
                            () ->
                                    a.browser()
                                            .call(
                                                    "DELETE",
                                                    path + "/participants/" + b.id(),
                                                    remove));
            var two = pool.submit(() -> b.browser().post(path + "/messages", send));
            assertThat(one.get().statusCode()).isEqualTo(200);
            assertThat(two.get().statusCode()).isIn(200, 404);
        }
        assertThat(b.browser().post(path + "/messages", send).statusCode()).isEqualTo(404);
        assertThat(a.browser().post(path + "/keys/activate", activation(snapshot)).statusCode())
                .isEqualTo(409);
        rotate(a, room);
        assertThat(
                        a.browser()
                                .post(
                                        path + "/messages",
                                        fixture.packet(summary(a, room).path("keySnapshot")))
                                .statusCode())
                .isEqualTo(200);
    }

    @Test
    void deletionRevokesAccessRemovesOnlyOwnBodiesAndTransfersOwnership() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var c = fixture.configured();
        var create = creation(a, b);
        String room = create.get("roomId").toString(), path = "/chat/rooms/" + room;
        json(a, "POST", "/chat/groups", create);
        add(a, room, c);
        var snapshot = summary(a, room).path("keySnapshot");
        var state = new MessengerStateIT();
        state.port = port;
        String attachment = UUID.randomUUID().toString();
        assertThat(state.binary(a, path + "/attachments", attachment, new byte[20]).statusCode())
                .isEqualTo(201);
        var own = fixture.packet(snapshot);
        own.put("attachmentId", attachment);
        json(a, "POST", path + "/messages", own);
        json(b, "POST", path + "/messages", fixture.packet(snapshot));
        var exported = json(a, "GET", "/chat/export?limit=1", null);
        assertThat(exported.path("items").size()).isEqualTo(1);
        assertThat(exported.path("items").get(0).path("sender").path("id").asText())
                .isEqualTo("" + a.id());
        String direct =
                json(a, "POST", "/chat/direct", Map.of("userId", "" + b.id())).path("id").asText();
        assertThat(
                        a.browser()
                                .post(
                                        "/account/delete",
                                        Map.of(
                                                "expectedCredential",
                                                "1",
                                                "loginSecret",
                                                fixture.fixture.secret()))
                                .statusCode())
                .isEqualTo(401);
        json(
                a,
                "POST",
                "/account/delete",
                Map.of("expectedCredential", "1", "loginSecret", a.secret()));
        assertThat(a.browser().get(path + "/messages").statusCode()).isEqualTo(401);
        assertThat(a.browser().get("/keys/me").statusCode()).isEqualTo(401);
        assertThat(summary(b, room).path("ownerId").asText())
                .isEqualTo("" + Math.min(b.id(), c.id()));
        assertThat(summary(b, room).path("keySnapshot").path("keyState").asText())
                .isEqualTo("stale");
        var history = json(b, "GET", path + "/messages", null).path("items");
        assertThat(history.size()).isEqualTo(2);
        assertThat(history.get(0).path("deleted").asBoolean()).isTrue();
        assertThat(history.get(0).path("packet").isNull()).isTrue();
        assertThat(history.get(1).path("deleted").asBoolean()).isFalse();
        assertThat(state.binary(b, "/chat/attachments/" + attachment, null, null).statusCode())
                .isEqualTo(404);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM keyvault.Vaults WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.AccountDeletions WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isEqualTo(1);
        assertThat(
                        db.queryForObject(
                                "SELECT Closed FROM messaging.Rooms WHERE RoomId=?",
                                Boolean.class,
                                direct))
                .isTrue();
        rotate(b, room);
        assertThat(
                        b.browser()
                                .post(
                                        path + "/messages",
                                        fixture.packet(summary(b, room).path("keySnapshot")))
                                .statusCode())
                .isEqualTo(200);
        assertThat(json(b, "GET", "/chat/export", null).path("items").size()).isEqualTo(2);
    }

    @Test
    void deactivationSuspendsSessionsWithoutChangingMembershipOwnerOrPasswordCopy()
            throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var create = creation(a, b);
        String room = create.get("roomId").toString();
        json(a, "POST", "/chat/groups", create);
        byte[] passwordCopy =
                db.queryForObject(
                        "SELECT PasswordCopy FROM keyvault.Vaults WHERE UserId=?",
                        byte[].class,
                        a.id());
        json(
                a,
                "POST",
                "/account/deactivate",
                Map.of("expectedCredential", "1", "loginSecret", a.secret()));
        assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(
                        b.browser()
                                .post(
                                        "/chat/rooms/" + room + "/messages",
                                        fixture.packet(summary(b, room).path("keySnapshot")))
                                .statusCode())
                .isEqualTo(403);
        assertThat(b.browser().get("/auth/me").statusCode()).isEqualTo(200);
        assertThat(summary(b, room).path("ownerId").asText()).isEqualTo("" + a.id());
        assertThat(summary(b, room).path("participants").size()).isEqualTo(2);
        assertThat(
                        db.queryForObject(
                                "SELECT PasswordCopy FROM keyvault.Vaults WHERE UserId=?",
                                byte[].class,
                                a.id()))
                .isEqualTo(passwordCopy);
        assertThat(
                        db.queryForObject(
                                "SELECT CredentialVersion FROM auth.AccountSecurity WHERE UserId=?",
                                Long.class,
                                a.id()))
                .isEqualTo(1);
        assertThat(
                        a.browser()
                                .post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                a.email(),
                                                "scheme",
                                                "PLK1",
                                                "loginSecret",
                                                a.secret()))
                                .statusCode())
                .isEqualTo(401);
    }

    @Test
    void deletionReplayIsIdempotentWithoutLegacyChatTables() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var request = creation(a, b);
        UUID room = UUID.fromString(request.get("roomId").toString());
        json(a, "POST", "/chat/groups", request);
        var snap = summary(a, room.toString()).path("keySnapshot");
        json(a, "POST", "/chat/rooms/" + room + "/messages", fixture.packet(snap));
        byte[] ciphertext =
                db.queryForObject(
                        "SELECT Ciphertext FROM messaging.Messages WHERE RoomId=?",
                        byte[].class,
                        room);
        lifecycle.replayDeletion(a.id());
        // Restore-equivalent fixture: replay an externally retained ledger over resurrected SQL
        // rows.
        db.update("DELETE auth.AccountDeletions WHERE UserId=?", a.id());
        db.update(
                "UPDATE auth.AccountSecurity SET AdmissionStatus='ADMITTED' WHERE UserId=?",
                a.id());
        db.update(
                "UPDATE messaging.Messages SET SenderId=?,Ciphertext=?,DeletedAt=NULL WHERE RoomId=?",
                a.id(),
                ciphertext,
                room);
        db.update(
                "UPDATE messaging.MembershipIntervals SET LeftMembership=NULL,LeftSequence=NULL WHERE RoomId=? AND UserId=?",
                room,
                a.id());
        db.update("UPDATE messaging.Groups SET OwnerId=? WHERE RoomId=?", a.id(), room);
        lifecycle.replayDeletion(a.id());
        lifecycle.replayDeletion(a.id());
        assertThat(
                        db.queryForObject(
                                "SELECT Ciphertext FROM messaging.Messages WHERE RoomId=?",
                                byte[].class,
                                room))
                .isNull();
        assertThat(
                        db.queryForObject(
                                "SELECT OwnerId FROM messaging.Groups WHERE RoomId=?",
                                Integer.class,
                                room))
                .isEqualTo(b.id());
        assertThat(
                        db.queryForObject(
                                "SELECT AdmissionStatus FROM auth.AccountSecurity WHERE UserId=?",
                                String.class,
                                a.id()))
                .isEqualTo("DELETED");
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.AccountDeletions WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isEqualTo(1);
    }

    @Test
    void simultaneousRemovalSendAndServiceRecoveryRespectTheSameMembershipBoundary()
            throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        var c = fixture.configured();
        var create = creation(a, b);
        String room = create.get("roomId").toString(), path = "/chat/rooms/" + room;
        json(a, "POST", "/chat/groups", create);
        add(a, room, c);
        var snapshot = summary(a, room).path("keySnapshot");
        var recovery = new RecoveryIT();
        recovery.port = port;
        recovery.db = db;
        recovery.mapper = mapper;
        recovery.init();
        var browser = recovery.fixture.new Browser();
        var operation = recovery.verify(c, browser);
        var id = Map.of("operationId", operation.path("operationId").asText());
        assertThat(browser.post("/auth/recovery/unlock", id).statusCode()).isEqualTo(200);
        var candidate = recovery.candidate(c, operation, true);
        assertThat(browser.post("/auth/recovery/prepare", candidate).statusCode()).isEqualTo(200);
        var remove = change(a, room);
        var packet = fixture.packet(snapshot);
        try (var pool = Executors.newFixedThreadPool(3)) {
            var removed =
                    pool.submit(
                            () ->
                                    a.browser()
                                            .call(
                                                    "DELETE",
                                                    path + "/participants/" + b.id(),
                                                    remove));
            var sent = pool.submit(() -> b.browser().post(path + "/messages", packet));
            var recovered = pool.submit(() -> browser.post("/auth/recovery/commit", id));
            assertThat(removed.get().statusCode()).isEqualTo(200);
            assertThat(recovered.get().statusCode()).isEqualTo(200);
            assertThat(sent.get().statusCode()).isIn(200, 404, 409);
        }
        assertThat(b.browser().get(path + "/keys").statusCode()).isEqualTo(404);
        assertThat(a.browser().post(path + "/keys/activate", activation(snapshot)).statusCode())
                .isEqualTo(409);
        var rotated = rotate(a, room);
        assertThat(rotated.path("versions").path("membership").asText()).isEqualTo("3");
        assertThat(rotated.path("recipients"))
                .anySatisfy(
                        recipient -> {
                            assertThat(recipient.path("userId").asText()).isEqualTo("" + c.id());
                            assertThat(recipient.path("identityVersion").asText()).isEqualTo("2");
                        });
        assertThat(a.browser().post(path + "/messages", fixture.packet(rotated)).statusCode())
                .isEqualTo(200);
    }
}
