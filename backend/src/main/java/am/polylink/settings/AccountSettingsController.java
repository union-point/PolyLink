package am.polylink.settings;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class AccountSettingsController {
    private final Sessions sessions;
    private final AccountSettings settings;

    public AccountSettingsController(Sessions sessions, AccountSettings settings) {
        this.sessions = sessions;
        this.settings = settings;
    }

    @PostMapping("/account/email-change/start")
    public Map<String, Object> start(
            @RequestBody AccountSettings.Start input, HttpServletRequest request) {
        return settings.start(sessions.require(request), input);
    }

    @PostMapping("/account/email-change/verify")
    public Map<String, Object> verify(
            @RequestBody AccountSettings.Code input, HttpServletRequest request) {
        return settings.verify(sessions.require(request), input);
    }

    @PostMapping("/account/email-change/resend")
    public Map<String, Object> resend(
            @RequestBody AccountSettings.Code input, HttpServletRequest request) {
        return settings.resend(sessions.require(request), input);
    }

    @PutMapping("/account/email-factor")
    public Map<String, Object> factor(
            @RequestBody AccountSettings.Factor input, HttpServletRequest request) {
        return settings.factor(sessions.require(request), input);
    }
}
