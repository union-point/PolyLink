package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class PasswordChangeIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
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

    Map<String, Object> candidate(IdentityIT.Enrolled a) throws Exception {
        var bundle = a.browser().json(a.browser().get("/keys/me"));
        var request = new LinkedHashMap<String, Object>();
        request.put("operationId", UUID.randomUUID().toString());
        request.put("kind", "PASSWORD_CHANGE");
        request.put("expected", bundle.path("versions"));
        request.put(
                "derivation",
                Map.of(
                        "scheme",
                        "PLK1",
                        "salt",
                        IdentityIT.salt(),
                        "opsLimit",
                        2,
                        "memoryBytes",
                        67108864));
        request.put("loginSecret", IdentityIT.secret());
        request.put("vault", bundle.path("vault"));
        request.put("identity", bundle.path("identity"));
        request.put(
                "passwordCopy",
                Map.of(
                        "scheme",
                        "PLK1",
                        "nonce",
                        Secrets.encode(new byte[24]),
                        "ciphertext",
                        Secrets.encode(new byte[48])));
        return request;
    }

    Map<String, Object> vault(int id) {
        return Rows.query(db, "SELECT * FROM keyvault.Vaults WHERE UserId=?", id).getFirst();
    }

    @Test
    void passwordChangeAtomicallyPreservesKeysRevokesEverySessionAndReplaysOnlyItsResult()
            throws Exception {
        var a = configured();
        var stranger = configured();
        var before = vault(a.id());
        var other = fixture.new Browser();
        assertThat(
                        other.post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                a.email(),
                                                "scheme",
                                                "PLK1",
                                                "loginSecret",
                                                a.secret()))
                                .statusCode())
                .isEqualTo(200);
        var request = candidate(a);
        String id = request.get("operationId").toString();
        assertThat(a.browser().post("/auth/password-change/prepare", request).statusCode())
                .isEqualTo(200);
        assertThat(a.browser().post("/auth/password-change/prepare", request).statusCode())
                .isEqualTo(200);
        assertThat(
                        stranger.browser()
                                .post("/auth/password-change/commit", Map.of("operationId", id))
                                .statusCode())
                .isEqualTo(401);
        var altered = new LinkedHashMap<>(request);
        altered.put("loginSecret", IdentityIT.secret());
        assertThat(a.browser().post("/auth/password-change/prepare", altered).statusCode())
                .isEqualTo(409);
        altered = new LinkedHashMap<>(request);
        altered.put("serviceVaultKey", IdentityIT.secret());
        assertThat(a.browser().post("/auth/password-change/prepare", altered).statusCode())
                .isEqualTo(400);
        var staged =
                Rows.query(db, "SELECT * FROM keyvault.Operations WHERE OperationId=?", id)
                        .getFirst();
        assertThat(staged.get("PreparedLoginVerifier").toString())
                .startsWith("$argon2id$")
                .doesNotContain(request.get("loginSecret").toString());
        assertThat(
                        new String(
                                (byte[]) staged.get("PreparedCiphertext"),
                                java.nio.charset.StandardCharsets.UTF_8))
                .doesNotContain(request.get("loginSecret").toString());
        var committed = a.browser().post("/auth/password-change/commit", Map.of("operationId", id));
        assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
        assertThat(a.browser().json(committed).path("resultVersions").path("credential").asText())
                .isEqualTo("2");
        assertThat(
                        a.browser()
                                .post("/auth/password-change/commit", Map.of("operationId", id))
                                .body())
                .isEqualTo(committed.body());
        assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(other.get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(other.post("/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
        var after = vault(a.id());
        for (String field :
                List.of(
                        "VaultPacket",
                        "ServiceCopy",
                        "TransitContext",
                        "IdentityVersion",
                        "VaultRevision",
                        "VaultKeyVersion"))
            assertThat(after.get(field)).as(field).isEqualTo(before.get(field));
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM keyvault.Identities WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isEqualTo(1);
        var browser = fixture.new Browser();
        assertThat(
                        browser.post(
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
        assertThat(
                        browser.post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                a.email(),
                                                "scheme",
                                                "PLK1",
                                                "loginSecret",
                                                request.get("loginSecret")))
                                .statusCode())
                .isEqualTo(200);
        assertThat(
                        browser.json(browser.get("/keys/me"))
                                .path("versions")
                                .path("credential")
                                .asText())
                .isEqualTo("2");
        assertThat(
                        Rows.query(
                                        db,
                                        "SELECT PreparedCiphertext,PreparedLoginVerifier FROM keyvault.Operations WHERE OperationId=?",
                                        id)
                                .getFirst()
                                .values())
                .containsOnlyNulls();
        assertThat(
                        a.browser()
                                .post(
                                        "/auth/password-change/commit",
                                        Map.of("operationId", UUID.randomUUID().toString()))
                                .statusCode())
                .isEqualTo(401);
    }

    @Test
    void competingPasswordChangesHaveOneWinnerAndExpiredPackagesCannotActivate() throws Exception {
        var a = configured();
        var one = candidate(a);
        var two = candidate(a);
        for (var candidate : List.of(one, two))
            assertThat(a.browser().post("/auth/password-change/prepare", candidate).statusCode())
                    .isEqualTo(200);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = new ArrayList<Future<Integer>>();
            for (var candidate : List.of(one, two))
                futures.add(
                        pool.submit(
                                () -> {
                                    var browser = fixture.new Browser();
                                    browser.access = a.browser().access;
                                    return browser.post(
                                                    "/auth/password-change/commit",
                                                    Map.of(
                                                            "operationId",
                                                            candidate.get("operationId")))
                                            .statusCode();
                                }));
            assertThat(
                            List.of(
                                    futures.get(0).get(10, TimeUnit.SECONDS),
                                    futures.get(1).get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 401);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT CredentialVersion FROM auth.AccountSecurity WHERE UserId=?",
                                Long.class,
                                a.id()))
                .isEqualTo(2);
        var b = configured();
        var expired = candidate(b);
        assertThat(b.browser().post("/auth/password-change/prepare", expired).statusCode())
                .isEqualTo(200);
        db.update(
                "UPDATE keyvault.Operations SET ExpiresAt=DATEADD(minute,-1,SYSDATETIMEOFFSET()) WHERE OperationId=?",
                expired.get("operationId"));
        assertThat(
                        b.browser()
                                .post(
                                        "/auth/password-change/commit",
                                        Map.of("operationId", expired.get("operationId")))
                                .statusCode())
                .isEqualTo(409);
        assertThat(
                        db.queryForObject(
                                "SELECT CredentialVersion FROM auth.AccountSecurity WHERE UserId=?",
                                Long.class,
                                b.id()))
                .isEqualTo(1);
    }

    @Test
    void refreshKeepsOtherTabsAccessValidButNeverExtendsAnExpiredOrRevokedSession()
            throws Exception {
        var a = fixture.enroll("graduate");
        var old = fixture.new Browser();
        old.access = a.browser().access;
        for (int i = 0; i < 3; i++) {
            assertThat(a.browser().post("/auth/refresh", Map.of()).statusCode()).isEqualTo(200);
            assertThat(old.get("/auth/me").statusCode()).isEqualTo(200);
        }
        db.update(
                "UPDATE auth.AccessTokens SET ExpiresAt=DATEADD(minute,-1,SYSDATETIMEOFFSET()) WHERE AccessHash=?",
                Secrets.hash(old.access));
        assertThat(old.get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(200);
        db.update(
                "UPDATE auth.Sessions SET IdleExpiresAt=DATEADD(second,-1,SYSDATETIMEOFFSET()) WHERE UserId=?",
                a.id());
        assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(a.browser().post("/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
        var b = fixture.enroll("graduate");
        db.update(
                "UPDATE auth.Sessions SET IdleExpiresAt=DATEADD(second,-1,SYSDATETIMEOFFSET()),AbsoluteExpiresAt=DATEADD(second,-1,SYSDATETIMEOFFSET()) WHERE UserId=?",
                b.id());
        assertThat(b.browser().post("/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
    }
}
