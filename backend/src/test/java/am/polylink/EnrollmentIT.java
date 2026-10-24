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
            "polylink.messenger.enabled=true",
            "polylink.forum.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class EnrollmentIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired EnrollmentService enrollment;
    final IdentityIT f = new IdentityIT();

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void setup() {
        f.port = port;
        f.db = db;
        f.mapper = mapper;
        db.update("DELETE auth.RateLimits");
        for (String sql :
                List.of(
                        "IF NOT EXISTS(SELECT 1 FROM dbo.Specializations) INSERT dbo.Specializations(Name) VALUES (N'Enrollment fixture')",
                        "IF NOT EXISTS(SELECT 1 FROM dbo.Departments) INSERT dbo.Departments(Name) VALUES (N'Enrollment fixture')",
                        "IF NOT EXISTS(SELECT 1 FROM dbo.Professions) INSERT dbo.Professions(Name) VALUES (N'Enrollment fixture')"))
            db.execute(sql);
    }

    record Applicant(
            IdentityIT.Browser browser,
            String email,
            String secret,
            int id,
            Map<String, Object> profile) {}

    int ref(String table, String id) {
        return db.queryForObject(
                "SELECT TOP(1) " + id + " FROM dbo." + table + " ORDER BY " + id, Integer.class);
    }

    Applicant applicant(String role) throws Exception {
        String email = "enrollment-" + UUID.randomUUID() + "@polytechnic.am",
                secret = IdentityIT.secret();
        var b = f.new Browser();
        var result =
                b.post("/auth/register", f.registration(email, role, secret, IdentityIT.salt()));
        assertThat(result.statusCode()).as(result.body()).isEqualTo(200);
        assertThat(b.json(result).path("status").asText()).isEqualTo("enrollment");
        int id =
                db.queryForObject(
                        "SELECT UserId FROM dbo.Users WHERE Email=?", Integer.class, email);
        var p = new LinkedHashMap<String, Object>();
        p.put("revision", 1);
        p.put("role", role);
        p.put("firstName", "Synthetic");
        p.put("lastName", "Fixture");
        if (role.equals("graduate")) {
            String diploma = UUID.randomUUID().toString();
            int spec = ref("Specializations", "SpecializationId");
            db.update(
                    "INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId) VALUES (N'Synthetic',N'Fixture',?,'2020-09-01','2024-06-01',?)",
                    diploma,
                    spec);
            p.put("diplomaNumber", diploma);
            p.put("specializationId", spec);
            p.put("startYear", 2020);
            p.put("endYear", 2024);
        } else {
            int dept = ref("Departments", "DepartmentId"),
                    profession = ref("Professions", "ProfessionId");
            db.update(
                    "INSERT dbo.LecturerRegistry(Email,DepartmentId,FirstName,LastName) VALUES (?,?,N'Synthetic',N'Fixture')",
                    email,
                    dept);
            p.put("departmentId", dept);
            p.put("professionId", profession);
        }
        return new Applicant(b, email, secret, id, p);
    }

    JsonNode save(Applicant a) throws Exception {
        var response = a.browser.call("PUT", "/auth/enrollment/profile", a.profile);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return a.browser.json(response);
    }

    JsonNode submit(Applicant a, long revision) throws Exception {
        var response = a.browser.post("/auth/enrollment/submit", Map.of("revision", revision));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return a.browser.json(response);
    }

    Map<String, Object> proof(Applicant a, JsonNode challenge) throws Exception {
        return Map.of(
                "challengeId", challenge.path("challengeId").asText(), "code", f.mailCode(a.email));
    }

    void login(Applicant a) throws Exception {
        var response =
                a.browser.post(
                        "/auth/login",
                        Map.of("email", a.email, "scheme", "PLK1", "loginSecret", a.secret));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    }

    void admit(Applicant a) throws Exception {
        var saved = save(a);
        var challenge = submit(a, saved.path("revision").asLong());
        var response = a.browser.post("/auth/email/verify", proof(a, challenge));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    }

    @Test
    void bothRolesRequireProfileRegistryAndEmailBeforeAnyMemberAccess() throws Exception {
        for (String role : List.of("graduate", "lecturer")) {
            var a = applicant(role);
            var b = a.browser;
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM auth.EmailChallenges WHERE UserId=?",
                                    Integer.class,
                                    a.id))
                    .isZero();
            for (String path :
                    List.of(
                            "/auth/me",
                            "/keys/me",
                            "/users/" + a.id,
                            "/search",
                            "/settings",
                            "/notifications",
                            "/chat/rooms",
                            "/forum/categories",
                            "/account/export/data?category=profile"))
                assertThat(b.get(path).statusCode()).as(path).isEqualTo(401);
            assertThat(b.post("/auth/refresh", Map.of()).statusCode()).isEqualTo(401);
            var options = b.json(b.get("/auth/enrollment/options"));
            assertThat(options.toString()).doesNotContain("DiplomaNumber", "FirstName", "Email");
            login(a);
            assertThat(b.json(b.last).path("status").asText()).isEqualTo("enrollment");
            admit(a);
            assertThat(b.get("/auth/me").statusCode()).isEqualTo(401);
            login(a);
            assertThat(
                            b.json(b.last)
                                    .path("session")
                                    .path("user")
                                    .path("onboardingComplete")
                                    .asBoolean())
                    .isTrue();
            assertThat(b.get("/auth/me").statusCode()).isEqualTo(200);
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM auth.RegistryClaims WHERE UserId=?",
                                    Integer.class,
                                    a.id))
                    .isEqualTo(1);
        }
    }

    @Test
    void occupiedRegistrationCannotReplaceCredentialsOrEnrollment() throws Exception {
        var a = applicant("graduate");
        var original = save(a);
        var attacker = f.new Browser();
        assertThat(
                        attacker.post(
                                        "/auth/register",
                                        f.registration(
                                                a.email,
                                                "lecturer",
                                                IdentityIT.secret(),
                                                IdentityIT.salt()))
                                .statusCode())
                .isEqualTo(200);
        assertThat(attacker.get("/auth/enrollment").statusCode()).isEqualTo(401);
        login(a);
        assertThat(a.browser.json(a.browser.last).path("status").asText()).isEqualTo("enrollment");
        assertThat(a.browser.json(a.browser.get("/auth/enrollment")).path("profile"))
                .isEqualTo(original.path("profile"));
    }

    @Test
    void mismatchIsEditableAndProfileRevisionInvalidatesCodes() throws Exception {
        var a = applicant("graduate");
        a.profile.put("firstName", "Wrong");
        var saved = save(a);
        assertThat(a.browser.post("/auth/enrollment/submit", Map.of("revision", 2)).statusCode())
                .isEqualTo(400);
        assertThat(
                        a.browser
                                .json(a.browser.get("/auth/enrollment"))
                                .path("profile")
                                .path("firstName")
                                .asText())
                .isEqualTo("Wrong");
        a.profile.put("firstName", "Synthetic");
        a.profile.put("revision", 2);
        save(a);
        var code = submit(a, 3);
        var proof = proof(a, code);
        a.profile.put("revision", 3);
        save(a);
        assertThat(a.browser.post("/auth/email/verify", proof).statusCode()).isEqualTo(401);
        assertThat(a.browser.call("PUT", "/auth/enrollment/profile", a.profile).statusCode())
                .isEqualTo(409);
        assertThat(
                        db.queryForObject(
                                "SELECT AdmissionStatus FROM auth.AccountSecurity WHERE UserId=?",
                                String.class,
                                a.id))
                .isEqualTo("PENDING");
    }

    @Test
    void verificationIsCsrfBrowserBoundAttemptLimitedAndSafelyRepeatable() throws Exception {
        var a = applicant("graduate");
        save(a);
        var challenge = submit(a, 2);
        var proof = proof(a, challenge);
        var b = applicant("lecturer");
        assertThat(b.browser.post("/auth/email/verify", proof).statusCode()).isEqualTo(401);
        a.browser.csrf = false;
        assertThat(a.browser.post("/auth/email/verify", proof).statusCode()).isEqualTo(401);
        a.browser.csrf = true;
        assertThat(a.browser.post("/auth/email/verify", proof).statusCode()).isEqualTo(200);
        assertThat(a.browser.post("/auth/email/verify", proof).statusCode()).isEqualTo(200);
        assertThat(
                        a.browser
                                .post(
                                        "/auth/email/verify",
                                        Map.of(
                                                "challengeId",
                                                proof.get("challengeId"),
                                                "code",
                                                "000000".equals(proof.get("code"))
                                                        ? "111111"
                                                        : "000000"))
                                .statusCode())
                .isEqualTo(401);
        db.update("DELETE auth.RateLimits");
        var limited = applicant("graduate");
        save(limited);
        var c = submit(limited, 2);
        var valid = proof(limited, c);
        for (int i = 0; i < 5; i++)
            assertThat(
                            limited.browser
                                    .post(
                                            "/auth/email/verify",
                                            Map.of(
                                                    "challengeId",
                                                    valid.get("challengeId"),
                                                    "code",
                                                    "000000".equals(valid.get("code"))
                                                            ? "111111"
                                                            : "000000"))
                                    .statusCode())
                    .isEqualTo(401);
        assertThat(
                        db.queryForObject(
                                "SELECT FailedAttempts FROM auth.EmailChallenges WHERE ChallengeId=?",
                                Integer.class,
                                valid.get("challengeId")))
                .isEqualTo(5);
        assertThat(limited.browser.post("/auth/email/verify", valid).statusCode()).isEqualTo(401);
    }

    @Test
    void concurrentClaimsAdmitAtMostOneApplicant() throws Exception {
        var a = applicant("graduate");
        var b = applicant("graduate");
        b.profile.put("diplomaNumber", a.profile.get("diplomaNumber"));
        save(a);
        save(b);
        var pa = proof(a, submit(a, 2));
        var pb = proof(b, submit(b, 2));
        try (var executor = Executors.newFixedThreadPool(2)) {
            var results =
                    executor.invokeAll(
                            List.of(
                                    () -> a.browser.post("/auth/email/verify", pa).statusCode(),
                                    () -> b.browser.post("/auth/email/verify", pb).statusCode()));
            var statuses =
                    results.stream()
                            .map(
                                    result -> {
                                        try {
                                            return result.get();
                                        } catch (Exception e) {
                                            throw new RuntimeException(e);
                                        }
                                    })
                            .toList();
            assertThat(statuses).contains(200);
            assertThat(statuses.stream().filter(v -> v.equals(200)).count()).isEqualTo(1);
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.RegistryClaims WHERE UserId IN (?,?)",
                                Integer.class,
                                a.id,
                                b.id))
                .isEqualTo(1);
    }

    @Test
    void pendingRecoveryOnlyResetsPendingCredentialsAndCannotGrantApplicationAccess()
            throws Exception {
        var a = applicant("graduate");
        var recovery = f.new Browser();
        var challenge =
                recovery.json(recovery.post("/auth/recovery/request", Map.of("email", a.email)));
        var response =
                recovery.post(
                        "/auth/recovery/verify",
                        Map.of(
                                "challengeId",
                                challenge.path("challengeId").asText(),
                                "code",
                                f.mailCode(a.email)));
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        assertThat(recovery.get("/auth/me").statusCode()).isEqualTo(401);
        String next = IdentityIT.secret();
        var input =
                Map.of(
                        "derivation",
                        f.registration(a.email, "graduate", next, IdentityIT.salt())
                                .get("derivation"),
                        "loginSecret",
                        next);
        assertThat(recovery.call("PUT", "/auth/enrollment/password", input).statusCode())
                .isEqualTo(200);
        assertThat(recovery.get("/keys/me").statusCode()).isEqualTo(401);
        assertThat(
                        recovery.post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                a.email,
                                                "scheme",
                                                "PLK1",
                                                "loginSecret",
                                                a.secret))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        recovery.post(
                                        "/auth/login",
                                        Map.of(
                                                "email",
                                                a.email,
                                                "scheme",
                                                "PLK1",
                                                "loginSecret",
                                                next))
                                .statusCode())
                .isEqualTo(200);
        assertThat(recovery.json(recovery.last).path("status").asText()).isEqualTo("enrollment");
    }

    @Test
    void expiryLogoutAndRetentionCannotBeExtendedByFailedAttempts() throws Exception {
        var a = applicant("graduate");
        db.update(
                "UPDATE auth.EnrollmentSessions SET IdleExpiresAt=? WHERE UserId=?",
                OffsetDateTime.now().minusMinutes(1),
                a.id);
        assertThat(a.browser.get("/auth/enrollment").statusCode()).isEqualTo(401);
        login(a);
        assertThat(a.browser.get("/auth/enrollment").statusCode()).isEqualTo(200);
        assertThat(a.browser.post("/auth/enrollment/logout", Map.of()).statusCode()).isEqualTo(204);
        assertThat(a.browser.get("/auth/enrollment").statusCode()).isEqualTo(401);
        login(a);
        db.update(
                "UPDATE auth.PendingEnrollments SET SavedAt=? WHERE UserId=?",
                OffsetDateTime.now().minusDays(8),
                a.id);
        assertThat(a.browser.get("/auth/enrollment").statusCode()).isEqualTo(401);
        enrollment.expire(a.id);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.AccountSecurity WHERE UserId=?",
                                Integer.class,
                                a.id))
                .isZero();
        assertThat(
                        a.browser
                                .post(
                                        "/auth/register",
                                        f.registration(
                                                a.email,
                                                "graduate",
                                                IdentityIT.secret(),
                                                IdentityIT.salt()))
                                .statusCode())
                .isEqualTo(200);
        assertThat(a.browser.get("/auth/enrollment").statusCode()).isEqualTo(200);
    }

    @Test
    void deletionAndReplayReleaseClaimsAndEmailChangePreservesThem() throws Exception {
        var a = applicant("graduate");
        admit(a);
        login(a);
        assertThat(
                        a.browser
                                .post(
                                        "/account/email-change/start",
                                        Map.of(
                                                "email",
                                                "wrong@example.invalid",
                                                "expectedCredential",
                                                "1",
                                                "loginSecret",
                                                a.secret))
                                .statusCode())
                .isEqualTo(400);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.RegistryClaims WHERE UserId=?",
                                Integer.class,
                                a.id))
                .isEqualTo(1);
        assertThat(
                        a.browser
                                .post(
                                        "/account/delete",
                                        Map.of("expectedCredential", "1", "loginSecret", a.secret))
                                .statusCode())
                .isEqualTo(200);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.RegistryClaims WHERE UserId=?",
                                Integer.class,
                                a.id))
                .isZero();
        var b = applicant("graduate");
        b.profile.put("diplomaNumber", a.profile.get("diplomaNumber"));
        admit(b);
    }
}
