package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.admin.*;
import am.polylink.auth.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.*;
import org.springframework.mock.web.*;
import org.springframework.test.context.*;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true", "polylink.admin.enabled=true",
            "polylink.posts.enabled=true", "polylink.forum.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class AdminReferencesIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired TransactionTemplate tx;
    @Autowired AdminSessions sessions;
    @Autowired AdminReferences references;
    final IdentityIT f = new IdentityIT();
    IdentityIT.Browser browser;
    int admin;
    static final String ROOT = "/admin/references/";

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void setup() {
        f.port = port;
        f.db = db;
        f.mapper = mapper;
        browser = administrator();
        admin =
                db.queryForObject(
                        "SELECT AdminId FROM admin.Sessions WHERE TokenHash=?",
                        Integer.class,
                        Secrets.hash(browser.cookies.get(AdminSessions.SESSION)));
    }

    IdentityIT.Browser administrator() {
        var result = f.new Browser();
        int id =
                db.queryForObject(
                        "INSERT admin.Admins(Email,FirstName,LastName,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailVerifiedAt) OUTPUT inserted.AdminId VALUES (?,N'Reference',N'Fixture',0x00000000000000000000000000000000,2,67108864,'fixture',SYSDATETIMEOFFSET())",
                        Integer.class,
                        UUID.randomUUID() + "@example.invalid");
        var response = new MockHttpServletResponse();
        tx.executeWithoutResult(status -> sessions.issue(sessions.account(id, true), response));
        for (String header : response.getHeaders("Set-Cookie")) {
            String[] pair = header.split(";", 2)[0].split("=", 2);
            result.cookies.put(pair[0], pair[1]);
        }
        return result;
    }

    JsonNode create(String kind, String name) throws Exception {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("name", name);
        if (Set.of("post-spheres", "forum-categories").contains(kind))
            payload.put("code", "ref-" + UUID.randomUUID().toString().substring(0, 20));
        var response = browser.post(ROOT + kind, payload);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
        return browser.json(response);
    }

    JsonNode detail(String kind, String id) throws Exception {
        var response = browser.get(ROOT + kind + "/" + id);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return browser.json(response);
    }

    void failure(java.net.http.HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
        assertThat(browser.json(response).path("code").asText()).isEqualTo(code);
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
    }

    @Test
    void allSupportedResourcesRoundTripWithImmutableCodesAndServerVersions() throws Exception {
        for (String kind :
                List.of(
                        "universities",
                        "institutes",
                        "departments",
                        "specializations",
                        "professions",
                        "degrees",
                        "post-spheres",
                        "forum-categories")) {
            String name = "Reference " + UUID.randomUUID();
            var created = create(kind, "  " + name + "  ");
            String id = created.path("id").asText(), path = ROOT + kind + "/" + id;
            assertThat(created.path("name").asText()).isEqualTo(name);
            assertThat(created.path("version").asText()).hasSize(11);
            assertThat(created.path("protectionReasons")).isEmpty();
            assertThat(detail(kind, id)).isEqualTo(created);
            var updated =
                    browser.call(
                            "PUT",
                            path,
                            Map.of(
                                    "name",
                                    name + " edited",
                                    "version",
                                    created.path("version").asText()));
            assertThat(updated.statusCode()).as(updated.body()).isEqualTo(200);
            var current = browser.json(updated);
            assertThat(current.path("version").asText())
                    .isNotEqualTo(created.path("version").asText());
            if (created.has("code"))
                assertThat(current.path("code")).isEqualTo(created.path("code"));
            failure(
                    browser.call(
                            "PUT",
                            path,
                            Map.of(
                                    "name",
                                    name + " stale",
                                    "version",
                                    created.path("version").asText())),
                    409,
                    "VERSION_CONFLICT");
            failure(
                    browser.call(
                            "DELETE", path, Map.of("version", created.path("version").asText())),
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
    }

    @Test
    void protectsSystemValuesAndKeepsPostTypeMutationsUnreleased() throws Exception {
        for (var row : db.queryForList("SELECT Resource,ReferenceId FROM admin.SystemReferences")) {
            String kind = row.get("Resource").toString(), id = row.get("ReferenceId").toString();
            var value = detail(kind, id);
            assertThat(value.path("protectionReasons").toString()).contains("SYSTEM_VALUE");
            var payload =
                    Map.of(
                            "name",
                            "Forbidden " + UUID.randomUUID(),
                            "version",
                            value.path("version").asText());
            failure(browser.call("PUT", ROOT + kind + "/" + id, payload), 409, "SYSTEM_VALUE");
            failure(
                    browser.call(
                            "DELETE",
                            ROOT + kind + "/" + id,
                            Map.of("version", value.path("version").asText())),
                    409,
                    "SYSTEM_VALUE");
        }
        failure(
                browser.post(ROOT + "post-types", Map.of("name", "Custom", "code", "custom")),
                409,
                "POST_TYPE_COMPATIBILITY");
        int custom =
                db.queryForObject(
                        "INSERT dbo.PostTypes(Name,Code) OUTPUT inserted.PostTypeId VALUES (?,?)",
                        Integer.class,
                        "Offline " + UUID.randomUUID(),
                        "x" + UUID.randomUUID().toString().substring(0, 8));
        try {
            var value = detail("post-types", "" + custom);
            failure(
                    browser.call(
                            "DELETE",
                            ROOT + "post-types/" + custom,
                            Map.of("version", value.path("version").asText())),
                    409,
                    "POST_TYPE_COMPATIBILITY");
            failure(
                    browser.call(
                            "PUT",
                            ROOT + "post-types/" + custom,
                            Map.of(
                                    "version",
                                    value.path("version").asText(),
                                    "name",
                                    "Cannot rename")),
                    409,
                    "POST_TYPE_COMPATIBILITY");
        } finally {
            db.update("DELETE dbo.PostTypes WHERE PostTypeId=?", custom);
        }
    }

    @Test
    void rejectsUnknownResourcesForgedFlagsInvalidFieldsAndDuplicateNamesAndCodes()
            throws Exception {
        for (String kind : List.of("roles", "languages", "Universities", "unknown"))
            failure(browser.get(ROOT + kind), 404, "NOT_FOUND");
        failure(
                browser.post(ROOT + "universities", Map.of("name", "Test", "IsVerified", true)),
                400,
                "VALIDATION");
        failure(
                browser.post(ROOT + "specializations", Map.of("name", "Test", "system", false)),
                400,
                "VALIDATION");
        for (Object name : List.of("", " ", "x".repeat(101), "line\nbreak", 123))
            failure(browser.post(ROOT + "degrees", Map.of("name", name)), 400, "VALIDATION");
        for (String code : List.of("UPPER", "two--parts", "-start", "end-", "x".repeat(33)))
            failure(
                    browser.post(ROOT + "post-spheres", Map.of("name", "Test", "code", code)),
                    400,
                    "VALIDATION");
        String name = "Duplicate " + UUID.randomUUID();
        var created = create("universities", name);
        assertThat(
                        db.queryForObject(
                                "SELECT IsVerified FROM dbo.Universities WHERE UniversityId=?",
                                Boolean.class,
                                created.path("id").asText()))
                .isFalse();
        failure(
                browser.post(ROOT + "universities", Map.of("name", name.toLowerCase(Locale.ROOT))),
                409,
                "DUPLICATE_NAME");
        var sphere = create("post-spheres", "Sphere " + UUID.randomUUID());
        failure(
                browser.post(
                        ROOT + "post-spheres",
                        Map.of(
                                "name",
                                "Different " + UUID.randomUUID(),
                                "code",
                                sphere.path("code").asText())),
                409,
                "DUPLICATE_CODE");
        var category = create("forum-categories", "Category " + UUID.randomUUID());
        failure(
                browser.post(
                        ROOT + "forum-categories",
                        Map.of(
                                "name",
                                category.path("name").asText(),
                                "code",
                                "new-" + UUID.randomUUID().toString().substring(0, 20))),
                409,
                "DUPLICATE_NAME");
        String path = ROOT + "universities/" + created.path("id").asText();
        failure(
                browser.call(
                        "PUT",
                        path,
                        Map.of(
                                "name",
                                "Test",
                                "version",
                                created.path("version").asText(),
                                "code",
                                "forged")),
                400,
                "VALIDATION");
        failure(
                browser.call("PUT", path, Map.of("name", "Test", "version", "bad")),
                400,
                "VALIDATION");
        failure(browser.call("DELETE", path, Map.of()), 400, "VALIDATION");
        failure(browser.get(ROOT + "universities/-1"), 404, "NOT_FOUND");
    }

    @Test
    void searchIsLiteralBoundedAndCursorsAreBoundToResourceAndQuery() throws Exception {
        String prefix = "Paging " + UUID.randomUUID();
        for (int i = 0; i < 53; i++)
            db.update("INSERT dbo.Degrees(Name) VALUES (?)", prefix + " " + i);
        String query = URLEncoder.encode(prefix, StandardCharsets.UTF_8);
        var first = browser.json(browser.get(ROOT + "degrees?q=" + query));
        assertThat(first.path("items")).hasSize(50);
        String cursor = first.path("nextCursor").asText();
        var second = browser.json(browser.get(ROOT + "degrees?q=" + query + "&cursor=" + cursor));
        assertThat(second.path("items")).hasSize(3);
        assertThat(second.path("nextCursor").isNull()).isTrue();
        Set<String> ids = new HashSet<>();
        first.path("items").forEach(item -> assertThat(ids.add(item.path("id").asText())).isTrue());
        second.path("items")
                .forEach(item -> assertThat(ids.add(item.path("id").asText())).isTrue());
        failure(browser.get(ROOT + "degrees?cursor=" + cursor), 400, "VALIDATION");
        failure(
                browser.get(ROOT + "universities?q=" + query + "&cursor=" + cursor),
                400,
                "VALIDATION");
        failure(
                browser.get(ROOT + "degrees?q=" + query + "&cursor=" + cursor + "x"),
                400,
                "VALIDATION");
        failure(browser.get(ROOT + "degrees?q=" + "x".repeat(256)), 400, "VALIDATION");
        String literal = "Wild ~%_[ " + UUID.randomUUID();
        var value = create("degrees", literal);
        var results =
                browser.json(
                        browser.get(
                                ROOT
                                        + "degrees?q="
                                        + URLEncoder.encode("~%_[", StandardCharsets.UTF_8)));
        assertThat(results.path("items")).hasSize(1);
        assertThat(results.path("items").get(0).path("id")).isEqualTo(value.path("id"));
        assertThat(browser.json(browser.get(ROOT + "degrees?q=" + UUID.randomUUID())).path("items"))
                .isEmpty();
    }

    @Test
    void enforcesAdminCredentialsCsrfExpiryAndImmediateDisablingOnEveryOperation()
            throws Exception {
        var value = create("degrees", "Access " + UUID.randomUUID());
        String path = ROOT + "degrees/" + value.path("id").asText();
        var stranger = f.new Browser();
        assertThat(stranger.get(ROOT + "degrees").statusCode()).isEqualTo(401);
        assertThat(stranger.post(ROOT + "degrees", Map.of("name", "Denied")).statusCode())
                .isEqualTo(401);
        var member = f.enroll("graduate");
        assertThat(member.browser().get(ROOT + "degrees").statusCode()).isEqualTo(401);
        assertThat(member.browser().post(ROOT + "degrees", Map.of("name", "Denied")).statusCode())
                .isEqualTo(401);
        browser.csrf = false;
        failure(
                browser.call(
                        "PUT",
                        path,
                        Map.of("name", "Denied", "version", value.path("version").asText())),
                403,
                "FORBIDDEN");
        browser.csrf = true;
        db.update(
                "UPDATE admin.Sessions SET IdleExpiresAt=? WHERE AdminId=?",
                OffsetDateTime.now().minusMinutes(1),
                admin);
        assertThat(browser.get(ROOT + "degrees").statusCode()).isEqualTo(401);
        db.update(
                "UPDATE admin.Sessions SET IdleExpiresAt=? WHERE AdminId=?",
                OffsetDateTime.now().plusMinutes(10),
                admin);
        db.update("UPDATE admin.Admins SET Enabled=0 WHERE AdminId=?", admin);
        for (String read : List.of(ROOT + "degrees", path))
            assertThat(browser.get(read).statusCode()).isEqualTo(401);
        assertThat(
                        browser.call(
                                        "DELETE",
                                        path,
                                        Map.of("version", value.path("version").asText()))
                                .statusCode())
                .isEqualTo(401);
        assertThat(
                        browser.call(
                                        "PUT",
                                        path,
                                        Map.of(
                                                "name",
                                                "Denied",
                                                "version",
                                                value.path("version").asText()))
                                .statusCode())
                .isEqualTo(401);
        assertThat(browser.post(ROOT + "degrees", Map.of("name", "Denied")).statusCode())
                .isEqualTo(401);
    }

    record Fixture(String kind, int id, String consumerSql) {}

    List<Fixture> dependencyFixtures() throws Exception {
        int member = f.enroll("lecturer").id();
        var fixtures = new ArrayList<Fixture>();
        for (String kind :
                List.of(
                        "universities",
                        "institutes",
                        "departments",
                        "specializations",
                        "professions",
                        "degrees",
                        "post-spheres",
                        "forum-categories")) {
            List<String> paths =
                    switch (kind) {
                        case "universities" -> List.of("education:UniversityId");
                        case "institutes" ->
                                List.of("education:InstituteId", "pending:InstituteId");
                        case "departments" ->
                                List.of(
                                        "lecturer:DepartmentId",
                                        "lecturerRegistry:DepartmentId",
                                        "pending:DepartmentId");
                        case "specializations" ->
                                List.of(
                                        "education:SpecializationId",
                                        "alumniRegistry:SpecializationId",
                                        "pending:SpecializationId");
                        case "professions" ->
                                List.of("lecturer:ProfessionId", "pending:ProfessionId");
                        case "degrees" -> List.of("education:DegreeId");
                        case "post-spheres" -> List.of("post:SphereId");
                        default -> List.of("topic:CategoryId");
                    };
            for (String path : paths) {
                var value = create(kind, "Dependency " + UUID.randomUUID());
                int id = Integer.parseInt(value.path("id").asText());
                String column = path.split(":")[1];
                String sql =
                        switch (path.split(":")[0]) {
                            case "education" ->
                                    "INSERT dbo.Education(UserId,UniversityId"
                                            + (column.equals("UniversityId") ? "" : "," + column)
                                            + ") VALUES ("
                                            + member
                                            + ","
                                            + (column.equals("UniversityId")
                                                    ? id
                                                    : "(SELECT ReferenceId FROM admin.SystemReferences WHERE SystemCode='polytechnic'),"
                                                            + id)
                                            + ")";
                            case "pending" ->
                                    "INSERT auth.PendingEnrollments(UserId,CredentialVersion,FirstName,LastName,RoleCode,"
                                            + column
                                            + ") SELECT "
                                            + member
                                            + ",1,N'Pending',N'Fixture','lecturer',"
                                            + id;
                            case "lecturerRegistry" ->
                                    "INSERT dbo.LecturerRegistry(Email,DepartmentId) VALUES (N'"
                                            + UUID.randomUUID()
                                            + "@example.invalid',"
                                            + id
                                            + ")";
                            case "alumniRegistry" ->
                                    "INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId) VALUES (N'Fixture',N'Consumer',N'"
                                            + UUID.randomUUID()
                                            + "','2020-09-01','2024-06-01',"
                                            + id
                                            + ")";
                            case "lecturer" ->
                                    "INSERT dbo.Lecturers(UserId,DepartmentId,ProfessionId) SELECT "
                                            + member
                                            + ","
                                            + (column.equals("DepartmentId")
                                                    ? id
                                                    : "(SELECT TOP(1) DepartmentId FROM dbo.Departments)")
                                            + ","
                                            + (column.equals("ProfessionId")
                                                    ? id
                                                    : "(SELECT TOP(1) ProfessionId FROM dbo.Professions)");
                            case "post" ->
                                    "INSERT dbo.Posts(UserId,Content,CreatedAtUtc,SphereId) VALUES ("
                                            + member
                                            + ",N'Consumer',SYSDATETIMEOFFSET(),"
                                            + id
                                            + ")";
                            default ->
                                    "INSERT dbo.ForumTopics(UserId,Title,Content,CategoryId) VALUES ("
                                            + member
                                            + ",N'Consumer',N'Body',"
                                            + id
                                            + ")";
                        };
                fixtures.add(new Fixture(kind, id, sql));
            }
        }
        return fixtures;
    }

    @Test
    void everyDependencyIncludingPendingAndRetainedRecordsProtectsRenameAndDelete()
            throws Exception {
        var fixtures = dependencyFixtures();
        for (var fixture : fixtures) {
            tx.executeWithoutResult(
                    status -> {
                        db.execute(fixture.consumerSql());
                        try {
                            var value =
                                    references.detail(fixture.kind(), fixture.id(), request("GET"));
                            assertThat(value.get("protectionReasons").toString())
                                    .as(fixture.consumerSql())
                                    .contains("REFERENCE_IN_USE");
                            assertThatThrownBy(
                                            () ->
                                                    references.update(
                                                            fixture.kind(),
                                                            fixture.id(),
                                                            Map.of(
                                                                    "name",
                                                                    "Blocked",
                                                                    "version",
                                                                    value.get("version")),
                                                            request("PUT")))
                                    .hasMessage(
                                            "This value is in use and cannot be changed or deleted.");
                            assertThatThrownBy(
                                            () ->
                                                    references.delete(
                                                            fixture.kind(),
                                                            fixture.id(),
                                                            Map.of("version", value.get("version")),
                                                            request("DELETE")))
                                    .hasMessage(
                                            "This value is in use and cannot be changed or deleted.");
                        } catch (Exception e) {
                            throw new RuntimeException(e);
                        }
                        status.setRollbackOnly();
                    });
        }
    }

    MockHttpServletRequest request(String method) {
        return request(method, browser);
    }

    MockHttpServletRequest request(String method, IdentityIT.Browser identity) {
        var request = new MockHttpServletRequest(method, ROOT + "degrees");
        request.setCookies(
                new jakarta.servlet.http.Cookie(
                        AdminSessions.SESSION, identity.cookies.get(AdminSessions.SESSION)));
        request.addHeader("X-CSRF-Token", identity.cookies.get(AdminSessions.CSRF));
        return request;
    }

    @Test
    void referenceWritesHoldDependencyLocksAgainstEveryConcurrentConsumer() throws Exception {
        for (var fixture : dependencyFixtures()) {
            var value = detail(fixture.kind(), "" + fixture.id());
            tx.executeWithoutResult(
                    status -> {
                        references.update(
                                fixture.kind(),
                                fixture.id(),
                                Map.of(
                                        "name",
                                        "Renamed " + UUID.randomUUID(),
                                        "version",
                                        value.path("version").asText()),
                                request("PUT"));
                        try (var executor = Executors.newSingleThreadExecutor()) {
                            var blocked =
                                    executor.submit(
                                            () ->
                                                    db.execute(
                                                            (ConnectionCallback<Integer>)
                                                                    connection -> {
                                                                        try (var statement =
                                                                                connection
                                                                                        .createStatement()) {
                                                                            statement.execute(
                                                                                    "SET LOCK_TIMEOUT 250");
                                                                            try {
                                                                                statement.execute(
                                                                                        fixture
                                                                                                .consumerSql());
                                                                                return 0;
                                                                            } catch (
                                                                                    java.sql
                                                                                                    .SQLException
                                                                                            locked) {
                                                                                return locked
                                                                                        .getErrorCode();
                                                                            } finally {
                                                                                statement.execute(
                                                                                        "SET LOCK_TIMEOUT -1");
                                                                            }
                                                                        }
                                                                    }));
                            assertThat(blocked.get(5, TimeUnit.SECONDS))
                                    .as(fixture.consumerSql())
                                    .isEqualTo(1222);
                        } catch (Exception e) {
                            throw new RuntimeException(e);
                        }
                        status.setRollbackOnly();
                    });
        }
    }

    @Test
    void memberOptionsReflectCreatedRenamedAndRemovedUnusedReferences() throws Exception {
        var member = f.enroll("graduate").browser();
        for (String kind :
                List.of(
                        "universities",
                        "institutes",
                        "specializations",
                        "degrees",
                        "post-spheres",
                        "forum-categories")) {
            var value = create(kind, "Options " + UUID.randomUUID());
            String endpoint =
                    switch (kind) {
                        case "post-spheres" -> "/posts/options";
                        case "forum-categories" -> "/forum/categories";
                        default -> "/users/me/education/options";
                    };
            var initial = member.get(endpoint);
            assertThat(initial.statusCode()).as(initial.body()).isEqualTo(200);
            assertThat(initial.body()).contains(value.path("name").asText());
            String renamed = "Renamed " + UUID.randomUUID();
            var response =
                    browser.call(
                            "PUT",
                            ROOT + kind + "/" + value.path("id").asText(),
                            Map.of("name", renamed, "version", value.path("version").asText()));
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
            assertThat(member.get(endpoint).body())
                    .contains(renamed)
                    .doesNotContain(value.path("name").asText());
            assertThat(
                            browser.call(
                                            "DELETE",
                                            ROOT + kind + "/" + value.path("id").asText(),
                                            Map.of(
                                                    "version",
                                                    browser.json(response)
                                                            .path("version")
                                                            .asText()))
                                    .statusCode())
                    .isEqualTo(204);
            assertThat(member.get(endpoint).body()).doesNotContain(renamed);
        }
    }

    @Test
    void concurrentCategoryCreationCannotDuplicateNamesWithoutALegacyNameIndex() throws Exception {
        String name = "Concurrent category " + UUID.randomUUID();
        var other = administrator();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var barrier = new CyclicBarrier(2);
            var tasks = new ArrayList<Future<String>>();
            for (var identity : List.of(browser, other))
                tasks.add(
                        executor.submit(
                                () -> {
                                    barrier.await(5, TimeUnit.SECONDS);
                                    try {
                                        references.create(
                                                "forum-categories",
                                                Map.of(
                                                        "name",
                                                        name,
                                                        "code",
                                                        "race-"
                                                                + UUID.randomUUID()
                                                                        .toString()
                                                                        .substring(0, 20)),
                                                request("POST", identity));
                                        return "created";
                                    } catch (RuntimeException duplicate) {
                                        return duplicate.getMessage();
                                    }
                                }));
            assertThat(
                            List.of(
                                    tasks.get(0).get(10, TimeUnit.SECONDS),
                                    tasks.get(1).get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(
                            "created", "A reference value with this name already exists.");
        }
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM dbo.ForumCategories WHERE Name=?",
                                Integer.class,
                                name))
                .isEqualTo(1);
    }

    @Test
    void foreignKeyInventoryMatchesTheDocumentedProtectionBoundary() {
        var paths =
                db.queryForList(
                        """
            SELECT OBJECT_SCHEMA_NAME(f.parent_object_id)+'.'+OBJECT_NAME(f.parent_object_id)+'.'+COL_NAME(c.parent_object_id,c.parent_column_id)+'->'+OBJECT_NAME(f.referenced_object_id) AS Path
            FROM sys.foreign_keys f JOIN sys.foreign_key_columns c ON c.constraint_object_id=f.object_id
            WHERE OBJECT_SCHEMA_NAME(f.referenced_object_id)='dbo'
              AND OBJECT_NAME(f.referenced_object_id) IN ('Universities','Institutes','Departments','Specializations','Professions','Degrees','PostTypes','Spheres','ForumCategories')
            """,
                        String.class);
        assertThat(paths)
                .containsExactlyInAnyOrder(
                        "dbo.Education.UniversityId->Universities",
                        "dbo.Education.InstituteId->Institutes",
                        "auth.PendingEnrollments.InstituteId->Institutes",
                        "dbo.Lecturers.DepartmentId->Departments",
                        "dbo.LecturerRegistry.DepartmentId->Departments",
                        "auth.PendingEnrollments.DepartmentId->Departments",
                        "dbo.Education.SpecializationId->Specializations",
                        "dbo.AlumniRegistry.SpecializationId->Specializations",
                        "auth.PendingEnrollments.SpecializationId->Specializations",
                        "dbo.Lecturers.ProfessionId->Professions",
                        "auth.PendingEnrollments.ProfessionId->Professions",
                        "dbo.Education.DegreeId->Degrees",
                        "dbo.Posts.PostTypeId->PostTypes",
                        "dbo.Posts.SphereId->Spheres",
                        "dbo.ForumTopics.CategoryId->ForumCategories");
    }

    @Test
    void committedUseReturnsHttpConflictAndPreventsPartialChanges() throws Exception {
        var value = create("departments", "Used " + UUID.randomUUID());
        String id = value.path("id").asText(), path = ROOT + "departments/" + id;
        int record =
                db.queryForObject(
                        "INSERT dbo.LecturerRegistry(Email,DepartmentId) OUTPUT inserted.LecturerRegistryId VALUES (?,?)",
                        Integer.class,
                        UUID.randomUUID() + "@example.invalid",
                        id);
        try {
            failure(
                    browser.call(
                            "PUT",
                            path,
                            Map.of("name", "Not saved", "version", value.path("version").asText())),
                    409,
                    "REFERENCE_IN_USE");
            failure(
                    browser.call("DELETE", path, Map.of("version", value.path("version").asText())),
                    409,
                    "REFERENCE_IN_USE");
            assertThat(detail("departments", id).path("name")).isEqualTo(value.path("name"));
            assertThat(detail("departments", id).path("version")).isEqualTo(value.path("version"));
        } finally {
            db.update("DELETE dbo.LecturerRegistry WHERE LecturerRegistryId=?", record);
        }
    }

    @Test
    void consumerAndDisableTransactionsSerializeWithAdminWrites() throws Exception {
        var value = create("departments", "Race " + UUID.randomUUID());
        int id = value.path("id").asInt();
        String email = UUID.randomUUID() + "@example.invalid";
        try (var executor = Executors.newSingleThreadExecutor()) {
            tx.executeWithoutResult(
                    status -> {
                        db.update(
                                "INSERT dbo.LecturerRegistry(Email,DepartmentId) VALUES (?,?)",
                                email,
                                id);
                        var waiting =
                                executor.submit(
                                        () -> {
                                            try {
                                                tx.executeWithoutResult(
                                                        worker -> {
                                                            db.execute("SET LOCK_TIMEOUT 250");
                                                            try {
                                                                references.update(
                                                                        "departments",
                                                                        id,
                                                                        Map.of(
                                                                                "name",
                                                                                "Blocked",
                                                                                "version",
                                                                                value.path(
                                                                                                "version")
                                                                                        .asText()),
                                                                        request("PUT"));
                                                            } finally {
                                                                db.execute("SET LOCK_TIMEOUT -1");
                                                            }
                                                        });
                                                return "saved";
                                            } catch (RuntimeException locked) {
                                                return locked.getMessage();
                                            }
                                        });
                        try {
                            assertThat(waiting.get(5, TimeUnit.SECONDS))
                                    .isEqualTo(
                                            "Another operation is changing this value. Reload and retry.");
                        } catch (Exception e) {
                            throw new RuntimeException(e);
                        }
                        status.setRollbackOnly();
                    });
            tx.executeWithoutResult(
                    status -> {
                        references.update(
                                "departments",
                                id,
                                Map.of(
                                        "name",
                                        "Before disable " + UUID.randomUUID(),
                                        "version",
                                        value.path("version").asText()),
                                request("PUT"));
                        var disabling =
                                executor.submit(
                                        () ->
                                                db.execute(
                                                        (ConnectionCallback<Integer>)
                                                                connection -> {
                                                                    boolean previous =
                                                                            connection
                                                                                    .getAutoCommit();
                                                                    connection.setAutoCommit(false);
                                                                    try (var statement =
                                                                            connection
                                                                                    .createStatement()) {
                                                                        statement.execute(
                                                                                "SET LOCK_TIMEOUT 250");
                                                                        try {
                                                                            AdminCommand.disable(
                                                                                    connection,
                                                                                    admin,
                                                                                    java.time.Clock
                                                                                            .systemUTC());
                                                                            return 0;
                                                                        } catch (
                                                                                java.sql
                                                                                                .SQLException
                                                                                        locked) {
                                                                            return locked
                                                                                    .getErrorCode();
                                                                        } catch (
                                                                                org.springframework
                                                                                                .dao
                                                                                                .DataAccessException
                                                                                        locked) {
                                                                            if (locked
                                                                                            .getMostSpecificCause()
                                                                                    instanceof
                                                                                    java.sql
                                                                                                    .SQLException
                                                                                            sql)
                                                                                return sql
                                                                                        .getErrorCode();
                                                                            throw locked;
                                                                        } finally {
                                                                            connection.rollback();
                                                                            statement.execute(
                                                                                    "SET LOCK_TIMEOUT -1");
                                                                        }
                                                                    } finally {
                                                                        connection.setAutoCommit(
                                                                                previous);
                                                                    }
                                                                }));
                        try {
                            assertThat(disabling.get(5, TimeUnit.SECONDS)).isEqualTo(1222);
                        } catch (Exception e) {
                            throw new RuntimeException(e);
                        }
                        status.setRollbackOnly();
                    });
        }
        tx.executeWithoutResult(
                status ->
                        db.execute(
                                (ConnectionCallback<Void>)
                                        connection -> {
                                            AdminCommand.disable(
                                                    connection, admin, java.time.Clock.systemUTC());
                                            return null;
                                        }));
        assertThat(browser.post(ROOT + "degrees", Map.of("name", "After disable")).statusCode())
                .isEqualTo(401);
    }

    @Test
    void offlineEditsAndConcurrentAdminsCannotSilentlyOverwriteAnotherVersion() throws Exception {
        var value = create("degrees", "Offline " + UUID.randomUUID());
        String id = value.path("id").asText(), path = ROOT + "degrees/" + id;
        db.update(
                "UPDATE dbo.Degrees SET Name=? WHERE DegreeId=?",
                "Offline edit " + UUID.randomUUID(),
                id);
        failure(
                browser.call(
                        "PUT",
                        path,
                        Map.of("name", "Stale", "version", value.path("version").asText())),
                409,
                "VERSION_CONFLICT");
        String version = detail("degrees", id).path("version").asText();
        var other = administrator();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var barrier = new CyclicBarrier(2);
            var tasks = new ArrayList<Future<String>>();
            for (var identity : List.of(browser, other))
                tasks.add(
                        executor.submit(
                                () -> {
                                    barrier.await(5, TimeUnit.SECONDS);
                                    try {
                                        references.update(
                                                "degrees",
                                                Integer.parseInt(id),
                                                Map.of(
                                                        "name",
                                                        "Concurrent " + UUID.randomUUID(),
                                                        "version",
                                                        version),
                                                request("PUT", identity));
                                        return "saved";
                                    } catch (RuntimeException conflict) {
                                        return conflict.getMessage();
                                    }
                                }));
            assertThat(
                            List.of(
                                    tasks.get(0).get(10, TimeUnit.SECONDS),
                                    tasks.get(1).get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(
                            "saved",
                            "This value changed. Reload the current version before saving.");
        }
    }
}
