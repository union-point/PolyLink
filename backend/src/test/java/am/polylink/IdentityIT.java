package am.polylink;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.regex.Pattern;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class IdentityIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    static final String ORIGIN = "http://localhost:8001";

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry registry) {
        String database = required("M1_DB_NAME");
        if (!database.startsWith("polylink_m1_"))
            throw new IllegalStateException("M1 tests require an isolated polylink_m1_ database");
        registry.add(
                "spring.datasource.url",
                () ->
                        "jdbc:sqlserver://"
                                + System.getenv().getOrDefault("DB_HOST", "localhost")
                                + ":"
                                + System.getenv().getOrDefault("DB_PORT", "1433")
                                + ";databaseName="
                                + database
                                + ";encrypt=true;trustServerCertificate=true");
        registry.add(
                "spring.datasource.username",
                () -> System.getenv().getOrDefault("DB_TEST_ADMIN_USERNAME", "sa"));
        registry.add("spring.datasource.password", () -> required("DB_TEST_ADMIN_PASSWORD"));
    }

    @BeforeEach
    void resetRateLimits() {
        db.update("DELETE auth.RateLimits");
    }

    @Test
    void settingsEmailFactorAndEmailChangePreserveSessionAuthority() throws Exception {
        var user = enroll("graduate");
        var peer = enroll("lecturer");
        var b = user.browser;
        assertThat(b.get("/settings").statusCode()).isEqualTo(200);
        assertThat(b.call("PATCH", "/settings", Map.of("twoFactorEnabled", true)).statusCode())
                .isEqualTo(400);
        assertThat(b.call("PATCH", "/settings", Map.of("showEmail", "true")).statusCode())
                .isEqualTo(400);
        assertThat(
                        b.call(
                                        "PATCH",
                                        "/settings",
                                        Map.of("isProfilePublic", false, "language", "ru"))
                                .statusCode())
                .isEqualTo(200);
        assertThat(peer.browser.get("/users/" + user.id).statusCode()).isEqualTo(404);
        String version = user.login.path("session").path("versions").path("credential").asText();
        var factor =
                Map.of("enabled", true, "loginSecret", user.secret, "expectedCredential", version);
        assertThat(b.call("PUT", "/account/email-factor", factor).statusCode()).isEqualTo(200);
        String email = "changed-" + UUID.randomUUID() + "@example.invalid";
        var start =
                b.post(
                        "/account/email-change/start",
                        Map.of(
                                "email",
                                email,
                                "loginSecret",
                                user.secret,
                                "expectedCredential",
                                version));
        assertThat(start.statusCode()).as(start.body()).isEqualTo(200);
        var challenge = b.json(start);
        assertThat(challenge.path("stage").asText()).isEqualTo("OLD");
        String id = challenge.path("requestId").asText();
        assertThat(
                        peer.browser
                                .post(
                                        "/account/email-change/verify",
                                        Map.of("requestId", id, "code", mailCode(user.email)))
                                .statusCode())
                .isEqualTo(400);
        var old =
                b.post(
                        "/account/email-change/verify",
                        Map.of("requestId", id, "code", mailCode(user.email)));
        assertThat(old.statusCode()).as(old.body()).isEqualTo(200);
        assertThat(b.json(old).path("stage").asText()).isEqualTo("NEW");
        assertThat(
                        b.post(
                                        "/account/email-change/verify",
                                        Map.of("requestId", id, "code", mailCode(email)))
                                .statusCode())
                .isEqualTo(200);
        assertThat(b.get("/auth/me").statusCode()).isEqualTo(200);
        assertThat(
                        db.queryForObject(
                                "SELECT Email FROM dbo.Users WHERE UserId=?",
                                String.class,
                                user.id))
                .isEqualTo(email);
        assertThat(
                        db.queryForObject(
                                "SELECT CredentialVersion FROM auth.AccountSecurity WHERE UserId=?",
                                Long.class,
                                user.id))
                .isEqualTo(Long.parseLong(version));
        assertThat(
                        b.call(
                                        "PUT",
                                        "/account/email-factor",
                                        Map.of(
                                                "enabled",
                                                false,
                                                "loginSecret",
                                                user.secret,
                                                "expectedCredential",
                                                version))
                                .statusCode())
                .isEqualTo(200);
        var grant =
                b.post(
                        "/account/export/authorize",
                        Map.of("loginSecret", user.secret, "expectedCredential", version));
        assertThat(grant.statusCode()).isEqualTo(200);
        assertThat(b.get("/account/export/data?category=profile").statusCode()).isEqualTo(401);
    }

    @Test
    void emailRequestsAreReplacedAttemptLimitedAndNeverChangeAddressEarly() throws Exception {
        var user = enroll("graduate");
        var b = user.browser;
        String version = user.login.path("session").path("versions").path("credential").asText();
        var input =
                Map.of(
                        "email",
                        "first-" + UUID.randomUUID() + "@example.invalid",
                        "loginSecret",
                        user.secret,
                        "expectedCredential",
                        version);
        var first = b.json(b.post("/account/email-change/start", input));
        var second = b.json(b.post("/account/email-change/start", input));
        assertThat(first.path("requestId").asText())
                .isNotEqualTo(second.path("requestId").asText());
        assertThat(
                        b.post(
                                        "/account/email-change/verify",
                                        Map.of(
                                                "requestId",
                                                first.path("requestId").asText(),
                                                "code",
                                                "123456"))
                                .statusCode())
                .isEqualTo(409);
        assertThat(
                        db.queryForObject(
                                "SELECT Email FROM dbo.Users WHERE UserId=?",
                                String.class,
                                user.id))
                .isEqualTo(user.email);
        for (int i = 0; i < 5; i++)
            assertThat(
                            b.post(
                                            "/account/email-change/verify",
                                            Map.of(
                                                    "requestId",
                                                    second.path("requestId").asText(),
                                                    "code",
                                                    "not-a-code"))
                                    .statusCode())
                    .isEqualTo(400);
        assertThat(
                        db.queryForObject(
                                "SELECT Attempts FROM auth.EmailChanges WHERE UserId=?",
                                Integer.class,
                                user.id))
                .isEqualTo(5);
        assertThat(
                        b.post(
                                        "/account/email-change/verify",
                                        Map.of(
                                                "requestId",
                                                second.path("requestId").asText(),
                                                "code",
                                                mailCode((String) input.get("email"))))
                                .statusCode())
                .isEqualTo(400);
    }

    @Test
    void rawPasswordsOriginsAndUnknownAccountsFailClosed() throws Exception {
        var browser = new Browser();
        assertThat(
                        browser.post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                "unknown@example.invalid",
                                                "password",
                                                "never-send-raw-password"))
                                .statusCode())
                .isEqualTo(400);
        var first =
                browser.json(
                        browser.post(
                                "/auth/parameters", Map.of("email", "unknown@example.invalid")));
        var second =
                browser.json(
                        browser.post(
                                "/auth/parameters", Map.of("email", "unknown@example.invalid")));
        assertThat(first).isEqualTo(second);
        assertThat(first.path("salt").asText()).hasSize(22);
        var request =
                HttpRequest.newBuilder(URI.create(url("/auth/login")))
                        .header("Content-Type", "application/json")
                        .header("Origin", "https://untrusted.invalid")
                        .POST(HttpRequest.BodyPublishers.ofString("{}"))
                        .build();
        assertThat(
                        HttpClient.newHttpClient()
                                .send(request, HttpResponse.BodyHandlers.ofString())
                                .statusCode())
                .isEqualTo(403);
        assertThat(
                        browser.post(
                                        "/auth/recovery/unlock",
                                        Map.of("operationId", UUID.randomUUID().toString()))
                                .statusCode())
                .isEqualTo(401);
    }

    @Test
    void invitationsVerificationAndTwoAccountsHaveIndependentAuthority() throws Exception {
        var one = enroll("graduate");
        var two = enroll("lecturer");
        assertThat(one.browser.get("/auth/me").statusCode()).isEqualTo(200);
        assertThat(one.browser.get("/users/" + two.id).statusCode()).isEqualTo(200);
        assertThat(one.browser.get("/keys/me").statusCode()).isEqualTo(404);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.Invitations WHERE ConsumedUserId IN (?,?)",
                                Integer.class,
                                one.id,
                                two.id))
                .isEqualTo(2);
        String stored =
                db.queryForObject(
                        "SELECT LoginVerifier FROM auth.AccountSecurity WHERE UserId=?",
                        String.class,
                        one.id);
        assertThat(stored).startsWith("$argon2id$").doesNotContain(one.secret);
        assertThat(one.login.path("session").path("keySetupRequired").asBoolean()).isTrue();
        var cookies = one.browser.cookieHeaders;
        // A login response sets a Secure HttpOnly refresh credential and a separate readable CSRF
        // cookie.
        assertThat(
                        cookies.stream()
                                .filter(value -> value.startsWith("__Host-plk-refresh="))
                                .findFirst()
                                .orElseThrow())
                .contains("Secure", "HttpOnly", "SameSite=Lax", "Path=/");
        var denied = new Browser();
        String email = "not-invited-" + UUID.randomUUID() + "@example.invalid";
        var response =
                denied.post("/auth/register", registration(email, "graduate", secret(), salt()));
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.Users WHERE Email=?",
                                Integer.class,
                                email))
                .isZero();
    }

    @Test
    void emailFactorIsInlineBrowserBoundPurposeBoundAndAttemptLimited() throws Exception {
        var account = enroll("graduate");
        db.update(
                "UPDATE auth.AccountSecurity SET EmailFactorEnabled=1 WHERE UserId=?", account.id);
        var browser = new Browser();
        var result =
                browser.json(
                        browser.post(
                                "/auth/login",
                                Map.of(
                                        "email",
                                        account.email,
                                        "scheme",
                                        "PLK1",
                                        "loginSecret",
                                        account.secret)));
        assertThat(result.path("status").asText()).isEqualTo("challenge");
        assertThat(browser.access).isNull();
        String id = result.path("challenge").path("challengeId").asText(),
                code = mailCode(account.email);
        assertThat(
                        new Browser()
                                .post("/auth/login/verify", Map.of("challengeId", id, "code", code))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        browser.post("/auth/email/verify", Map.of("challengeId", id, "code", code))
                                .statusCode())
                .isEqualTo(401);
        String wrong = code.equals("000000") ? "000001" : "000000";
        for (int n = 0; n < 5; n++)
            assertThat(
                            browser.post(
                                            "/auth/login/verify",
                                            Map.of("challengeId", id, "code", wrong))
                                    .statusCode())
                    .isEqualTo(401);
        assertThat(
                        browser.post("/auth/login/verify", Map.of("challengeId", id, "code", code))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        db.queryForObject(
                                "SELECT FailedAttempts FROM auth.EmailChallenges WHERE ChallengeId=?",
                                Integer.class,
                                id))
                .isEqualTo(5);
        var next =
                browser.json(
                        browser.post(
                                "/auth/login",
                                Map.of(
                                        "email",
                                        account.email,
                                        "scheme",
                                        "PLK1",
                                        "loginSecret",
                                        account.secret)));
        String nextId = next.path("challenge").path("challengeId").asText();
        var verified =
                browser.post(
                        "/auth/login/verify",
                        Map.of("challengeId", nextId, "code", mailCode(account.email)));
        assertThat(verified.statusCode()).isEqualTo(200);
        assertThat(browser.get("/auth/me").statusCode()).isEqualTo(200);
        assertThat(
                        browser.post(
                                        "/auth/login/verify",
                                        Map.of(
                                                "challengeId",
                                                nextId,
                                                "code",
                                                mailCode(account.email)))
                                .statusCode())
                .isIn(401, 429);
    }

    @Test
    void keySetupIsBackedUpBeforePublicationAndNeverExposesServiceUnlock() throws Exception {
        var account = enroll("graduate");
        var other = enroll("lecturer");
        var payload = packageFor(account);
        var prepared = account.browser.post("/keys/setup/prepare", payload);
        assertThat(prepared.statusCode()).isEqualTo(200);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM keyvault.Identities WHERE UserId=?",
                                Integer.class,
                                account.id))
                .isZero();
        assertThat(
                        other.browser
                                .post(
                                        "/keys/setup/commit",
                                        Map.of("operationId", payload.get("operationId")))
                                .statusCode())
                .isEqualTo(401);
        var commit =
                account.browser.post(
                        "/keys/setup/commit", Map.of("operationId", payload.get("operationId")));
        assertThat(commit.statusCode()).isEqualTo(200);
        assertThat(
                        account.browser
                                .post(
                                        "/keys/setup/commit",
                                        Map.of("operationId", payload.get("operationId")))
                                .statusCode())
                .isEqualTo(200);
        var bundle = account.browser.json(account.browser.get("/keys/me"));
        assertThat(bundle.path("versions").path("identity").asText()).isEqualTo("1");
        assertThat(bundle.has("serviceCopy")).isFalse();
        assertThat(bundle.toString())
                .doesNotContain(payload.get("serviceVaultKey").toString(), account.secret);
        assertThat(
                        account.browser
                                .post(
                                        "/auth/recovery/unlock",
                                        Map.of("operationId", payload.get("operationId")))
                                .statusCode())
                .isEqualTo(401);
        byte[] saved =
                db.queryForObject(
                        "SELECT PreparedCiphertext FROM keyvault.Operations WHERE OperationId=?",
                        byte[].class,
                        payload.get("operationId"));
        assertThat(saved).isNull();
    }

    @Test
    void refreshReplayCsrfAndImmediateCredentialRevocation() throws Exception {
        var account = enroll("graduate");
        var browser = account.browser;
        var oldCookies = new LinkedHashMap<>(browser.cookies);
        browser.csrf = false;
        assertThat(browser.post("/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
        browser.csrf = true;
        var first = browser.json(browser.post("/auth/refresh", Map.of()));
        String rotated = browser.cookies.get("__Host-plk-refresh");
        var replay = new Browser();
        replay.cookies.putAll(oldCookies);
        var second = replay.json(replay.post("/auth/refresh", Map.of()));
        assertThat(second.path("accessToken").asText())
                .isEqualTo(first.path("accessToken").asText());
        assertThat(replay.cookies.get("__Host-plk-refresh")).isEqualTo(rotated);
        db.update(
                "UPDATE auth.AccountSecurity SET CredentialVersion=CredentialVersion+1 WHERE UserId=?",
                account.id);
        assertThat(browser.get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(browser.post("/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
        var logged = enroll("lecturer");
        assertThat(logged.browser.post("/auth/logout", Map.of()).statusCode()).isEqualTo(204);
        assertThat(logged.browser.get("/auth/me").statusCode()).isEqualTo(401);
    }

    @Test
    void replacingPendingRegistrationCannotReuseAnOldProofOrMutateLegacyProfile() throws Exception {
        String email = "pending-" + UUID.randomUUID() + "@example.invalid";
        int role =
                db.queryForObject(
                        "SELECT RoleId FROM dbo.Roles WHERE Name=N'graduate'", Integer.class);
        int language =
                db.queryForObject("SELECT Id FROM dbo.Languages WHERE Code=N'en'", Integer.class);
        int user =
                db.queryForObject(
                        "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId) OUTPUT inserted.UserId VALUES (N'Legacy',N'Original',?,?,?)",
                        Integer.class,
                        email,
                        role,
                        language);
        db.update(
                "INSERT auth.Invitations(InvitationId,Email,RoleCode,ExpiresAt) VALUES (?,?,?,?)",
                UUID.randomUUID(),
                email,
                "lecturer",
                OffsetDateTime.now().plusDays(1));
        var original = new Browser();
        var first =
                original.json(
                        original.post(
                                "/auth/register",
                                registration(email, "lecturer", secret(), salt())));
        String firstId = first.path("challengeId").asText(), firstCode = mailCode(email);
        var replacement = new Browser();
        assertThat(
                        replacement
                                .post(
                                        "/auth/register",
                                        registration(email, "lecturer", secret(), salt()))
                                .statusCode())
                .isEqualTo(200);
        assertThat(
                        db.queryForObject(
                                "SELECT FirstName FROM dbo.Users WHERE UserId=?",
                                String.class,
                                user))
                .isEqualTo("Legacy");
        assertThat(
                        original.post(
                                        "/auth/email/verify",
                                        Map.of("challengeId", firstId, "code", firstCode))
                                .statusCode())
                .isEqualTo(401);
        db.update(
                "UPDATE auth.EmailChallenges SET ResendAfter=? WHERE ChallengeId=?",
                OffsetDateTime.now().minusSeconds(1),
                firstId);
        assertThat(
                        original.post("/auth/challenges/resend", Map.of("challengeId", firstId))
                                .statusCode())
                .isEqualTo(409);
        assertThat(
                        db.queryForObject(
                                "SELECT AdmissionStatus FROM auth.AccountSecurity WHERE UserId=?",
                                String.class,
                                user))
                .isEqualTo("PENDING");
        var fresh =
                original.json(
                        original.post(
                                "/auth/register",
                                registration(email, "lecturer", secret(), salt())));
        assertThat(
                        original.post(
                                        "/auth/email/verify",
                                        Map.of(
                                                "challengeId",
                                                fresh.path("challengeId").asText(),
                                                "code",
                                                mailCode(email)))
                                .statusCode())
                .isEqualTo(200);
        assertThat(
                        db.queryForObject(
                                "SELECT FirstName FROM dbo.Users WHERE UserId=?",
                                String.class,
                                user))
                .isEqualTo("Synthetic");
        assertThat(
                        db.queryForObject(
                                "SELECT r.Name FROM dbo.Users u JOIN dbo.Roles r ON r.RoleId=u.RoleId WHERE u.UserId=?",
                                String.class,
                                user))
                .isEqualTo("lecturer");
    }

    @Test
    void unavailableTransitCannotPublishAnIdentity() throws Exception {
        var account = enroll("graduate");
        var payload = packageFor(account);
        var admin = mapper.readTree(Files.readString(Path.of(required("M1_BAO_ADMIN_FILE"))));
        var http = HttpClient.newHttpClient();
        String bao = required("OPENBAO_URL");
        var seal =
                HttpRequest.newBuilder(URI.create(bao + "/v1/sys/seal"))
                        .header("X-Vault-Token", admin.path("root_token").asText())
                        .POST(HttpRequest.BodyPublishers.ofString("{}"))
                        .build();
        assertThat(http.send(seal, HttpResponse.BodyHandlers.ofString()).statusCode())
                .isEqualTo(204);
        try {
            assertThat(account.browser.post("/keys/setup/prepare", payload).statusCode())
                    .isEqualTo(503);
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM keyvault.Identities WHERE UserId=?",
                                    Integer.class,
                                    account.id))
                    .isZero();
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM keyvault.Vaults WHERE UserId=?",
                                    Integer.class,
                                    account.id))
                    .isZero();
        } finally {
            var unseal =
                    HttpRequest.newBuilder(URI.create(bao + "/v1/sys/unseal"))
                            .header("Content-Type", "application/json")
                            .POST(
                                    HttpRequest.BodyPublishers.ofString(
                                            mapper.writeValueAsString(
                                                    Map.of(
                                                            "key",
                                                            admin.path("keys_base64")
                                                                    .get(0)
                                                                    .asText()))))
                            .build();
            assertThat(http.send(unseal, HttpResponse.BodyHandlers.ofString()).statusCode())
                    .isEqualTo(200);
        }
    }

    record Enrolled(
            Browser browser,
            int id,
            String email,
            String secret,
            JsonNode derivation,
            JsonNode login) {}

    Enrolled enroll(String role) throws Exception {
        var browser = new Browser();
        String email = "m1-" + UUID.randomUUID() + "@example.invalid",
                secret = secret(),
                salt = salt();
        db.update(
                "INSERT auth.Invitations(InvitationId,Email,RoleCode,ExpiresAt) VALUES (?,?,?,?)",
                UUID.randomUUID(),
                email,
                role,
                OffsetDateTime.now().plusDays(1));
        var request = registration(email, role, secret, salt);
        var response = browser.post("/auth/register", request);
        assertThat(response.statusCode()).as("registration: %s", response.body()).isEqualTo(200);
        var challenge = browser.json(response);
        assertThat(
                        browser.post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                email,
                                                "scheme",
                                                "PLK1",
                                                "loginSecret",
                                                secret))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        browser.post(
                                        "/auth/email/verify",
                                        Map.of(
                                                "challengeId",
                                                challenge.path("challengeId").asText(),
                                                "code",
                                                mailCode(email)))
                                .statusCode())
                .isEqualTo(200);
        var login =
                browser.post(
                        "/auth/login",
                        Map.of("email", email, "scheme", "PLK1", "loginSecret", secret));
        assertThat(login.statusCode()).as("login: %s", login.body()).isEqualTo(200);
        var body = browser.json(login);
        return new Enrolled(
                browser,
                Integer.parseInt(body.path("session").path("user").path("id").asText()),
                email,
                secret,
                mapper.valueToTree(request.get("derivation")),
                body);
    }

    Map<String, Object> registration(String email, String role, String secret, String salt) {
        return Map.of(
                "email",
                email,
                "firstName",
                "Synthetic",
                "lastName",
                "Fixture",
                "role",
                role,
                "loginSecret",
                secret,
                "derivation",
                Map.of("scheme", "PLK1", "salt", salt, "opsLimit", 2, "memoryBytes", 67108864));
    }

    Map<String, Object> packageFor(Enrolled account) {
        var request = new LinkedHashMap<String, Object>();
        request.put("kind", "SETUP");
        request.put("operationId", UUID.randomUUID().toString());
        request.put("expected", account.login.path("session").path("versions"));
        request.put("derivation", account.derivation);
        request.put("loginSecret", account.secret);
        request.put("serviceVaultKey", secret());
        request.put(
                "identity",
                Map.of("userId", "" + account.id, "version", "1", "publicKey", secret()));
        request.put(
                "vault",
                Map.of(
                        "scheme",
                        "PLK1",
                        "nonce",
                        base64(new byte[24]),
                        "ciphertext",
                        base64(new byte[17])));
        request.put(
                "passwordCopy",
                Map.of(
                        "scheme",
                        "PLK1",
                        "nonce",
                        base64(new byte[24]),
                        "ciphertext",
                        base64(new byte[48])));
        return request;
    }

    String mailCode(String email) throws Exception {
        var http = HttpClient.newHttpClient();
        String base = required("M1_MAILPIT_URL");
        for (int tries = 0; tries < 20; tries++) {
            var messages =
                    mapper.readTree(
                            http.send(
                                            HttpRequest.newBuilder(
                                                            URI.create(base + "/api/v1/messages"))
                                                    .GET()
                                                    .build(),
                                            HttpResponse.BodyHandlers.ofString())
                                    .body());
            for (var item : messages.path("messages"))
                for (var to : item.path("To"))
                    if (email.equals(to.path("Address").asText())) {
                        var mail =
                                mapper.readTree(
                                        http.send(
                                                        HttpRequest.newBuilder(
                                                                        URI.create(
                                                                                base
                                                                                        + "/api/v1/message/"
                                                                                        + item.path(
                                                                                                        "ID")
                                                                                                .asText()))
                                                                .GET()
                                                                .build(),
                                                        HttpResponse.BodyHandlers.ofString())
                                                .body());
                        var found =
                                Pattern.compile("\\b[0-9]{6}\\b")
                                        .matcher(mail.path("Text").asText());
                        if (found.find()) return found.group();
                    }
            Thread.sleep(50);
        }
        throw new AssertionError("Verification email was not delivered to local capture service");
    }

    class Browser {
        final Map<String, String> cookies = new LinkedHashMap<>();
        String access;
        boolean csrf = true;
        HttpResponse<String> last;
        List<String> cookieHeaders = List.of();

        HttpResponse<String> get(String path) throws Exception {
            return call("GET", path, null);
        }

        HttpResponse<String> post(String path, Object body) throws Exception {
            return call("POST", path, body);
        }

        JsonNode json(HttpResponse<String> response) {
            return mapper.readTree(response.body());
        }

        HttpResponse<String> call(String method, String path, Object body) throws Exception {
            var request = HttpRequest.newBuilder(URI.create(url(path))).header("Origin", ORIGIN);
            if (access != null) request.header("Authorization", "Bearer " + access);
            if (!cookies.isEmpty())
                request.header(
                        "Cookie",
                        cookies.entrySet().stream()
                                .map(e -> e.getKey() + "=" + e.getValue())
                                .collect(java.util.stream.Collectors.joining("; ")));
            if (csrf) {
                String csrfName =
                        path.startsWith("/auth/recovery/")
                                ? "__Host-plk-recovery-csrf"
                                : "__Host-plk-refresh-csrf";
                if (cookies.containsKey(csrfName))
                    request.header("X-CSRF-Token", cookies.get(csrfName));
            }
            if (body != null)
                request.header("Content-Type", "application/json")
                        .method(
                                method,
                                HttpRequest.BodyPublishers.ofString(
                                        mapper.writeValueAsString(body)));
            else request.GET();
            last =
                    HttpClient.newHttpClient()
                            .send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (!last.headers().allValues("Set-Cookie").isEmpty())
                cookieHeaders = last.headers().allValues("Set-Cookie");
            for (String header : last.headers().allValues("Set-Cookie")) {
                String[] pair = header.split(";", 2)[0].split("=", 2);
                cookies.put(pair[0], pair.length > 1 ? pair[1] : "");
            }
            if (last.statusCode() == 200 && !last.body().isEmpty()) {
                var value = mapper.readTree(last.body());
                if (value.has("accessToken")) access = value.path("accessToken").asText();
            }
            return last;
        }
    }

    String url(String path) {
        return "http://localhost:" + port + path;
    }

    static String base64(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    static String secret() {
        byte[] value = new byte[32];
        new java.security.SecureRandom().nextBytes(value);
        return base64(value);
    }

    static String salt() {
        byte[] value = new byte[16];
        new java.security.SecureRandom().nextBytes(value);
        return base64(value);
    }

    static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank())
            throw new IllegalStateException("Set " + name + " using tools/m1/verify.py");
        return value;
    }
}
