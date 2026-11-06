package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.IdentityBoundary;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;

class IdentityBoundaryTests {
    @Test
    void encryptedUploadsRejectAByteBeyondFiveMiBAndTheAuthenticationTag() throws Exception {
        String path = "/chat/rooms/" + UUID.randomUUID() + "/attachments";
        assertThat(accepted(path, 5_242_896)).isTrue();
        assertThat(accepted(path, 5_242_897)).isFalse();
    }

    @Test
    void profileMultipartUploadsRetainSpaceForTheirEnvelope() throws Exception {
        assertThat(accepted("/users/me/photo", 5_259_264)).isTrue();
        assertThat(accepted("/users/me/banner", 5_259_265)).isFalse();
    }

    private boolean accepted(String path, int size) throws Exception {
        var request = new MockHttpServletRequest("POST", path);
        request.addHeader("Origin", "http://localhost:8001");
        request.setContent(new byte[size]);
        var response = new MockHttpServletResponse();
        var reached = new AtomicBoolean();
        new IdentityBoundary(Set.of("http://localhost:8001"))
                .doFilter(request, response, (req, res) -> reached.set(true));
        if (!reached.get()) assertThat(response.getStatus()).isEqualTo(413);
        return reached.get();
    }
}
