package am.polylink.chat;

import am.polylink.auth.*;
import jakarta.servlet.http.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.messenger.enabled", havingValue = "true")
public class LifecycleController {
    private final Sessions sessions;
    private final AccountLifecycle lifecycle;
    private final RateLimiter limits;

    public LifecycleController(Sessions sessions, AccountLifecycle lifecycle, RateLimiter limits) {
        this.sessions = sessions;
        this.lifecycle = lifecycle;
        this.limits = limits;
    }

    @PostMapping({"/account/deactivate", "/account/delete"})
    public java.util.Map<String, Object> apply(
            @RequestBody AccountLifecycle.Request input,
            HttpServletRequest request,
            HttpServletResponse response) {
        var caller = sessions.require(request);
        limits.consume("LIFECYCLE", "" + caller.account().id(), 5, 3600);
        lifecycle.apply(caller, input, request.getRequestURI().equals("/account/delete"));
        // Server revocation is immediate; clear cookies using the normal logout writer.
        sessions.clear(response);
        return java.util.Map.of("status", "completed");
    }
}
