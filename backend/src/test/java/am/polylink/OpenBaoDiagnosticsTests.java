package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import am.polylink.keyvault.OpenBaoTransitClient;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.json.JsonMapper;

class OpenBaoDiagnosticsTests {
    @TempDir Path directory;

    @Test
    void operatorDiagnosticsKeepHttpFailuresUsefulWithoutLoggingSensitiveMaterial()
            throws Exception {
        String secret = "synthetic-token-canary", responseBody = "synthetic-response-key-canary";
        Path token = directory.resolve("token");
        Files.writeString(token, secret);
        var status = new AtomicInteger(403);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/v1/transit/encrypt/polylink-vault",
                exchange -> {
                    exchange.getRequestBody().readAllBytes();
                    byte[] body = responseBody.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status.get(), body.length);
                    exchange.getResponseBody().write(body);
                    exchange.close();
                });
        server.start();
        var logger = (Logger) LoggerFactory.getLogger(OpenBaoTransitClient.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            var client =
                    new OpenBaoTransitClient(
                            "http://127.0.0.1:" + server.getAddress().getPort(),
                            token.toString(),
                            true,
                            JsonMapper.builder().build());
            assertThatThrownBy(() -> client.wrap(7, 1, new byte[32]))
                    .isInstanceOf(AuthFailure.class);
            status.set(200);
            assertThatThrownBy(() -> client.wrap(7, 1, new byte[32]))
                    .isInstanceOf(AuthFailure.class);
            Files.delete(token);
            assertThatThrownBy(() -> client.wrap(7, 1, new byte[32]))
                    .isInstanceOf(AuthFailure.class);
            assertThat(appender.list).hasSize(3);
            String logs =
                    appender.list.stream()
                            .map(ILoggingEvent::getFormattedMessage)
                            .collect(java.util.stream.Collectors.joining("\n"));
            assertThat(logs)
                    .contains(
                            "operation=v1/transit/encrypt/polylink-vault",
                            "reason=HTTP_403",
                            "reason=INVALID_RESPONSE",
                            "reason=IO")
                    .doesNotContain(secret, responseBody, token.toString());
            assertThat(appender.list)
                    .allSatisfy(event -> assertThat(event.getThrowableProxy()).isNull());
        } finally {
            logger.detachAppender(appender);
            appender.stop();
            server.stop(0);
        }
    }
}
