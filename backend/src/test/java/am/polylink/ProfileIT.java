package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import am.polylink.profile.*;
import java.util.*;
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
            "polylink.posts.enabled=true",
            "polylink.frontend-origins=http://localhost:8001"
        })
class ProfileIT {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired JsonMapper mapper;
    @Autowired ProfileService profiles;
    final IdentityIT fixture = new IdentityIT();

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        IdentityIT.configuration(r);
    }

    @BeforeEach
    void initialize() {
        fixture.port = port;
        fixture.db = db;
        fixture.mapper = mapper;
        db.update("DELETE auth.RateLimits");
    }

    JsonNode call(IdentityIT.Enrolled u, String method, String path, Object body, int code)
            throws Exception {
        var r =
                u.browser()
                        .call(
                                method,
                                path,
                                body == null && !method.equals("GET") ? Map.of() : body);
        assertThat(r.statusCode()).as(method + " " + path + ": " + r.body()).isEqualTo(code);
        return code == 204 ? mapper.createObjectNode() : mapper.readTree(r.body());
    }

    Map<String, Object> education() {
        var m = new LinkedHashMap<String, Object>();
        m.put(
                "universityId",
                db.queryForObject(
                        "SELECT TOP(1) UniversityId FROM dbo.Universities", Integer.class));
        m.put("startDate", "2020");
        m.put("endDate", "2020-01");
        m.put("isOngoing", false);
        return m;
    }

    @Test
    void profilesEnforceIdentityOwnershipPrivacyAndLastSaveWins() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        assertThat(fixture.new Browser().get("/users/me/education/options").statusCode())
                .isEqualTo(401);
        assertThat(
                        call(a, "GET", "/users/me/education/options", null, 200)
                                .path("universities")
                                .size())
                .isPositive();
        var input =
                Map.<String, Object>of(
                        "jobTitle", "Engineer", "description", "Hello <b>literal text</b>");
        call(a, "PUT", "/users/me", input, 200);
        var forged = new LinkedHashMap<>(input);
        forged.put("firstName", "Forged");
        call(a, "PUT", "/users/me", forged, 400);
        call(a, "PUT", "/users/me", Map.of("jobTitle", "Last save", "description", ""), 200);
        var visible = call(b, "GET", "/users/" + a.id(), null, 200);
        assertThat(visible.path("jobTitle").asText()).isEqualTo("Last save");
        assertThat(visible.has("email")).isFalse();
        var ed = call(a, "POST", "/users/me/education", education(), 201);
        String path = "/users/me/education/" + ed.path("id").asText();
        assertThat(ed.path("startDate").asText()).isEqualTo("2020");
        assertThat(ed.path("endDate").asText()).isEqualTo("2020-01");
        call(b, "PUT", path, education(), 404);
        call(b, "DELETE", path, null, 404);
        var invalid = education();
        invalid.put("universityId", 2147483647);
        call(a, "PUT", path, invalid, 400);
        invalid = education();
        invalid.put("endDate", "2019");
        call(a, "PUT", path, invalid, 400);
        invalid = education();
        invalid.put("isOngoing", true);
        call(a, "PUT", path, invalid, 400);
        var ongoing = education();
        ongoing.put("endDate", null);
        ongoing.put("isOngoing", true);
        assertThat(call(a, "PUT", path, ongoing, 200).path("isOngoing").asBoolean()).isTrue();
        var cert =
                new LinkedHashMap<String, Object>(
                        Map.of(
                                "name",
                                "Java",
                                "organization",
                                "Issuer",
                                "issueDate",
                                "2024-02",
                                "credentialUrl",
                                "https://example.invalid/proof"));
        var c = call(a, "POST", "/users/me/licenses", cert, 201);
        String cp = "/users/me/licenses/" + c.path("id").asText();
        call(b, "PUT", cp, cert, 404);
        call(b, "DELETE", cp, null, 404);
        cert.put("credentialUrl", "javascript:alert(1)");
        call(a, "PUT", cp, cert, 400);
        cert.put("credentialUrl", "");
        cert.put("organization", "");
        call(a, "PUT", cp, cert, 400);
        var owner = call(a, "GET", "/users/" + a.id(), null, 200);
        assertThat(owner.path("education").size()).isGreaterThanOrEqualTo(2);
        assertThat(owner.path("licenses").size()).isEqualTo(1);
        call(a, "PATCH", "/settings", Map.of("isProfilePublic", false), 200);
        call(b, "GET", "/users/" + a.id(), null, 404);
        call(a, "GET", "/users/" + a.id(), null, 200);
        call(a, "DELETE", path, null, 204);
        call(a, "PUT", path, education(), 404);
        call(a, "DELETE", cp, null, 204);
    }

    @Test
    void unrelatedEditsPreserveLegacyEducationDays() throws Exception {
        var a = fixture.enroll("graduate");
        var ed = profiles.education(a.id()).getFirst();
        String original = ed.get("startDate").toString();
        var data = education();
        data.put("startDate", original);
        data.put("endDate", ed.get("endDate"));
        var saved = profiles.saveEducation(a.id(), Integer.valueOf(ed.get("id").toString()), data);
        assertThat(saved.get("startDate")).isEqualTo(original);
        assertThat(saved.get("startPrecision")).isEqualTo("DAY");
    }
}
