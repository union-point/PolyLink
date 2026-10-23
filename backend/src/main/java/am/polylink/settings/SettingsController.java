package am.polylink.settings;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class SettingsController {
    private final Sessions sessions;
    private final SettingsService settings;

    public SettingsController(Sessions sessions, SettingsService settings) {
        this.sessions = sessions;
        this.settings = settings;
    }

    @GetMapping("/settings")
    public Map<String, Object> get(HttpServletRequest request) {
        return settings.get(sessions.require(request).account().id());
    }

    @PatchMapping("/settings")
    public Map<String, Object> update(
            @RequestBody Map<String, Object> patch, HttpServletRequest request) {
        return settings.update(sessions.require(request).account().id(), patch);
    }
}
