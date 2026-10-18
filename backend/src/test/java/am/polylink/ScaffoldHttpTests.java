package am.polylink;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            // This scaffold exercises the database-free, identity-disabled security boundary.
            "polylink.identity.enabled=false",
            "spring.autoconfigure.exclude="
                    + "org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
                    + "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration"
        })
class ScaffoldHttpTests {

    @LocalServerPort private int port;

    @Test
    void exposesHealthWithoutCredentials() throws Exception {
        var response = get("/actuator/health");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"status\":\"UP\"");
        assertThat(response.body()).doesNotContain("components");
    }

    @Test
    void deniesOtherEndpointsWhenIdentityIsDisabled() throws Exception {
        assertThat(get("/api/probe").statusCode()).isEqualTo(403);
        assertThat(get("/actuator/env").statusCode()).isEqualTo(403);
    }

    private HttpResponse<String> get(String path) throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            var request =
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                            .GET()
                            .build();
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }
    }
}
