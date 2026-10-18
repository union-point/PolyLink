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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.messenger.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class ChatIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired ChatService service;
    @Autowired TransactionTemplate tx;
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
    }

    IdentityIT.Enrolled configured() throws Exception {
        var a = fixture.enroll("graduate");
        var setup = fixture.packageFor(a);
        assertThat(a.browser().post("/keys/setup/prepare", setup).statusCode()).isEqualTo(200);
        assertThat(
                        a.browser()
                                .post(
                                        "/keys/setup/commit",
                                        Map.of("operationId", setup.get("operationId")))
                                .statusCode())
                .isEqualTo(200);
        return a;
    }

    JsonNode activate(IdentityIT.Enrolled a, String room) throws Exception {
        var snapshot =
                a.browser().json(a.browser().get("/chat/rooms/" + room + "/keys")).path("snapshot");
        var envelopes = new ArrayList<Object>();
        for (var recipient : snapshot.path("recipients"))
            envelopes.add(
                    Map.of(
                            "userId",
                            recipient.path("userId").asText(),
                            "identityVersion",
                            recipient.path("identityVersion").asText(),
                            "sealedPacket",
                            Secrets.encode(new byte[128])));
        var request = Map.of("expected", snapshot, "newKeyVersion", "1", "envelopes", envelopes);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first =
                    pool.submit(
                            () -> {
                                var browser = fixture.new Browser();
                                browser.access = a.browser().access;
                                return browser.post(
                                        "/chat/rooms/" + room + "/keys/activate", request);
                            });
            var second =
                    pool.submit(
                            () -> {
                                var browser = fixture.new Browser();
                                browser.access = a.browser().access;
                                return browser.post(
                                        "/chat/rooms/" + room + "/keys/activate", request);
                            });
            var one = first.get(10, TimeUnit.SECONDS);
            var two = second.get(10, TimeUnit.SECONDS);
            assertThat(List.of(one.statusCode(), two.statusCode()))
                    .containsExactlyInAnyOrder(200, 409);
            var response = one.statusCode() == 200 ? one : two;
            return a.browser().json(response);
        }
    }

    Map<String, Object> packet(JsonNode snapshot) {
        var recipients = new ArrayList<Object>();
        for (var r : snapshot.path("recipients"))
            recipients.add(
                    Map.of(
                            "userId",
                            r.path("userId").asText(),
                            "identityVersion",
                            r.path("identityVersion").asText()));
        return new LinkedHashMap<>(
                Map.of(
                        "operationId",
                        UUID.randomUUID().toString(),
                        "expected",
                        snapshot.path("versions"),
                        "recipientVersions",
                        recipients,
                        "packet",
                        Map.of(
                                "scheme",
                                "PLK1",
                                "nonce",
                                Secrets.encode(new byte[24]),
                                "ciphertext",
                                Secrets.encode(new byte[17]))));
    }

    @Test
    void directUniquenessAuthorizationOfflineHistoryAndDurableRetries() throws Exception {
        var a = configured();
        var b = configured();
        var outsider = configured();
        try (var pool = Executors.newFixedThreadPool(4)) {
            var futures = new ArrayList<Future<String>>();
            for (int i = 0; i < 4; i++)
                futures.add(
                        pool.submit(
                                () -> {
                                    var browser = fixture.new Browser();
                                    browser.access = a.browser().access;
                                    var response =
                                            browser.post(
                                                    "/chat/direct", Map.of("userId", "" + b.id()));
                                    assertThat(response.statusCode())
                                            .as(response.body())
                                            .isEqualTo(200);
                                    return browser.json(response).path("id").asText();
                                }));
            String room = futures.getFirst().get(10, TimeUnit.SECONDS);
            for (var future : futures) assertThat(future.get()).isEqualTo(room);
            assertThat(a.browser().post("/chat/direct", Map.of("userId", "" + a.id())).statusCode())
                    .isEqualTo(400);
            String path = "/chat/rooms/" + room;
            for (String suffix : List.of("/keys", "/messages"))
                assertThat(outsider.browser().get(path + suffix).statusCode()).isEqualTo(404);
            var snapshot = activate(a, room);
            var input = packet(snapshot);
            assertThat(outsider.browser().post(path + "/messages", input).statusCode())
                    .isEqualTo(404);
            var sends = new ArrayList<Future<JsonNode>>();
            for (int i = 0; i < 4; i++)
                sends.add(
                        pool.submit(
                                () -> {
                                    var browser = fixture.new Browser();
                                    browser.access = a.browser().access;
                                    var response = browser.post(path + "/messages", input);
                                    assertThat(response.statusCode())
                                            .as(response.body())
                                            .isEqualTo(200);
                                    return browser.json(response);
                                }));
            var first = sends.getFirst().get(10, TimeUnit.SECONDS);
            for (var sent : sends) assertThat(sent.get().path("id")).isEqualTo(first.path("id"));
            assertThat(first.path("sequence").asText()).isEqualTo("1");
            var changed = new LinkedHashMap<>(input);
            changed.put(
                    "packet",
                    Map.of(
                            "scheme",
                            "PLK1",
                            "nonce",
                            Secrets.encode(new byte[24]),
                            "ciphertext",
                            Secrets.encode(new byte[18])));
            assertThat(a.browser().post(path + "/messages", changed).statusCode()).isEqualTo(409);
            // The recipient was configured but has made no room/key requests before the first send.
            var received = b.browser().json(b.browser().get(path + "/messages?after=0"));
            assertThat(received.path("items").size()).isEqualTo(1);
            assertThat(b.browser().json(b.browser().get(path + "/keys")).path("envelopes").size())
                    .isEqualTo(1);
            // A changed identity makes new sends stale; exact saved retries still resolve first.
            tx.execute(
                    status -> {
                        db.update(
                                "INSERT keyvault.Identities VALUES (?,2,?,SYSDATETIMEOFFSET())",
                                b.id(),
                                new byte[32]);
                        db.update(
                                "UPDATE keyvault.Vaults SET IdentityVersion=2 WHERE UserId=?",
                                b.id());
                        return null;
                    });
            assertThat(a.browser().post(path + "/messages", input).statusCode()).isEqualTo(200);
            assertThat(a.browser().post(path + "/messages", packet(snapshot)).statusCode())
                    .isEqualTo(409);
            assertThat(
                            a.browser()
                                    .json(a.browser().get(path + "/messages?after=1"))
                                    .path("items")
                                    .size())
                    .isZero();
            assertThat(a.browser().get(path + "/messages?after=0&before=2").statusCode())
                    .isEqualTo(400);
            assertThat(a.browser().get(path + "/messages?limit=101").statusCode()).isEqualTo(400);
        }
    }

    @Test
    void commitOrderAndExclusiveCatchupNeverSkipAnAllocatedSequence() throws Exception {
        var a = configured();
        var b = configured();
        String room =
                a.browser()
                        .json(a.browser().post("/chat/direct", Map.of("userId", "" + b.id())))
                        .path("id")
                        .asText();
        var snapshot = activate(a, room);
        var first = mapper.convertValue(packet(snapshot), ChatDtos.Send.class);
        var second = mapper.convertValue(packet(snapshot), ChatDtos.Send.class);
        var allocated = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one =
                    pool.submit(
                            () ->
                                    tx.execute(
                                            status -> {
                                                var sent =
                                                        service.send(
                                                                a.id(),
                                                                UUID.fromString(room),
                                                                first);
                                                allocated.countDown();
                                                try {
                                                    if (!release.await(10, TimeUnit.SECONDS))
                                                        throw new IllegalStateException(
                                                                "commit gate timed out");
                                                } catch (InterruptedException e) {
                                                    throw new RuntimeException(e);
                                                }
                                                return sent;
                                            }));
            assertThat(allocated.await(10, TimeUnit.SECONDS)).isTrue();
            var two = pool.submit(() -> service.send(b.id(), UUID.fromString(room), second));
            try {
                assertThatThrownBy(() -> two.get(200, TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {
                release.countDown();
            }
            assertThat(one.get(10, TimeUnit.SECONDS).get("sequence")).isEqualTo("1");
            assertThat(two.get(10, TimeUnit.SECONDS).get("sequence")).isEqualTo("2");
            var browser = a.browser();
            var page =
                    browser.json(browser.get("/chat/rooms/" + room + "/messages?after=0&limit=1"));
            assertThat(page.path("hasMore").asBoolean()).isTrue();
            assertThat(page.path("nextAfter").asText()).isEqualTo("1");
            var next =
                    browser.json(browser.get("/chat/rooms/" + room + "/messages?after=1&limit=1"));
            assertThat(next.path("items").get(0).path("sequence").asText()).isEqualTo("2");
        } finally {
            release.countDown();
        }
    }
}
