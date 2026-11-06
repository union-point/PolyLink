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
        assertThat(owner.path("education").size()).isGreaterThanOrEqualTo(1);
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
        db.update(
                "INSERT dbo.Education(UserId,UniversityId,StartDate,EndDate,StartPrecision,EndPrecision) SELECT ?,UniversityId,'2019-09-23','2023-06-17','DAY','DAY' FROM dbo.Universities",
                a.id());
        var ed = profiles.education(a.id()).getFirst();
        String original = ed.get("startDate").toString();
        var data = education();
        data.put("startDate", original);
        data.put("endDate", ed.get("endDate"));
        var saved = profiles.saveEducation(a.id(), Integer.valueOf(ed.get("id").toString()), data);
        assertThat(saved.get("startDate")).isEqualTo(original);
        assertThat(saved.get("startPrecision")).isEqualTo("DAY");
    }

    java.net.http.HttpResponse<byte[]> multipart(
            IdentityIT.Enrolled user, String path, byte[] bytes, String type, boolean csrf)
            throws Exception {
        String field = path.endsWith("photo") ? "photo" : "banner", boundary = "profile-fixture";
        var out = new java.io.ByteArrayOutputStream();
        out.write(
                ("--"
                                + boundary
                                + "\r\nContent-Disposition: form-data; name=\""
                                + field
                                + "\"; filename=\"image.png\"\r\nContent-Type: "
                                + type
                                + "\r\n\r\n")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        out.write(bytes);
        out.write(("\r\n--" + boundary + "--\r\n").getBytes());
        var request =
                java.net.http.HttpRequest.newBuilder(
                                java.net.URI.create("http://localhost:" + port + path))
                        .header("Authorization", "Bearer " + user.browser().access)
                        .header("Content-Type", "multipart/form-data; boundary=" + boundary);
        if (csrf)
            request.header("Origin", IdentityIT.ORIGIN)
                    .header("X-CSRF-Token", user.browser().cookies.get(Sessions.CSRF));
        request.header(
                "Cookie",
                user.browser().cookies.entrySet().stream()
                        .map(e -> e.getKey() + "=" + e.getValue())
                        .collect(java.util.stream.Collectors.joining("; ")));
        return java.net.http.HttpClient.newHttpClient()
                .send(
                        request.POST(
                                        java.net.http.HttpRequest.BodyPublishers.ofByteArray(
                                                out.toByteArray()))
                                .build(),
                        java.net.http.HttpResponse.BodyHandlers.ofByteArray());
    }

    byte[] png() throws Exception {
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(
                new java.awt.image.BufferedImage(
                        320, 160, java.awt.image.BufferedImage.TYPE_INT_RGB),
                "png",
                out);
        return out.toByteArray();
    }

    int imageStatus(String url) throws Exception {
        return java.net.http.HttpClient.newHttpClient()
                .send(
                        java.net.http.HttpRequest.newBuilder(java.net.URI.create(url))
                                .GET()
                                .build(),
                        java.net.http.HttpResponse.BodyHandlers.discarding())
                .statusCode();
    }

    void exportGrant(IdentityIT.Enrolled user) throws Exception {
        user.browser().exportGrant =
                call(
                                user,
                                "POST",
                                "/account/export/authorize",
                                Map.of("loginSecret", user.secret(), "expectedCredential", "1"),
                                200)
                        .path("grant")
                        .asText();
    }

    @Autowired am.polylink.chat.AccountLifecycle lifecycle;
    @Autowired Accounts accounts;

    @Test
    void mediaReplacementPrivacyExportAndDeletionAreOwnerScoped() throws Exception {
        var a = fixture.enroll("graduate");
        var b = fixture.enroll("lecturer");
        String previous = null;
        for (String path : List.of("/users/me/photo", "/users/me/banner")) {
            var upload = multipart(a, path, png(), "image/png", true);
            assertThat(upload.statusCode()).as(new String(upload.body())).isEqualTo(200);
            var profile = mapper.readTree(upload.body());
            String key = path.endsWith("photo") ? "avatar" : "cover",
                    url = profile.path(key).asText();
            assertThat(imageStatus(url)).isEqualTo(200);
            call(a, "PATCH", "/settings", Map.of("isProfilePublic", false), 200);
            assertThat(imageStatus(url)).isEqualTo(200);
            call(b, "GET", "/users/" + a.id(), null, 404);
            assertThat(multipart(a, path, new byte[] {1, 2, 3}, "image/png", true).statusCode())
                    .isEqualTo(400);
            assertThat(imageStatus(url)).isEqualTo(200);
            assertThat(multipart(a, path, png(), "image/webp", true).statusCode()).isEqualTo(400);
            assertThat(multipart(a, path, png(), "image/png", false).statusCode()).isEqualTo(403);
            assertThat(
                            multipart(a, path, new byte[5 * 1024 * 1024 + 1], "image/png", true)
                                    .statusCode())
                    .isEqualTo(413);
            var replaced = multipart(a, path, png(), "image/png", true);
            assertThat(replaced.statusCode()).isEqualTo(200);
            assertThat(imageStatus(url)).isEqualTo(404);
            previous = mapper.readTree(replaced.body()).path(key).asText();
            assertThat(imageStatus(previous)).isEqualTo(200);
        }
        call(a, "GET", "/account/export/profile-media", null, 401);
        exportGrant(a);
        exportGrant(b);
        var media = call(a, "GET", "/account/export/profile-media", null, 200);
        assertThat(media.size()).isEqualTo(2);
        for (var item : media) {
            String path = "/account/export/profile-media/" + item.path("id").asText();
            var download =
                    java.net.http.HttpClient.newHttpClient()
                            .send(
                                    java.net.http.HttpRequest.newBuilder(
                                                    java.net.URI.create(
                                                            "http://localhost:" + port + path))
                                            .header("Authorization", "Bearer " + a.browser().access)
                                            .header("X-Export-Grant", a.browser().exportGrant)
                                            .GET()
                                            .build(),
                                    java.net.http.HttpResponse.BodyHandlers.ofByteArray());
            assertThat(download.statusCode()).isEqualTo(200);
            assertThat(
                            javax.imageio.ImageIO.read(
                                    new java.io.ByteArrayInputStream(download.body())))
                    .isNotNull();
            call(b, "GET", path, null, 404);
        }
        lifecycle.apply(
                new Sessions.Principal(accounts.get(a.id()), UUID.randomUUID()),
                new am.polylink.chat.AccountLifecycle.Request("1", a.secret()),
                true);
        assertThat(imageStatus(previous)).isEqualTo(404);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ProfileAvatars WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isZero();
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ProfileCovers WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isZero();
    }

    @Test
    void deactivationKeepsBytesButDisablesPublicImages() throws Exception {
        var a = fixture.enroll("lecturer");
        var upload = multipart(a, "/users/me/banner", png(), "image/png", true);
        assertThat(upload.statusCode()).isEqualTo(200);
        String url = mapper.readTree(upload.body()).path("cover").asText();
        lifecycle.apply(
                new Sessions.Principal(accounts.get(a.id()), UUID.randomUUID()),
                new am.polylink.chat.AccountLifecycle.Request("1", a.secret()),
                false);
        assertThat(imageStatus(url)).isEqualTo(404);
        assertThatThrownBy(
                        () ->
                                profiles.update(
                                        a.id(),
                                        Map.of("jobTitle", "stale save", "description", "")))
                .isInstanceOf(AuthFailure.class);
        assertThat(
                        db.queryForObject(
                                "SELECT COUNT(*) FROM auth.ProfileCovers WHERE UserId=?",
                                Integer.class,
                                a.id()))
                .isEqualTo(1);
    }
}
