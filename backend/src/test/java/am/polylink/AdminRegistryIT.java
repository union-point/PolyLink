package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.admin.*;
import am.polylink.auth.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.*;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.admin.enabled=true",
            "polylink.messenger.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class AdminRegistryIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired TransactionTemplate tx;
    @Autowired AdminSessions sessions;
    @Autowired AdminRegistries registries;
    @Autowired EnrollmentService enrollment;
    final AdminReferencesIT f = new AdminReferencesIT();
    final EnrollmentIT e = new EnrollmentIT();
    IdentityIT.Browser browser;
    String department, specialization;
    static final String ROOT = "/admin/registries/";

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void setup() throws Exception {
        f.port = port;
        f.db = db;
        f.mapper = mapper;
        f.tx = tx;
        f.sessions = sessions;
        f.setup();
        browser = f.browser;
        e.port = port;
        e.db = db;
        e.mapper = mapper;
        e.enrollment = enrollment;
        e.setup();
        department =
                db.queryForObject(
                                "SELECT TOP(1) DepartmentId FROM dbo.Departments ORDER BY DepartmentId",
                                Integer.class)
                        .toString();
        specialization =
                db.queryForObject(
                                "SELECT TOP(1) SpecializationId FROM dbo.Specializations ORDER BY SpecializationId",
                                Integer.class)
                        .toString();
    }

    Map<String, Object> input(String kind, String identity) {
        var result = new LinkedHashMap<String, Object>();
        result.put("firstName", "Արամ");
        result.put("lastName", "Fixture");
        if (kind.equals("lecturers")) {
            result.put("email", identity);
            result.put("departmentId", department);
        } else {
            result.put("diplomaNumber", identity);
            result.put("specializationId", specialization);
            result.put("studyStartDate", "2020-09-01");
            result.put("studyEndDate", "2024-06-01");
        }
        return result;
    }

    JsonNode create(String kind, Map<String, Object> input) throws Exception {
        var response = browser.post(ROOT + kind, input);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
        return browser.json(response);
    }

    JsonNode create(String kind) throws Exception {
        return create(
                kind,
                input(
                        kind,
                        UUID.randomUUID() + (kind.equals("lecturers") ? "@polytechnic.am" : "")));
    }

    JsonNode detail(String kind, String id) throws Exception {
        var response = browser.get(ROOT + kind + "/" + id);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return browser.json(response);
    }

    Map<String, Object> edit(String kind, JsonNode value) {
        var fields =
                input(
                        kind,
                        value.path(kind.equals("lecturers") ? "email" : "diplomaNumber").asText());
        fields.put("version", value.path("version").asText());
        return fields;
    }

    void failure(HttpResponse<String> response, int status, String code) {
        f.failure(response, status, code);
    }

    @Test
    void bothRegistriesRoundTripWithoutCreatingMembersOrChangingProvenance() throws Exception {
        int members = db.queryForObject("SELECT COUNT(*) FROM dbo.Users", Integer.class);
        for (String kind : List.of("lecturers", "alumni")) {
            var value = create(kind);
            String id = value.path("id").asText(), path = ROOT + kind + "/" + id;
            String table = kind.equals("lecturers") ? "LecturerRegistry" : "AlumniRegistry";
            String key = kind.equals("lecturers") ? "LecturerRegistryId" : "AlumniRegistryId";
            var provenance =
                    db.queryForObject(
                            "SELECT ImportedAt FROM dbo." + table + " WHERE " + key + "=?",
                            Object.class,
                            id);
            assertThat(value.path("linked").asBoolean()).isFalse();
            assertThat(value.path("needsCorrection").asBoolean()).isFalse();
            assertThat(detail(kind, id)).isEqualTo(value);
            assertThat(value.toString())
                    .doesNotContain("KeySourceHash", "EmailKey", "DiplomaKey", "UserId");
            var update = edit(kind, value);
            update.put("lastName", "<b>Plain reference text</b>");
            var response = browser.call("PUT", path, update);
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
            var current = browser.json(response);
            assertThat(current.path("id")).isEqualTo(value.path("id"));
            assertThat(current.path("lastName").asText()).isEqualTo("<b>Plain reference text</b>");
            assertThat(current.path("version")).isNotEqualTo(value.path("version"));
            assertThat(
                            db.queryForObject(
                                    "SELECT ImportedAt FROM dbo." + table + " WHERE " + key + "=?",
                                    Object.class,
                                    id))
                    .isEqualTo(provenance);
            failure(browser.call("PUT", path, update), 409, "VERSION_CONFLICT");
            failure(
                    browser.call("DELETE", path, Map.of("version", value.path("version").asText())),
                    409,
                    "VERSION_CONFLICT");
            assertThat(
                            browser.call(
                                            "DELETE",
                                            path,
                                            Map.of("version", current.path("version").asText()))
                                    .statusCode())
                    .isEqualTo(204);
            failure(browser.get(path), 404, "NOT_FOUND");
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dbo.Users", Integer.class))
                .isEqualTo(members);
    }

    @Test
    void enforcesNormalizedUniquenessAndAcceptsFullUnicodeDiplomas() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        create("lecturers", input("lecturers", " OWNER-" + suffix + "@Example.org "));
        failure(
                browser.post(
                        ROOT + "lecturers", input("lecturers", "owner-" + suffix + "@example.org")),
                409,
                "DUPLICATE_EMAIL");
        var diploma = create("alumni", input("alumni", "ＡＢＣ\u00a0 １２３ " + suffix));
        failure(
                browser.post(ROOT + "alumni", input("alumni", "abc 123 " + suffix)),
                409,
                "DUPLICATE_DIPLOMA");
        var result =
                browser.json(
                        browser.get(
                                ROOT
                                        + "alumni?q="
                                        + URLEncoder.encode(
                                                "abc 123 " + suffix, StandardCharsets.UTF_8)));
        assertThat(result.path("items")).hasSize(1);
        assertThat(result.path("items").get(0).path("id")).isEqualTo(diploma.path("id"));
        for (String distinct : List.of("é ", "e ", "ß ", "ss "))
            create("alumni", input("alumni", distinct + suffix));
        create("alumni", input("alumni", "ﷺ".repeat(100)));
        var other = create("alumni");
        var duplicate = edit("alumni", other);
        duplicate.put("diplomaNumber", "abc 123 " + suffix);
        failure(
                browser.call("PUT", ROOT + "alumni/" + other.path("id").asText(), duplicate),
                409,
                "DUPLICATE_DIPLOMA");
    }

    @Test
    void validatesAllFieldsReferencesDatesAndSecurityFieldAllowlists() throws Exception {
        for (String kind : List.of("unknown", "graduate", "Lecturers"))
            failure(browser.get(ROOT + kind), 404, "NOT_FOUND");
        for (String field :
                List.of("userId", "role", "linked", "ImportedAt", "EmailKey", "KeySourceHash")) {
            var payload = input("lecturers", UUID.randomUUID() + "@example.org");
            payload.put(field, "forged");
            failure(browser.post(ROOT + "lecturers", payload), 400, "VALIDATION");
        }
        for (String field : List.of("firstName", "lastName"))
            for (Object value : List.of("", "\u00a0", "x".repeat(101), "line\nbreak", 123)) {
                var payload = input("lecturers", UUID.randomUUID() + "@example.org");
                payload.put(field, value);
                failure(browser.post(ROOT + "lecturers", payload), 400, "VALIDATION");
            }
        for (String email :
                List.of(
                        "a",
                        "a@@example.org",
                        "a@b..org",
                        "a@\u00a0example.org",
                        "a\nb@example.org"))
            failure(browser.post(ROOT + "lecturers", input("lecturers", email)), 400, "VALIDATION");
        for (Object reference : List.of("0", "-1", "2147483648", "2147483647", 1, true)) {
            var payload = input("alumni", UUID.randomUUID().toString());
            payload.put("specializationId", reference);
            failure(browser.post(ROOT + "alumni", payload), 400, "VALIDATION");
        }
        for (String date :
                List.of("2023-02-29", "2024-13-01", "2024-01", "0000-01-01", "2024-2-01")) {
            var payload = input("alumni", UUID.randomUUID().toString());
            payload.put("studyStartDate", date);
            failure(browser.post(ROOT + "alumni", payload), 400, "VALIDATION");
        }
        var reversed = input("alumni", UUID.randomUUID().toString());
        reversed.put("studyStartDate", "2025-01-01");
        failure(browser.post(ROOT + "alumni", reversed), 400, "VALIDATION");
        var leap = input("alumni", UUID.randomUUID().toString());
        leap.put("studyStartDate", "2024-02-29");
        create("alumni", leap);
        var record = create("lecturers");
        String path = ROOT + "lecturers/" + record.path("id").asText();
        failure(browser.call("DELETE", path, Map.of()), 400, "VALIDATION");
        failure(browser.call("DELETE", path, Map.of("version", "invalid")), 400, "VALIDATION");
        failure(browser.get(ROOT + "alumni/2147483647"), 404, "NOT_FOUND");
    }

    @Test
    void legacyIncompleteRecordsRemainVisibleAndCanBeCorrectedWhileUnlinked() throws Exception {
        String email = UUID.randomUUID() + "@example.org";
        int id =
                db.queryForObject(
                        "INSERT dbo.LecturerRegistry(Email,EmailKey,KeySourceHash) OUTPUT inserted.LecturerRegistryId VALUES (?,?,?)",
                        Integer.class,
                        email,
                        RegistryKeys.lecturer(email),
                        RegistryKeys.source(email));
        var value = detail("lecturers", "" + id);
        assertThat(value.path("needsCorrection").asBoolean()).isTrue();
        assertThat(value.path("firstName").isNull()).isTrue();
        assertThat(value.path("departmentId").isNull()).isTrue();
        var updated = browser.call("PUT", ROOT + "lecturers/" + id, edit("lecturers", value));
        assertThat(updated.statusCode()).as(updated.body()).isEqualTo(200);
        assertThat(browser.json(updated).path("needsCorrection").asBoolean()).isFalse();
    }

    @Test
    void searchIsLiteralBoundedAndCursorsAreQueryBound() throws Exception {
        String prefix = "Paging " + UUID.randomUUID();
        for (int i = 0; i < 53; i++) {
            String email = UUID.randomUUID() + "@example.org";
            db.update(
                    "INSERT dbo.LecturerRegistry(FirstName,LastName,Email,DepartmentId,EmailKey,KeySourceHash) VALUES (?,N'Fixture',?,?,?,?)",
                    prefix,
                    email,
                    Integer.parseInt(department),
                    RegistryKeys.lecturer(email),
                    RegistryKeys.source(email));
        }
        String query = URLEncoder.encode(prefix, StandardCharsets.UTF_8);
        var first = browser.json(browser.get(ROOT + "lecturers?q=" + query));
        assertThat(first.path("items")).hasSize(50);
        String cursor = first.path("nextCursor").asText();
        var second = browser.json(browser.get(ROOT + "lecturers?q=" + query + "&cursor=" + cursor));
        assertThat(second.path("items")).hasSize(3);
        assertThat(second.path("nextCursor").isNull()).isTrue();
        var ids = new HashSet<String>();
        first.path("items").forEach(v -> assertThat(ids.add(v.path("id").asText())).isTrue());
        second.path("items").forEach(v -> assertThat(ids.add(v.path("id").asText())).isTrue());
        failure(browser.get(ROOT + "lecturers?cursor=" + cursor), 400, "VALIDATION");
        failure(browser.get(ROOT + "alumni?q=" + query + "&cursor=" + cursor), 400, "VALIDATION");
        failure(
                browser.get(ROOT + "lecturers?q=" + query + "&cursor=" + cursor + "x"),
                400,
                "VALIDATION");
        failure(browser.get(ROOT + "alumni?q=" + "x".repeat(256)), 400, "VALIDATION");
        var payload = input("alumni", UUID.randomUUID().toString());
        payload.put("firstName", "Literal ~%_[");
        var literal = create("alumni", payload);
        var found =
                browser.json(
                        browser.get(
                                ROOT
                                        + "alumni?q="
                                        + URLEncoder.encode("~%_[", StandardCharsets.UTF_8)));
        assertThat(found.path("items")).hasSize(1);
        assertThat(found.path("items").get(0).path("id")).isEqualTo(literal.path("id"));
        assertThat(browser.json(browser.get(ROOT + "alumni?q=" + UUID.randomUUID())).path("items"))
                .isEmpty();
    }

    @Test
    void requiresCurrentAdminAuthenticationCsrfAndAllowedOrigin() throws Exception {
        var value = create("lecturers");
        String path = ROOT + "lecturers/" + value.path("id").asText();
        for (var unauthorized : List.of(f.f.new Browser(), f.f.enroll("graduate").browser())) {
            assertThat(unauthorized.get(ROOT + "lecturers").statusCode()).isEqualTo(401);
            assertThat(unauthorized.get(path).statusCode()).isEqualTo(401);
            assertThat(
                            unauthorized
                                    .post(
                                            ROOT + "lecturers",
                                            input("lecturers", UUID.randomUUID() + "@example.org"))
                                    .statusCode())
                    .isEqualTo(401);
        }
        browser.csrf = false;
        failure(browser.call("PUT", path, edit("lecturers", value)), 403, "FORBIDDEN");
        browser.csrf = true;
        var request =
                HttpRequest.newBuilder(URI.create(f.f.url(path)))
                        .header("Origin", "https://invalid.example")
                        .header("Content-Type", "application/json")
                        .header(
                                "Cookie",
                                AdminSessions.SESSION
                                        + "="
                                        + browser.cookies.get(AdminSessions.SESSION))
                        .header("X-CSRF-Token", browser.cookies.get(AdminSessions.CSRF))
                        .method(
                                "DELETE",
                                HttpRequest.BodyPublishers.ofString(
                                        mapper.writeValueAsString(
                                                Map.of("version", value.path("version").asText()))))
                        .build();
        assertThat(
                        HttpClient.newHttpClient()
                                .send(request, HttpResponse.BodyHandlers.ofString())
                                .statusCode())
                .isEqualTo(403);
        db.update(
                "UPDATE admin.Sessions SET IdleExpiresAt=? WHERE AdminId=?",
                OffsetDateTime.now().minusMinutes(1),
                f.admin);
        assertThat(browser.get(ROOT + "lecturers").statusCode()).isEqualTo(401);
        db.update(
                "UPDATE admin.Sessions SET IdleExpiresAt=? WHERE AdminId=?",
                OffsetDateTime.now().plusMinutes(10),
                f.admin);
        tx.executeWithoutResult(
                status ->
                        db.execute(
                                (ConnectionCallback<Void>)
                                        c -> {
                                            AdminCommand.disable(
                                                    c, f.admin, java.time.Clock.systemUTC());
                                            return null;
                                        }));
        assertThat(browser.get(path).statusCode()).isEqualTo(401);
        assertThat(browser.call("PUT", path, edit("lecturers", value)).statusCode()).isEqualTo(401);
        assertThat(
                        browser.call(
                                        "DELETE",
                                        path,
                                        Map.of("version", value.path("version").asText()))
                                .statusCode())
                .isEqualTo(401);
    }

    String registryId(EnrollmentIT.Applicant a, String kind) {
        return db.queryForObject(
                        kind.equals("lecturers")
                                ? "SELECT LecturerRegistryId FROM dbo.LecturerRegistry WHERE EmailKey=?"
                                : "SELECT AlumniRegistryId FROM dbo.AlumniRegistry WHERE DiplomaKey=?",
                        Integer.class,
                        kind.equals("lecturers")
                                ? RegistryKeys.lecturer(a.email())
                                : RegistryKeys.diploma((String) a.profile().get("diplomaNumber")))
                .toString();
    }

    @Test
    void linkedAndDeactivatedClaimsRemainImmutableUntilActualAccountDeletion() throws Exception {
        for (String kind : List.of("lecturers", "alumni")) {
            var applicant = e.applicant(kind.equals("lecturers") ? "lecturer" : "graduate");
            e.admit(applicant);
            e.login(applicant);
            String id = registryId(applicant, kind), path = ROOT + kind + "/" + id;
            var value = detail(kind, id);
            assertThat(value.path("linked").asBoolean()).isTrue();
            failure(browser.call("PUT", path, edit(kind, value)), 409, "RECORD_LINKED");
            failure(
                    browser.call("DELETE", path, Map.of("version", value.path("version").asText())),
                    409,
                    "RECORD_LINKED");
            var credentials = Map.of("expectedCredential", "1", "loginSecret", applicant.secret());
            assertThat(applicant.browser().post("/account/deactivate", credentials).statusCode())
                    .isEqualTo(200);
            failure(
                    browser.call("DELETE", path, Map.of("version", value.path("version").asText())),
                    409,
                    "RECORD_LINKED");
            db.update(
                    "UPDATE auth.AccountSecurity SET AdmissionStatus='ADMITTED' WHERE UserId=?",
                    applicant.id());
            e.login(applicant);
            assertThat(applicant.browser().post("/account/delete", credentials).statusCode())
                    .isEqualTo(200);
            assertThat(detail(kind, id).path("linked").asBoolean()).isFalse();
            assertThat(
                            browser.call(
                                            "DELETE",
                                            path,
                                            Map.of("version", value.path("version").asText()))
                                    .statusCode())
                    .isEqualTo(204);
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM auth.RegistryClaimAudit WHERE UserId=? AND Action='RELEASE'",
                                    Integer.class,
                                    applicant.id()))
                    .isEqualTo(1);
        }
    }

    void awaitBlocked() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            if (db.queryForObject(
                            "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id=@@SPID",
                            Integer.class)
                    > 0) return;
            try {
                Thread.sleep(10);
            } catch (InterruptedException interrupted) {
                throw new RuntimeException(interrupted);
            }
        }
        throw new AssertionError(
                "Expected the competing SQL request to wait for the owning transaction");
    }

    MockHttpServletRequest enrollmentRequest(EnrollmentIT.Applicant applicant) {
        var request = new MockHttpServletRequest("POST", "/auth/email/verify");
        request.setRemoteAddr("127.0.0.1");
        request.setCookies(
                applicant.browser().cookies.entrySet().stream()
                        .map(
                                entry ->
                                        new jakarta.servlet.http.Cookie(
                                                entry.getKey(), entry.getValue()))
                        .toArray(jakarta.servlet.http.Cookie[]::new));
        request.addHeader(
                "X-CSRF-Token", applicant.browser().cookies.get("__Host-plk-enrollment-csrf"));
        return request;
    }

    @Test
    void editOrDeleteWinningTheRaceMakesAdmissionRecheckCurrentRegistryData() throws Exception {
        for (String kind : List.of("lecturers", "alumni"))
            for (boolean delete : List.of(false, true)) {
                var a = e.applicant(kind.equals("lecturers") ? "lecturer" : "graduate");
                var saved = e.save(a);
                var proof = e.proof(a, e.submit(a, saved.path("revision").asLong()));
                String id = registryId(a, kind);
                var value = detail(kind, id);
                try (var executor = Executors.newSingleThreadExecutor()) {
                    var pending = new ArrayList<Future<HttpResponse<String>>>();
                    tx.executeWithoutResult(
                            status -> {
                                if (delete)
                                    registries.delete(
                                            kind,
                                            Integer.parseInt(id),
                                            Map.of("version", value.path("version").asText()),
                                            f.request("DELETE"));
                                else {
                                    var update = edit(kind, value);
                                    update.put("firstName", "Edited before admission");
                                    registries.update(
                                            kind, Integer.parseInt(id), update, f.request("PUT"));
                                }
                                pending.add(
                                        executor.submit(
                                                () ->
                                                        a.browser()
                                                                .post(
                                                                        "/auth/email/verify",
                                                                        proof)));
                                awaitBlocked();
                            });
                    var response = pending.getFirst().get(10, TimeUnit.SECONDS);
                    assertThat(response.statusCode()).as(response.body()).isEqualTo(400);
                    assertThat(browser.json(response).path("code").asText())
                            .isEqualTo("REGISTRY_MISMATCH");
                }
                assertThat(
                                db.queryForObject(
                                        "SELECT COUNT(*) FROM auth.RegistryClaims WHERE UserId=?",
                                        Integer.class,
                                        a.id()))
                        .isZero();
            }
    }

    @Test
    void admissionWinningTheRaceLocksTheRegistryAgainstAdminMutation() throws Exception {
        for (String kind : List.of("lecturers", "alumni")) {
            var a = e.applicant(kind.equals("lecturers") ? "lecturer" : "graduate");
            var saved = e.save(a);
            var proof = e.proof(a, e.submit(a, saved.path("revision").asLong()));
            String id = registryId(a, kind);
            var value = detail(kind, id);
            try (var executor = Executors.newSingleThreadExecutor()) {
                var pending = new ArrayList<Future<HttpResponse<String>>>();
                tx.executeWithoutResult(
                        status -> {
                            enrollment.verifyEmail(
                                    new AuthDtos.CodeProof(
                                            UUID.fromString((String) proof.get("challengeId")),
                                            (String) proof.get("code")),
                                    enrollmentRequest(a));
                            pending.add(
                                    executor.submit(
                                            () ->
                                                    browser.call(
                                                            "PUT",
                                                            ROOT + kind + "/" + id,
                                                            edit(kind, value))));
                            awaitBlocked();
                        });
                failure(pending.getFirst().get(10, TimeUnit.SECONDS), 409, "RECORD_LINKED");
            }
        }
    }

    @Test
    void concurrentAdminsCannotOverwriteOrDuplicateAnIdentity() throws Exception {
        var other = f.administrator();
        for (String kind : List.of("lecturers", "alumni")) {
            var value = create(kind);
            String id = value.path("id").asText();
            try (var executor = Executors.newFixedThreadPool(2)) {
                var barrier = new CyclicBarrier(2);
                var results = new ArrayList<Future<String>>();
                for (var identity : List.of(browser, other))
                    results.add(
                            executor.submit(
                                    () -> {
                                        barrier.await(5, TimeUnit.SECONDS);
                                        var update = edit(kind, value);
                                        update.put("lastName", UUID.randomUUID().toString());
                                        try {
                                            registries.update(
                                                    kind,
                                                    Integer.parseInt(id),
                                                    update,
                                                    f.request("PUT", identity));
                                            return "saved";
                                        } catch (RuntimeException conflict) {
                                            return conflict.getMessage();
                                        }
                                    }));
                assertThat(
                                List.of(
                                        results.get(0).get(10, TimeUnit.SECONDS),
                                        results.get(1).get(10, TimeUnit.SECONDS)))
                        .containsExactlyInAnyOrder(
                                "saved",
                                "This record changed. Reload the current version before saving.");
            }
            String key = UUID.randomUUID() + (kind.equals("lecturers") ? "@example.org" : "");
            try (var executor = Executors.newFixedThreadPool(2)) {
                var barrier = new CyclicBarrier(2);
                var results = new ArrayList<Future<String>>();
                for (var identity : List.of(browser, other))
                    results.add(
                            executor.submit(
                                    () -> {
                                        barrier.await(5, TimeUnit.SECONDS);
                                        try {
                                            registries.create(
                                                    kind,
                                                    input(kind, key),
                                                    f.request("POST", identity));
                                            return "created";
                                        } catch (RuntimeException conflict) {
                                            return conflict.getMessage();
                                        }
                                    }));
                assertThat(
                                List.of(
                                        results.get(0).get(10, TimeUnit.SECONDS),
                                        results.get(1).get(10, TimeUnit.SECONDS)))
                        .containsExactlyInAnyOrder(
                                "created", "A registry record with this identity already exists.");
            }
        }
    }

    @Test
    void directClaimCreationAndLocalDisableSerializeWithRegistryMutation() throws Exception {
        var value = create("lecturers");
        int id = value.path("id").asInt();
        int member = f.f.enroll("lecturer").id();
        try (var executor = Executors.newSingleThreadExecutor()) {
            var pending = new ArrayList<Future<HttpResponse<String>>>();
            tx.executeWithoutResult(
                    status -> {
                        db.update(
                                "INSERT auth.RegistryClaims(UserId,LecturerRegistryId,VerifiedAt,ProfileRevision) VALUES (?,?,SYSDATETIMEOFFSET(),1)",
                                member,
                                id);
                        pending.add(
                                executor.submit(
                                        () ->
                                                browser.call(
                                                        "DELETE",
                                                        ROOT + "lecturers/" + id,
                                                        Map.of(
                                                                "version",
                                                                value.path("version").asText()))));
                        awaitBlocked();
                    });
            failure(pending.getFirst().get(10, TimeUnit.SECONDS), 409, "RECORD_LINKED");
            var unlinked = create("alumni");
            int target = unlinked.path("id").asInt();
            var disabling = new ArrayList<Future<Void>>();
            tx.executeWithoutResult(
                    status -> {
                        registries.update(
                                "alumni", target, edit("alumni", unlinked), f.request("PUT"));
                        disabling.add(
                                executor.submit(
                                        () -> {
                                            tx.executeWithoutResult(
                                                    worker ->
                                                            db.execute(
                                                                    (ConnectionCallback<Void>)
                                                                            c -> {
                                                                                AdminCommand
                                                                                        .disable(
                                                                                                c,
                                                                                                f.admin,
                                                                                                java
                                                                                                        .time
                                                                                                        .Clock
                                                                                                        .systemUTC());
                                                                                return null;
                                                                            }));
                                            return null;
                                        }));
                        awaitBlocked();
                    });
            disabling.getFirst().get(10, TimeUnit.SECONDS);
            assertThat(
                            browser.call(
                                            "DELETE",
                                            ROOT + "alumni/" + target,
                                            Map.of("version", unlinked.path("version").asText()))
                                    .statusCode())
                    .isEqualTo(401);
        }
    }

    @Test
    void registryLinkInventoryMatchesTheCanonicalClaimBoundary() {
        assertThat(
                        db.queryForList(
                                """
            SELECT OBJECT_SCHEMA_NAME(c.parent_object_id)+'.'+OBJECT_NAME(c.parent_object_id)+'.'+COL_NAME(c.parent_object_id,c.parent_column_id)
            FROM sys.foreign_key_columns c WHERE OBJECT_NAME(c.referenced_object_id) IN ('LecturerRegistry','AlumniRegistry')
            """,
                                String.class))
                .containsExactlyInAnyOrder(
                        "auth.RegistryClaims.LecturerRegistryId",
                        "auth.RegistryClaims.AlumniRegistryId");
    }

    @Test
    void offlineCorrectionAndClaimCreationCannotRacePastAnAdminWrite() throws Exception {
        for (String kind : List.of("lecturers", "alumni")) {
            var member = e.applicant(kind.equals("lecturers") ? "lecturer" : "graduate");
            e.admit(member);
            var target = create(kind);
            int id = target.path("id").asInt();
            try (var executor = Executors.newSingleThreadExecutor()) {
                var pending = new ArrayList<Future<Void>>();
                tx.executeWithoutResult(
                        status -> {
                            var update = edit(kind, target);
                            update.put("lastName", "Before correction");
                            registries.update(kind, id, update, f.request("PUT"));
                            pending.add(
                                    executor.submit(
                                            () -> {
                                                tx.executeWithoutResult(
                                                        worker ->
                                                                db.execute(
                                                                        (ConnectionCallback<Void>)
                                                                                c -> {
                                                                                    AdmissionCommand
                                                                                            .correct(
                                                                                                    c,
                                                                                                    member
                                                                                                            .id(),
                                                                                                    kind
                                                                                                                    .equals(
                                                                                                                            "lecturers")
                                                                                                            ? "lecturer"
                                                                                                            : "graduate",
                                                                                                    id,
                                                                                                    "registry-it");
                                                                                    return null;
                                                                                }));
                                                return null;
                                            }));
                            awaitBlocked();
                        });
                pending.getFirst().get(10, TimeUnit.SECONDS);
            }
            var current = detail(kind, "" + id);
            assertThat(current.path("linked").asBoolean()).isTrue();
            failure(
                    browser.call(
                            "DELETE",
                            ROOT + kind + "/" + id,
                            Map.of("version", current.path("version").asText())),
                    409,
                    "RECORD_LINKED");
            assertThat(
                            db.queryForObject(
                                    "SELECT COUNT(*) FROM auth.RegistryClaimAudit WHERE UserId=? AND Action IN ('CORRECT_OLD','CORRECT_NEW')",
                                    Integer.class,
                                    member.id()))
                    .isEqualTo(2);
        }
    }
}
