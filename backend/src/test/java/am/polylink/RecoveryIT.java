package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
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
            "polylink.frontend-origins=http://localhost:8001"
        })
class RecoveryIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    final IdentityIT fixture = new IdentityIT();
    final PasswordChangeIT passwords = new PasswordChangeIT();

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void init() {
        fixture.port = port;
        fixture.db = db;
        fixture.mapper = mapper;
        passwords.fixture.port = port;
        passwords.fixture.db = db;
        passwords.fixture.mapper = mapper;
        passwords.db = db;
        passwords.mapper = mapper;
        db.update("DELETE auth.RateLimits");
    }

    JsonNode verify(IdentityIT.Enrolled a, IdentityIT.Browser browser) throws Exception {
        browser.cookies.put("__Host-plk-enrollment", IdentityIT.secret());
        var challenge =
                browser.json(browser.post("/auth/recovery/request", Map.of("email", a.email())));
        var response =
                browser.post(
                        "/auth/recovery/verify",
                        Map.of(
                                "challengeId",
                                challenge.path("challengeId").asText(),
                                "code",
                                fixture.mailCode(a.email())));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return browser.json(response).path("operation");
    }

    Map<String, Object> candidate(IdentityIT.Enrolled a, JsonNode operation, boolean service)
            throws Exception {
        var input = passwords.candidate(a);
        input.put("operationId", operation.path("operationId").asText());
        input.put("kind", service ? "RECOVERY_SERVICE" : "RECOVERY_LOCAL");
        if (service) {
            input.put(
                    "vault",
                    Map.of(
                            "scheme",
                            "PLK1",
                            "nonce",
                            Secrets.encode(new byte[24]),
                            "ciphertext",
                            IdentityIT.secret()));
            input.put(
                    "identity",
                    Map.of(
                            "userId",
                            "" + a.id(),
                            "version",
                            "2",
                            "publicKey",
                            IdentityIT.secret()));
            input.put("serviceVaultKey", IdentityIT.secret());
        }
        return input;
    }

    @Test
    void serviceRecoveryRotatesAtomicallyAndCompletedCookieOnlyReplaysItsResult() throws Exception {
        var a = passwords.configured();
        var old = passwords.vault(a.id());
        var browser = fixture.new Browser();
        var op = verify(a, browser);
        var id = Map.of("operationId", op.path("operationId").asText());
        assertThat(browser.cookieHeaders.toString())
                .contains("__Host-plk-recovery=", "Secure", "HttpOnly", "Max-Age=1800");
        browser.csrf = false;
        assertThat(browser.post("/auth/recovery/unlock", id).statusCode()).isEqualTo(403);
        browser.csrf = true;
        assertThat(a.browser().post("/auth/recovery/unlock", id).statusCode()).isEqualTo(401);
        assertThat(
                        browser.post(
                                        "/auth/recovery/unlock",
                                        Map.of(
                                                "operationId",
                                                op.path("operationId").asText(),
                                                "userId",
                                                "1"))
                                .statusCode())
                .isEqualTo(400);
        var unlocked = browser.post("/auth/recovery/unlock", id);
        assertThat(unlocked.statusCode()).as(unlocked.body()).isEqualTo(200);
        var input = candidate(a, op, true);
        assertThat(browser.post("/auth/recovery/prepare", input).statusCode()).isEqualTo(200);
        assertThat(browser.post("/auth/recovery/prepare", input).statusCode()).isEqualTo(200);
        var changed = new LinkedHashMap<>(input);
        changed.put("loginSecret", IdentityIT.secret());
        assertThat(browser.post("/auth/recovery/prepare", changed).statusCode()).isEqualTo(409);
        var staged =
                Rows.query(
                                db,
                                "SELECT * FROM keyvault.Operations WHERE OperationId=?",
                                op.path("operationId").asText())
                        .getFirst();
        assertThat(staged.get("PreparedLoginVerifier").toString()).startsWith("$argon2id$");
        assertThat(
                        new String(
                                (byte[]) staged.get("PreparedCiphertext"),
                                java.nio.charset.StandardCharsets.UTF_8))
                .doesNotContain(
                        input.get("loginSecret").toString(),
                        input.get("serviceVaultKey").toString());
        assertThat(passwords.vault(a.id()).get("ServiceCopy")).isEqualTo(old.get("ServiceCopy"));
        var committed = browser.post("/auth/recovery/commit", id);
        assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
        assertThat(browser.post("/auth/recovery/commit", id).body()).isEqualTo(committed.body());
        assertThat(browser.get("/auth/recovery/status").body()).isEqualTo(committed.body());
        assertThat(browser.post("/auth/recovery/unlock", id).statusCode()).isEqualTo(409);
        assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(passwords.vault(a.id()).get("VaultKeyVersion").toString()).isEqualTo("2");
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM keyvault.Identities WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isEqualTo(2);
        db.update("UPDATE auth.AccountSecurity SET EmailFactorEnabled=1 WHERE UserId=?", a.id());
        var login =
                Map.of(
                        "email",
                        a.email(),
                        "scheme",
                        "PLK1",
                        "loginSecret",
                        input.get("loginSecret"));
        assertThat(browser.post("/auth/recovery/login", login).statusCode()).isEqualTo(200);
        assertThat(browser.post("/auth/recovery/login", login).statusCode()).isEqualTo(401);
        assertThat(browser.get("/auth/me").statusCode()).isEqualTo(200);
        var stored =
                Rows.query(
                                db,
                                "SELECT * FROM keyvault.Operations WHERE OperationId=?",
                                op.path("operationId").asText())
                        .getFirst();
        assertThat(stored.get("PreparedCiphertext")).isNull();
        assertThat(stored.get("PreparedLoginVerifier")).isNull();
    }

    @Test
    void localRecoveryPreservesKeysAndNewVerificationSupersedesOnlyUnfinishedRecovery()
            throws Exception {
        var a = passwords.configured();
        var before = passwords.vault(a.id());
        var op = verify(a, a.browser());
        var input = candidate(a, op, false);
        var unknown = fixture.new Browser();
        unknown.post("/auth/recovery/request", Map.of("email", a.email()));
        assertThat(
                        a.browser()
                                .json(a.browser().get("/auth/recovery/status"))
                                .path("state")
                                .asText())
                .isEqualTo("VERIFIED");
        assertThat(a.browser().post("/auth/recovery/prepare", input).statusCode()).isEqualTo(200);
        var result =
                a.browser()
                        .post(
                                "/auth/recovery/commit",
                                Map.of("operationId", op.path("operationId").asText()));
        assertThat(result.statusCode()).as(result.body()).isEqualTo(200);
        for (String field :
                List.of(
                        "VaultPacket",
                        "ServiceCopy",
                        "TransitContext",
                        "VaultKeyVersion",
                        "VaultRevision",
                        "IdentityVersion"))
            assertThat(passwords.vault(a.id()).get(field)).isEqualTo(before.get(field));
        var b = passwords.configured();
        var first = fixture.new Browser();
        var second = fixture.new Browser();
        var firstOp = verify(b, first);
        var secondOp = verify(b, second);
        assertThat(first.json(first.get("/auth/recovery/status")).path("state").asText())
                .isEqualTo("CANCELLED");
        assertThat(
                        first.post(
                                        "/auth/recovery/unlock",
                                        Map.of("operationId", firstOp.path("operationId").asText()))
                                .statusCode())
                .isEqualTo(409);
        db.update(
                "UPDATE keyvault.Operations SET ExpiresAt=? WHERE OperationId=?",
                OffsetDateTime.now().minusMinutes(1),
                secondOp.path("operationId").asText());
        assertThat(second.get("/auth/recovery/status").statusCode()).isEqualTo(401);
    }

    void sealed(boolean seal) throws Exception {
        var admin =
                mapper.readTree(
                        java.nio.file.Files.readString(
                                java.nio.file.Path.of(IdentityIT.required("M1_BAO_ADMIN_FILE"))));
        var request =
                java.net.http.HttpRequest.newBuilder(
                                java.net.URI.create(
                                        IdentityIT.required("OPENBAO_URL")
                                                + "/v1/sys/"
                                                + (seal ? "seal" : "unseal")))
                        .header("X-Vault-Token", admin.path("root_token").asText())
                        .header("Content-Type", "application/json")
                        .POST(
                                java.net.http.HttpRequest.BodyPublishers.ofString(
                                        seal
                                                ? "{}"
                                                : mapper.writeValueAsString(
                                                        Map.of(
                                                                "key",
                                                                admin.path("keys_base64")
                                                                        .get(0)
                                                                        .asText()))))
                        .build();
        assertThat(
                        java.net.http.HttpClient.newHttpClient()
                                .send(request, java.net.http.HttpResponse.BodyHandlers.ofString())
                                .statusCode())
                .isEqualTo(seal ? 204 : 200);
    }

    @Test
    void transitOutagesKeepOldCredentialsAndResumeTheSameImmutablePackage() throws Exception {
        var a = passwords.configured();
        var browser = fixture.new Browser();
        var op = verify(a, browser);
        var id = Map.of("operationId", op.path("operationId").asText());
        sealed(true);
        try {
            assertThat(browser.post("/auth/recovery/unlock", id).statusCode()).isEqualTo(503);
            assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(200);
            assertThat(browser.json(browser.get("/auth/recovery/status")).path("state").asText())
                    .isEqualTo("WAITING_SERVICE");
        } finally {
            sealed(false);
        }
        assertThat(browser.post("/auth/recovery/unlock", id).statusCode()).isEqualTo(200);
        var input = candidate(a, op, true);
        sealed(true);
        try {
            assertThat(browser.post("/auth/recovery/prepare", input).statusCode()).isEqualTo(503);
            assertThat(browser.post("/auth/recovery/commit", id).statusCode()).isEqualTo(409);
            assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(200);
            assertThat(passwords.vault(a.id()).get("VaultKeyVersion").toString()).isEqualTo("1");
        } finally {
            sealed(false);
        }
        assertThat(browser.post("/auth/recovery/prepare", input).statusCode()).isEqualTo(200);
        assertThat(browser.post("/auth/recovery/commit", id).statusCode()).isEqualTo(200);
    }

    @Test
    void interruptedActivationRollsBackCredentialsIdentityAndCopiesTogether() throws Exception {
        var a = passwords.configured();
        var browser = fixture.new Browser();
        var op = verify(a, browser);
        var id = Map.of("operationId", op.path("operationId").asText());
        assertThat(browser.post("/auth/recovery/unlock", id).statusCode()).isEqualTo(200);
        assertThat(browser.post("/auth/recovery/prepare", candidate(a, op, true)).statusCode())
                .isEqualTo(200);
        db.execute(
                "CREATE TRIGGER keyvault.M4RejectActivation ON keyvault.Vaults AFTER UPDATE AS THROW 51000,'Synthetic activation interruption',1;");
        try {
            assertThat(browser.post("/auth/recovery/commit", id).statusCode()).isEqualTo(503);
            assertThat(a.browser().get("/auth/me").statusCode()).isEqualTo(200);
            assertThat(passwords.vault(a.id()).get("VaultKeyVersion").toString()).isEqualTo("1");
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM keyvault.Identities WHERE UserId=?",
                                    Integer.class,
                                    a.id()))
                    .isEqualTo(1);
            assertThat(browser.json(browser.get("/auth/recovery/status")).path("state").asText())
                    .isEqualTo("READY");
        } finally {
            db.execute("DROP TRIGGER keyvault.M4RejectActivation");
        }
        assertThat(browser.post("/auth/recovery/commit", id).statusCode()).isEqualTo(200);
    }

    @Test
    void changedAccountAndConcurrentCommitCannotOverwriteNewerState() throws Exception {
        var a = passwords.configured();
        var op = verify(a, a.browser());
        var input = candidate(a, op, false);
        var id = Map.of("operationId", op.path("operationId").asText());
        assertThat(a.browser().post("/auth/recovery/prepare", input).statusCode()).isEqualTo(200);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one = pool.submit(() -> a.browser().post("/auth/recovery/commit", id));
            var two = pool.submit(() -> a.browser().post("/auth/recovery/commit", id));
            assertThat(one.get().statusCode()).isEqualTo(200);
            assertThat(two.get().statusCode()).isEqualTo(200);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT CredentialVersion FROM auth.AccountSecurity WHERE UserId=?",
                                Long.class,
                                a.id()))
                .isEqualTo(2);
        var b = passwords.configured();
        var other = fixture.new Browser();
        var otherOp = verify(b, other);
        db.update("UPDATE dbo.Users SET Email=? WHERE UserId=?", "changed-" + b.email(), b.id());
        assertThat(
                        other.post(
                                        "/auth/recovery/unlock",
                                        Map.of("operationId", otherOp.path("operationId").asText()))
                                .statusCode())
                .isEqualTo(409);
    }
}
