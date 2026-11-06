package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.admin.*;
import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.*;
import org.springframework.test.context.*;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.admin.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
@Import(AdminIdentityIT.TimeConfiguration.class)
class AdminIdentityIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired TransactionTemplate tx;
    @Autowired TestClock clock;
    final IdentityIT f = new IdentityIT();

    static class TestClock extends Clock {
        volatile Instant instant = Instant.parse("2026-11-07T12:00:00Z");

        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        public Clock withZone(ZoneId zone) {
            return this;
        }

        public Instant instant() {
            return instant;
        }
    }

    @TestConfiguration
    static class TimeConfiguration {
        @Bean
        @Primary
        TestClock adminTestClock() {
            return new TestClock();
        }
    }

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void setup() {
        f.port = port;
        f.db = db;
        f.mapper = mapper;
        clock.instant = Instant.parse("2026-11-07T12:00:00Z");
        db.update("DELETE auth.RateLimits");
    }

    record Applicant(
            String email,
            String secret,
            String token,
            IdentityIT.Browser browser,
            JsonNode challenge) {}

    AdminCommand.Invitation invite(String email) {
        return tx.execute(
                status ->
                        db.execute(
                                (ConnectionCallback<AdminCommand.Invitation>)
                                        c -> AdminCommand.invite(c, email, clock)));
    }

    Map<String, Object> registration(String token, String secret) {
        return Map.of(
                "token",
                token,
                "firstName",
                "Admin",
                "lastName",
                "Fixture",
                "loginSecret",
                secret,
                "derivation",
                Map.of(
                        "scheme",
                        "PLK1",
                        "salt",
                        IdentityIT.salt(),
                        "opsLimit",
                        3,
                        "memoryBytes",
                        67108864));
    }

    Applicant start() throws Exception {
        String email = "admin-" + UUID.randomUUID() + "@example.org",
                secret = IdentityIT.secret(),
                token = invite(email).token();
        var b = f.new Browser();
        var response = b.post("/admin/auth/registration/start", registration(token, secret));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return new Applicant(email, secret, token, b, b.json(response));
    }

    Map<String, Object> proof(Applicant a) throws Exception {
        return Map.of(
                "challengeId",
                a.challenge.path("challengeId").asText(),
                "code",
                f.mailCode(a.email));
    }

    int finish(Applicant a) throws Exception {
        var response = a.browser.post("/admin/auth/registration/verify", proof(a));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return db.queryForObject(
                "SELECT AdminId FROM admin.Admins WHERE Email=?", Integer.class, a.email);
    }

    JsonNode login(Applicant a, IdentityIT.Browser b) throws Exception {
        var response =
                b.post(
                        "/admin/auth/login",
                        Map.of("scheme", "PLK1", "email", a.email, "loginSecret", a.secret));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return b.json(response);
    }

    void authenticate(Applicant a) throws Exception {
        var login = login(a, a.browser);
        var response =
                a.browser.post(
                        "/admin/auth/login/verify",
                        Map.of(
                                "challengeId",
                                login.path("challengeId").asText(),
                                "code",
                                f.mailCode(a.email)));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    }

    @Test
    void invitationCompletesWithoutMemberEducationRegistryOrVaultAndEveryLoginRequiresSecondFactor()
            throws Exception {
        int members = db.queryForObject("SELECT COUNT(*) FROM dbo.Users", Integer.class);
        var a = start();
        var p = proof(a);
        assertThat(a.browser.get("/admin/auth/session").statusCode()).isEqualTo(401);
        assertThat(a.browser.post("/admin/auth/registration/verify", p).statusCode())
                .isEqualTo(200);
        assertThat(a.browser.post("/admin/auth/registration/verify", p).statusCode())
                .isEqualTo(200);
        assertThat(a.browser.get("/admin/auth/session").statusCode()).isEqualTo(401);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dbo.Users", Integer.class))
                .isEqualTo(members);
        assertThat(
                        a.browser
                                .post(
                                        "/admin/auth/registration/invitation",
                                        Map.of("token", a.token))
                                .statusCode())
                .isEqualTo(401);
        var challenge = login(a, a.browser);
        assertThat(a.browser.get("/admin/auth/session").statusCode()).isEqualTo(401);
        String code = f.mailCode(a.email);
        var foreign = f.new Browser();
        assertThat(
                        foreign.post(
                                        "/admin/auth/login/verify",
                                        Map.of(
                                                "challengeId",
                                                challenge.path("challengeId").asText(),
                                                "code",
                                                code))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        a.browser
                                .post(
                                        "/admin/auth/login/verify",
                                        Map.of(
                                                "challengeId",
                                                challenge.path("challengeId").asText(),
                                                "code",
                                                code))
                                .statusCode())
                .isEqualTo(200);
        assertThat(a.browser.json(a.browser.get("/admin/auth/session")).path("role").asText())
                .isEqualTo("admin");
        assertThat(a.browser.get("/auth/me").statusCode()).isEqualTo(401);
        assertThat(
                        a.browser
                                .post(
                                        "/admin/auth/login/verify",
                                        Map.of(
                                                "challengeId",
                                                challenge.path("challengeId").asText(),
                                                "code",
                                                code))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        a.browser.cookieHeaders.stream()
                                .anyMatch(
                                        s ->
                                                s.contains("__Host-plk-admin=")
                                                        && s.contains("Secure")
                                                        && s.contains("HttpOnly")
                                                        && s.contains("SameSite=Lax")))
                .isTrue();
        var old = f.new Browser();
        old.cookies.putAll(a.browser.cookies);
        assertThat(a.browser.post("/admin/auth/refresh", Map.of()).statusCode()).isEqualTo(200);
        assertThat(old.get("/admin/auth/session").statusCode()).isEqualTo(401);
        assertThat(a.browser.post("/admin/auth/logout", Map.of()).statusCode()).isEqualTo(204);
        assertThat(a.browser.get("/admin/auth/session").statusCode()).isEqualTo(401);
    }

    @Test
    void codeFailuresCommitAndResendCannotResetAttemptBudgetOrSkipCooldown() throws Exception {
        var a = start();
        String id = a.challenge.path("challengeId").asText();
        String correct = f.mailCode(a.email),
                wrong = correct.equals("000000") ? "000001" : "000000";
        assertThat(
                        a.browser
                                .post("/admin/auth/registration/resend", Map.of("challengeId", id))
                                .statusCode())
                .isEqualTo(429);
        for (int i = 0; i < 5; i++)
            assertThat(
                            a.browser
                                    .post(
                                            "/admin/auth/registration/verify",
                                            Map.of("challengeId", id, "code", wrong))
                                    .statusCode())
                    .isEqualTo(401);
        assertThat(
                        db.queryForObject(
                                "SELECT FailedAttempts FROM admin.Challenges WHERE ChallengeId=?",
                                Integer.class,
                                UUID.fromString(id)))
                .isEqualTo(5);
        clock.instant = clock.instant.plusSeconds(61);
        assertThat(
                        a.browser
                                .post("/admin/auth/registration/resend", Map.of("challengeId", id))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        a.browser
                                .post(
                                        "/admin/auth/registration/verify",
                                        Map.of("challengeId", id, "code", correct))
                                .statusCode())
                .isEqualTo(401);
    }

    @Test
    void resendInvalidatesOldCodeAndPreservesExpiry() throws Exception {
        var a = start();
        String id = a.challenge.path("challengeId").asText();
        String old = f.mailCode(a.email);
        clock.instant = clock.instant.plusSeconds(61);
        var response = a.browser.post("/admin/auth/registration/resend", Map.of("challengeId", id));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        assertThat(a.browser.json(response).path("expiresAt").asText())
                .isEqualTo(a.challenge.path("expiresAt").asText());
        String next = f.mailCode(a.email);
        if (!next.equals(old))
            assertThat(
                            a.browser
                                    .post(
                                            "/admin/auth/registration/verify",
                                            Map.of("challengeId", id, "code", old))
                                    .statusCode())
                    .isEqualTo(401);
        assertThat(
                        a.browser
                                .post(
                                        "/admin/auth/registration/verify",
                                        Map.of("challengeId", id, "code", next))
                                .statusCode())
                .isEqualTo(200);
    }

    @Test
    void invitationExpiresAtExactly24HoursEvenWithAnActiveCode() throws Exception {
        String email = "expiry-" + UUID.randomUUID() + "@example.org",
                token = invite(email).token();
        clock.instant = clock.instant.plusSeconds(86400 - 1);
        var b = f.new Browser();
        var response =
                b.post("/admin/auth/registration/start", registration(token, IdentityIT.secret()));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        String code = f.mailCode(email);
        clock.instant = clock.instant.plusSeconds(1);
        assertThat(
                        b.post(
                                        "/admin/auth/registration/verify",
                                        Map.of(
                                                "challengeId",
                                                b.json(response).path("challengeId").asText(),
                                                "code",
                                                code))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        b.post("/admin/auth/registration/invitation", Map.of("token", token))
                                .statusCode())
                .isEqualTo(401);
    }

    @Test
    void concurrentRedemptionCreatesExactlyOneAdminAndDifferentInvitationCannotOverwriteIt()
            throws Exception {
        var a = start();
        var payload = proof(a);
        var twin = f.new Browser();
        twin.cookies.putAll(a.browser.cookies);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var jobs =
                    pool.invokeAll(
                            List.<Callable<Integer>>of(
                                    () ->
                                            a.browser
                                                    .post(
                                                            "/admin/auth/registration/verify",
                                                            payload)
                                                    .statusCode(),
                                    () ->
                                            twin.post("/admin/auth/registration/verify", payload)
                                                    .statusCode()));
            for (var job : jobs) assertThat(job.get()).isEqualTo(200);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM admin.Admins WHERE Email=?",
                                Integer.class,
                                a.email))
                .isEqualTo(1);
        assertThatThrownBy(() -> invite(a.email)).hasMessageContaining("already exists");
    }

    @Test
    void distinctBrowsersCannotBothRedeemOneInvitation() throws Exception {
        var a = start();
        var firstProof = proof(a);
        var b = f.new Browser();
        var response = b.post("/admin/auth/registration/start", registration(a.token, a.secret));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        var secondProof =
                Map.of(
                        "challengeId",
                        b.json(response).path("challengeId").asText(),
                        "code",
                        f.mailCode(a.email));
        try (var pool = Executors.newFixedThreadPool(2)) {
            var jobs =
                    pool.invokeAll(
                            List.<Callable<Integer>>of(
                                    () ->
                                            a.browser
                                                    .post(
                                                            "/admin/auth/registration/verify",
                                                            firstProof)
                                                    .statusCode(),
                                    () ->
                                            b.post("/admin/auth/registration/verify", secondProof)
                                                    .statusCode()));
            assertThat(List.of(jobs.get(0).get(), jobs.get(1).get()))
                    .containsExactlyInAnyOrder(200, 401);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM admin.Admins WHERE Email=?",
                                Integer.class,
                                a.email))
                .isEqualTo(1);
    }

    @Test
    void csrfPurposeAndDomainBoundariesAreEnforced() throws Exception {
        var a = start();
        var payload = proof(a);
        a.browser.csrf = false;
        assertThat(a.browser.post("/admin/auth/registration/verify", payload).statusCode())
                .isEqualTo(403);
        a.browser.csrf = true;
        assertThat(a.browser.post("/admin/auth/login/verify", payload).statusCode()).isEqualTo(401);
        var fields = new HashMap<>(registration(a.token, a.secret));
        fields.put("email", "substitute@example.org");
        assertThat(a.browser.post("/admin/auth/registration/start", fields).statusCode())
                .isEqualTo(400);
        finish(a);
        authenticate(a);
        a.browser.csrf = false;
        assertThat(a.browser.post("/admin/auth/refresh", Map.of()).statusCode()).isEqualTo(403);
        assertThat(a.browser.post("/admin/auth/logout", Map.of()).statusCode()).isEqualTo(403);
    }

    @Test
    void disableRevokesActiveSessionsAndPendingLoginProofsAndCannotBeBypassedWithPassword()
            throws Exception {
        var a = start();
        int id = finish(a);
        authenticate(a);
        var other = f.new Browser();
        var challenge = login(a, other);
        String code = f.mailCode(a.email);
        tx.executeWithoutResult(
                status ->
                        db.execute(
                                (ConnectionCallback<Void>)
                                        c -> {
                                            AdminCommand.disable(c, id, clock);
                                            return null;
                                        }));
        assertThat(a.browser.get("/admin/auth/session").statusCode()).isEqualTo(401);
        assertThat(a.browser.post("/admin/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
        assertThat(
                        other.post(
                                        "/admin/auth/login/verify",
                                        Map.of(
                                                "challengeId",
                                                challenge.path("challengeId").asText(),
                                                "code",
                                                code))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        a.browser
                                .post(
                                        "/admin/auth/login",
                                        Map.of(
                                                "scheme",
                                                "PLK1",
                                                "email",
                                                a.email,
                                                "loginSecret",
                                                a.secret))
                                .statusCode())
                .isEqualTo(401);
    }

    @Test
    void sessionExpiresAtIdleBoundaryAndCleanupRemovesExpiredDrafts() throws Exception {
        var a = start();
        finish(a);
        authenticate(a);
        clock.instant = clock.instant.plusSeconds(1800);
        assertThat(a.browser.get("/admin/auth/session").statusCode()).isEqualTo(401);
        clock.instant = clock.instant.plusSeconds(86400);
        new AdminCleanup(db, clock).expire();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM admin.Invitations WHERE TokenHash=?",
                                Integer.class,
                                Secrets.hash(a.token)))
                .isZero();
    }
}
