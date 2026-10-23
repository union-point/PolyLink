package am.polylink.settings;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class NotificationController {
    private final Sessions sessions;
    private final NotificationService notifications;

    public NotificationController(Sessions sessions, NotificationService notifications) {
        this.sessions = sessions;
        this.notifications = notifications;
    }

    @GetMapping("/notifications")
    public Map<String, Object> list(
            @RequestParam(defaultValue = "initial") String cursor,
            @RequestParam(defaultValue = "50") int limit,
            HttpServletRequest request) {
        return notifications.list(sessions.require(request).account().id(), cursor, limit);
    }
}
