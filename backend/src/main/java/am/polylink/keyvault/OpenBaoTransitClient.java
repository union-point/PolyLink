package am.polylink.keyvault;

import am.polylink.auth.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
@IdentityEnabled
public class OpenBaoTransitClient implements TransitClient {
    private final URI base;
    private final Path token;
    private final JsonMapper mapper;
    private final HttpClient http =
            HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(3))
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build();

    public OpenBaoTransitClient(
            @Value("${polylink.openbao.url}") String url,
            @Value("${polylink.openbao.token-file}") String token,
            @Value("${polylink.openbao.allow-loopback-http:false}") boolean allowLoopback,
            JsonMapper mapper) {
        this.base = URI.create(url.endsWith("/") ? url : url + "/");
        this.token = Path.of(token);
        this.mapper = mapper;
        if (base.getUserInfo() != null
                || base.getQuery() != null
                || base.getFragment() != null
                || (!base.getScheme().equals("https")
                        && !(allowLoopback
                                && base.getScheme().equals("http")
                                && Set.of("localhost", "127.0.0.1", "[::1]")
                                        .contains(base.getHost()))))
            throw new IllegalArgumentException(
                    "OpenBao requires HTTPS; loopback HTTP must be explicitly enabled for local tests");
    }

    @Override
    public Wrapped wrap(int user, long version, byte[] key) {
        String context =
                Base64.getEncoder()
                        .encodeToString(
                                mapper.writeValueAsBytes(
                                        List.of("PLK1", "service-copy", "" + user, "" + version)));
        String encoded = Base64.getEncoder().encodeToString(key);
        var encrypted = post("encrypt", Map.of("plaintext", encoded, "context", context));
        String ciphertext = encrypted.path("data").path("ciphertext").asText();
        if (!ciphertext.startsWith("vault:v") || ciphertext.length() > 2048)
            throw AuthFailure.unavailable();
        byte[] opened;
        try {
            opened =
                    Base64.getDecoder()
                            .decode(
                                    post(
                                                    "decrypt",
                                                    Map.of(
                                                            "ciphertext",
                                                            ciphertext,
                                                            "context",
                                                            context))
                                            .path("data")
                                            .path("plaintext")
                                            .asText());
        } catch (IllegalArgumentException e) {
            throw AuthFailure.unavailable();
        }
        try {
            if (!Secrets.equal(key, opened)) throw AuthFailure.unavailable();
        } finally {
            Arrays.fill(opened, (byte) 0);
        }
        return new Wrapped(ciphertext, context);
    }

    @Override
    public byte[] unwrap(int user, long version, String ciphertext, String context) {
        String expected =
                Base64.getEncoder()
                        .encodeToString(
                                mapper.writeValueAsBytes(
                                        List.of("PLK1", "service-copy", "" + user, "" + version)));
        if (!expected.equals(context) || !ciphertext.startsWith("vault:v"))
            throw AuthFailure.denied();
        try {
            byte[] key =
                    Base64.getDecoder()
                            .decode(
                                    post(
                                                    "decrypt",
                                                    Map.of(
                                                            "ciphertext",
                                                            ciphertext,
                                                            "context",
                                                            expected))
                                            .path("data")
                                            .path("plaintext")
                                            .asText());
            if (key.length != 32) {
                Arrays.fill(key, (byte) 0);
                throw AuthFailure.unavailable();
            }
            return key;
        } catch (IllegalArgumentException e) {
            throw AuthFailure.unavailable();
        }
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 600000, initialDelay = 600000)
    public void renewServiceToken() {
        try {
            request("v1/auth/token/renew-self", Map.of("increment", "1800"));
        } catch (AuthFailure ignored) {
            org.slf4j.LoggerFactory.getLogger(OpenBaoTransitClient.class)
                    .warn("OpenBao service token renewal is unavailable");
        }
    }

    private JsonNode post(String operation, Map<String, String> body) {
        return request("v1/transit/" + operation + "/polylink-vault", body);
    }

    private JsonNode request(String path, Map<String, String> body) {
        try {
            if (Files.size(token) > 4096) throw unavailable(path, "TOKEN_FILE_INVALID");
            String credential = Files.readString(token).strip();
            if (credential.isEmpty()) throw unavailable(path, "TOKEN_FILE_INVALID");
            var request =
                    HttpRequest.newBuilder(base.resolve(path))
                            .timeout(Duration.ofSeconds(5))
                            .header("X-Vault-Token", credential)
                            .header("Content-Type", "application/json")
                            .POST(
                                    HttpRequest.BodyPublishers.ofByteArray(
                                            mapper.writeValueAsBytes(body)))
                            .build();
            var response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200)
                throw unavailable(path, "HTTP_" + response.statusCode());
            if (response.body().length() > 16384) throw unavailable(path, "INVALID_RESPONSE");
            return mapper.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable(path, "INTERRUPTED");
        } catch (AuthFailure e) {
            throw e;
        } catch (Exception e) {
            String reason = "INVALID_RESPONSE";
            if (e instanceof java.io.IOException) reason = "IO";
            if (e instanceof HttpTimeoutException) reason = "TIMEOUT";
            for (Throwable cause = e; cause != null; cause = cause.getCause())
                if (cause instanceof javax.net.ssl.SSLException) {
                    reason = "TLS_TRUST_OR_HANDSHAKE";
                    break;
                }
            throw unavailable(path, reason);
        }
    }

    private AuthFailure unavailable(String path, String reason) {
        // Never log credentials, request/response bodies, key material or exception messages.
        org.slf4j.LoggerFactory.getLogger(OpenBaoTransitClient.class)
                .warn("OpenBao request unavailable: operation={}, reason={}", path, reason);
        return AuthFailure.unavailable();
    }
}
