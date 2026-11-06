package am.polylink.admin;

import am.polylink.auth.*;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@AdminEnabled
@RequestMapping("/admin/auth")
public class AdminController {
    public record Invitation(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token) {
        @Override
        public String toString() {
            return "Invitation[redacted]";
        }
    }

    public record Registration(
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token,
            @NotBlank @Size(max = 100) String firstName,
            @NotBlank @Size(max = 100) String lastName,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret,
            @NotNull @Valid AuthDtos.Derivation derivation) {
        @Override
        public String toString() {
            return "AdminRegistration[redacted]";
        }
    }

    private final AdminAuth auth;
    private final AdminSessions sessions;

    public AdminController(AdminAuth auth, AdminSessions sessions) {
        this.auth = auth;
        this.sessions = sessions;
    }

    @PostMapping("/parameters")
    public Object parameters(
            @Valid @RequestBody AuthDtos.EmailRequest input, HttpServletRequest request) {
        return auth.parameters(input.email(), request.getRemoteAddr());
    }

    @PostMapping("/registration/invitation")
    public Object inspect(@Valid @RequestBody Invitation input, HttpServletRequest request) {
        return auth.inspect(input.token(), request.getRemoteAddr());
    }

    @PostMapping("/registration/start")
    public Object register(
            @Valid @RequestBody Registration input,
            HttpServletRequest request,
            HttpServletResponse response) {
        return auth.register(input, request, response);
    }

    @PostMapping("/registration/verify")
    public Object verifyRegistration(
            @Valid @RequestBody AuthDtos.CodeProof input,
            HttpServletRequest request,
            HttpServletResponse response) {
        return auth.verify(input, "REGISTER", request, response);
    }

    @PostMapping("/registration/resend")
    public Object resendRegistration(
            @Valid @RequestBody AuthDtos.ChallengeId input, HttpServletRequest request) {
        return auth.resend(input.challengeId(), "REGISTER", request);
    }

    @PostMapping("/login")
    public Object login(
            @Valid @RequestBody AuthDtos.Login input,
            HttpServletRequest request,
            HttpServletResponse response) {
        return auth.login(input, request, response);
    }

    @PostMapping("/login/verify")
    public Object verifyLogin(
            @Valid @RequestBody AuthDtos.CodeProof input,
            HttpServletRequest request,
            HttpServletResponse response) {
        return auth.verify(input, "LOGIN", request, response);
    }

    @PostMapping("/login/resend")
    public Object resendLogin(
            @Valid @RequestBody AuthDtos.ChallengeId input, HttpServletRequest request) {
        return auth.resend(input.challengeId(), "LOGIN", request);
    }

    @GetMapping("/session")
    public Object session(HttpServletRequest request) {
        return sessions.metadata(sessions.require(request, false));
    }

    @PostMapping("/refresh")
    public Object refresh(
            @RequestBody Map<String, Object> input,
            HttpServletRequest request,
            HttpServletResponse response) {
        empty(input);
        return sessions.refresh(request, response);
    }

    @PostMapping("/logout")
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout(
            @RequestBody Map<String, Object> input,
            HttpServletRequest request,
            HttpServletResponse response) {
        empty(input);
        sessions.logout(request, response);
    }

    private static void empty(Map<String, Object> input) {
        if (!input.isEmpty()) throw AuthFailure.invalid();
    }
}
