package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import am.polylink.auth.Secrets;
import am.polylink.search.SearchService;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "polylink.identity.enabled=true",
            "polylink.messenger.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class SearchIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired SearchService search;
    @Autowired Secrets secrets;

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> items(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get("items");
    }

    SearchService.Filters filters(String q, Integer s, Integer i, Integer y, int limit) {
        return new SearchService.Filters(q, s, i, y, limit);
    }

    int insert(String name, String role) {
        int id =
                db.queryForObject(
                        "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId,IsProfilePublic,Specialization,About) OUTPUT inserted.UserId SELECT ?,N'Same',?,RoleId,(SELECT TOP 1 Id FROM dbo.Languages),0,N'Position',N'private description' FROM dbo.Roles WHERE Name=?",
                        Integer.class,
                        name,
                        UUID.randomUUID() + "@example.test",
                        role);
        db.update(
                "INSERT auth.AccountSecurity(UserId,AdmissionStatus,EmailVerifiedAt,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled) VALUES (?,'ADMITTED',SYSDATETIMEOFFSET(),1,1,0x00,2,67108864,'test',0)",
                id);
        return id;
    }

    @Test
    void educationSemanticsPaginationPrivacyAndLegacy() throws Exception {
        String name = "Search" + UUID.randomUUID().toString().replace("-", "");
        int s1 =
                db.queryForObject(
                        "INSERT dbo.Specializations(Name) OUTPUT inserted.SpecializationId VALUES (?)",
                        Integer.class,
                        name + "X");
        int s2 =
                db.queryForObject(
                        "INSERT dbo.Specializations(Name) OUTPUT inserted.SpecializationId VALUES (?)",
                        Integer.class,
                        name + "Y");
        int i1 =
                db.queryForObject(
                        "INSERT dbo.Institutes(Name) OUTPUT inserted.InstituteId VALUES (?)",
                        Integer.class,
                        name + "I");
        int i2 =
                db.queryForObject(
                        "INSERT dbo.Institutes(Name) OUTPUT inserted.InstituteId VALUES (?)",
                        Integer.class,
                        name + "J");
        int university =
                db.queryForObject(
                        "INSERT dbo.Universities(Name) OUTPUT inserted.UniversityId VALUES (?)",
                        Integer.class,
                        name);
        int degree =
                db.queryForObject(
                        "INSERT dbo.Degrees(Name) OUTPUT inserted.DegreeId VALUES (?)",
                        Integer.class,
                        name);
        var ids = new ArrayList<Integer>();
        for (int n = 0; n < 211; n++) ids.add(insert(name, n % 2 == 0 ? "graduate" : "lecturer"));
        int target = ids.getLast();
        for (var values :
                List.of(
                        new Object[] {s1, i1, "2020-06-01"},
                        new Object[] {s2, i2, "2024-06-01"},
                        new Object[] {s1, i1, "2020-07-01"},
                        new Object[] {null, null, null}))
            db.update(
                    "INSERT dbo.Education(UserId,UniversityId,DegreeId,SpecializationId,InstituteId,EndDate) VALUES (?,?,?,?,?,?)",
                    target,
                    university,
                    degree,
                    values[0],
                    values[1],
                    values[2]);
        assertThat(items(search.page(0, filters(name, s1, i2, null, 50), null))).isEmpty();
        assertThat(items(search.page(0, filters(name, s1, null, 2024, 50), null))).isEmpty();
        var sqls = new ArrayList<String>();
        var bindings = new ArrayList<Object[]>();
        var counted =
                new JdbcTemplate(db.getDataSource()) {
                    @Override
                    public <T> List<T> query(String sql, RowMapper<T> mapper, Object... args) {
                        sqls.add(sql);
                        bindings.add(args);
                        return super.query(sql, mapper, args);
                    }
                };
        long started = System.nanoTime();
        var matches =
                items(
                        new SearchService(counted, secrets)
                                .page(0, filters(name, s1, i1, 2020, 50), null));
        System.out.println(
                "Search fixture: 211 users, matching page in "
                        + (System.nanoTime() - started) / 1_000_000.0
                        + " ms; SQL reads="
                        + sqls.size());
        assertThat(sqls).hasSize(2);
        // SHOWPLAN is a separate SQL batch. Use escaped synthetic literals to avoid
        // JDBC's prepared-statement RPC, whose own batch is not the SELECT plan.
        String explain = sqls.getFirst();
        for (Object arg : bindings.getFirst()) {
            String literal =
                    arg instanceof Number
                            ? arg.toString()
                            : "N'" + arg.toString().replace("'", "''") + "'";
            int placeholder = explain.indexOf('?');
            explain =
                    explain.substring(0, placeholder)
                            + literal
                            + explain.substring(placeholder + 1);
        }
        String explainQuery = explain;
        String plan =
                db.execute(
                        (ConnectionCallback<String>)
                                connection -> {
                                    try (var statement = connection.createStatement()) {
                                        statement.execute("SET SHOWPLAN_XML ON");
                                        try (var result = statement.executeQuery(explainQuery)) {
                                            result.next();
                                            return result.getString(1);
                                        } finally {
                                            statement.execute("SET SHOWPLAN_XML OFF");
                                        }
                                    }
                                });
        assertThat(plan).contains("ShowPlanXML");
        Files.writeString(Path.of("target/search-query-plan.xml"), plan);
        assertThat(matches).hasSize(1);
        assertThat((List<?>) matches.getFirst().get("matchedEducation")).hasSize(2);
        assertThat(matches.getFirst().get("id")).isEqualTo("" + target);
        assertThat(matches.getFirst().keySet())
                .containsExactlyInAnyOrder(
                        "id",
                        "firstName",
                        "lastName",
                        "role",
                        "onboardingComplete",
                        "jobTitle",
                        "canOpenProfile",
                        "matchedEducation");
        assertThat(matches.getFirst().get("canOpenProfile")).isEqualTo(false);
        assertThat(
                        items(search.page(target, filters(name, null, null, null, 100), null))
                                .getFirst()
                                .get("canOpenProfile"))
                .isEqualTo(false);
        var found = new ArrayList<String>();
        String cursor = null;
        String firstCursor = null;
        do {
            var page = search.page(0, filters(name, null, null, null, 100), cursor);
            assertThat(items(page).size()).isLessThanOrEqualTo(100);
            for (var item : items(page)) {
                found.add(item.get("id").toString());
                if (item.get("id").equals("" + target))
                    assertThat((List<?>) item.get("matchedEducation")).hasSize(4);
            }
            cursor = (String) page.get("nextCursor");
            if (firstCursor == null) firstCursor = cursor;
        } while (cursor != null);
        assertThat(found).doesNotHaveDuplicates().hasSize(211);
        db.update(
                "INSERT dbo.Education(UserId,UniversityId,DegreeId,EndDate) VALUES (?,?,?,'9999-12-31')",
                target,
                university,
                degree);
        assertThat(items(search.page(0, filters(name, null, null, 9999, 50), null))).hasSize(1);
        String literal = "Անի " + UUID.randomUUID() + " %_![";
        int literalId = insert(literal, "lecturer");
        var literalPage =
                items(
                        search.page(
                                literalId,
                                filters("  " + literal + "  ", null, null, null, 50),
                                null));
        assertThat(literalPage).hasSize(1);
        assertThat(literalPage.getFirst().get("canOpenProfile")).isEqualTo(true);
        assertThat(
                        items(search.page(0, filters(name, null, null, null, 100), null))
                                .getFirst()
                                .get("matchedEducation"))
                .isEqualTo(List.of());
        String token = firstCursor;
        assertThatThrownBy(() -> search.page(0, filters(name + "x", null, null, null, 100), token))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> search.page(1, filters(name, null, null, null, 100), token))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> search.page(0, filters(name, null, null, null, 100), token + "x"))
                .isInstanceOf(AuthFailure.class);
        db.update(
                "UPDATE auth.AccountSecurity SET AdmissionStatus='DEACTIVATED' WHERE UserId=?",
                target);
        assertThat(items(search.page(0, filters(name, s1, i1, 2020, 50), null))).isEmpty();
        db.update(
                "UPDATE auth.AccountSecurity SET AdmissionStatus='ADMITTED' WHERE UserId=?",
                target);
        var f = new IdentityIT();
        f.port = port;
        f.db = db;
        f.mapper = mapper;
        var logged = f.enroll("graduate");
        var browser = logged.browser();
        assertThat(browser.get("/users/" + target).statusCode()).isEqualTo(404);
        var legacy = browser.json(browser.get("/search?q=" + name));
        assertThat(legacy.isArray()).isTrue();
        assertThat(legacy.size()).isEqualTo(100);
        assertThat(browser.get("/search/people?limit=101").statusCode()).isEqualTo(400);
        assertThat(browser.get("/search/people?instituteId=bad").statusCode()).isEqualTo(400);
        assertThat(browser.get("/search/filters").statusCode()).isEqualTo(200);
        assertThat(f.new Browser().get("/search/people").statusCode()).isEqualTo(401);
    }
}
