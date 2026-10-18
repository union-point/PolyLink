package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class IdentityPrimitivesTests {
    private final String key = Secrets.encode(new byte[32]);

    @Test
    void replayPacketsAuthenticateAndDoNotExposeCredentials() {
        var secrets = new Secrets(key, Secrets.encode(new byte[32]));
        byte[] plain = "synthetic-refresh-token".getBytes(StandardCharsets.UTF_8),
                packet = secrets.encryptReplay(plain);
        assertThat(secrets.decryptReplay(packet)).isEqualTo(plain);
        assertThat(new String(packet, StandardCharsets.UTF_8))
                .doesNotContain("synthetic-refresh-token");
        packet[packet.length - 1] ^= 1;
        assertThatThrownBy(() -> secrets.decryptReplay(packet)).isInstanceOf(AuthFailure.class);
    }

    @Test
    void canonicalEncodingAndPurposeSeparationAreEnforced() {
        assertThatThrownBy(() -> Secrets.decode("A".repeat(42) + "B", 32))
                .isInstanceOf(AuthFailure.class);
        var secrets = new Secrets(key, key);
        assertThat(secrets.mac("email-code", "fixture"))
                .isNotEqualTo(secrets.mac("dummy-salt", "fixture"));
        assertThat(Secrets.decode(Secrets.encode(new byte[32]), 32)).hasSize(32);
    }

    @Test
    void memoryHardWorkHasABoundedConcurrentBudget() throws Exception {
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        PasswordEncoder slow =
                new PasswordEncoder() {
                    public String encode(CharSequence value) {
                        started.countDown();
                        try {
                            release.await();
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            throw new IllegalStateException();
                        }
                        return "encoded";
                    }

                    public boolean matches(CharSequence value, String encoded) {
                        return true;
                    }
                };
        var bounded = new BoundedPasswordEncoder(slow, 1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> bounded.encode("synthetic"));
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            try {
                assertThatThrownBy(() -> bounded.matches("other", "encoded"))
                        .isInstanceOf(AuthFailure.class);
            } finally {
                release.countDown();
            }
            assertThat(first.get()).isEqualTo("encoded");
            assertThat(bounded.matches("synthetic", "encoded")).isTrue();
        }
    }
}
