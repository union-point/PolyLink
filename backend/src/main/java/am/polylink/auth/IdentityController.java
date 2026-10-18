package am.polylink.auth;

import am.polylink.keyvault.KeyVaultService;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class IdentityController {
    private final EnrollmentService enrollment;
    private final Challenges challenges;
    private final Sessions sessions;
    private final KeyVaultService vault;
    private final Secrets secrets;
    private final RateLimiter limits;
    private final org.springframework.jdbc.core.JdbcTemplate db;

    public IdentityController(
            EnrollmentService enrollment,
            Challenges challenges,
            Sessions sessions,
            KeyVaultService vault,
            Secrets secrets,
            RateLimiter limits,
            org.springframework.jdbc.core.JdbcTemplate db) {
        this.enrollment = enrollment;
        this.challenges = challenges;
        this.sessions = sessions;
        this.vault = vault;
        this.secrets = secrets;
        this.limits = limits;
        this.db = db;
    }

    @PostMapping("/auth/parameters")
    public AuthDtos.Derivation parameters(
            @Valid @RequestBody AuthDtos.EmailRequest input, HttpServletRequest request) {
        return enrollment.parameters(input.email(), request.getRemoteAddr());
    }

    @PostMapping("/auth/register")
    public Map<String, Object> register(
            @Valid @RequestBody AuthDtos.Registration input,
            HttpServletRequest request,
            HttpServletResponse response) {
        String browser = secrets.token();
        var created = enrollment.register(input, request.getRemoteAddr(), browser);
        Sessions.cookie(response, Sessions.CHALLENGE, browser, true, 600);
        return created.response();
    }

    @PostMapping("/auth/email/verify")
    public Map<String, Object> verifyEmail(
            @Valid @RequestBody AuthDtos.CodeProof input, HttpServletRequest request) {
        enrollment.verifyEmail(
                input, Sessions.cookie(request, Sessions.CHALLENGE), request.getRemoteAddr());
        return Map.of();
    }

    @PostMapping("/auth/login")
    public Map<String, Object> login(
            @Valid @RequestBody AuthDtos.Login input,
            HttpServletRequest request,
            HttpServletResponse response) {
        var account = enrollment.password(input, request.getRemoteAddr());
        if (account.emailFactor()) {
            limits.issue(account.email(), request.getRemoteAddr());
            String browser = secrets.token();
            var created =
                    challenges.create(
                            account.id(), "LOGIN", account.credential(), account.email(), browser);
            challenges.deliver(created);
            Sessions.cookie(response, Sessions.CHALLENGE, browser, true, 600);
            return Map.of("status", "challenge", "challenge", created.response());
        }
        var issued = sessions.create(account.id(), account.credential(), false);
        sessions.attach(response, issued);
        return issued.response();
    }

    @PostMapping("/auth/login/verify")
    public Map<String, Object> verifyLogin(
            @Valid @RequestBody AuthDtos.CodeProof input,
            HttpServletRequest request,
            HttpServletResponse response) {
        var account =
                challenges.verify(
                        input,
                        "LOGIN",
                        Sessions.cookie(request, Sessions.CHALLENGE),
                        request.getRemoteAddr());
        var issued = sessions.create(account.id(), account.credential(), true);
        sessions.attach(response, issued);
        return issued.response();
    }

    @PostMapping("/auth/challenges/resend")
    public Map<String, Object> resend(
            @Valid @RequestBody AuthDtos.ChallengeId input,
            HttpServletRequest request,
            HttpServletResponse response) {
        String browser = Sessions.cookie(request, Sessions.CHALLENGE);
        var created = challenges.resend(input.challengeId(), browser, request.getRemoteAddr());
        Sessions.cookie(response, Sessions.CHALLENGE, browser, true, 600);
        return created.response();
    }

    @PostMapping("/auth/refresh")
    public Map<String, Object> refresh(
            @RequestBody Map<String, Object> input,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (!input.isEmpty()) throw AuthFailure.invalid();
        var issued = sessions.refresh(request);
        sessions.attach(response, issued);
        return issued.response();
    }

    @PostMapping("/auth/logout")
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout(
            @RequestBody Map<String, Object> input,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (!input.isEmpty()) throw AuthFailure.invalid();
        sessions.logout(request);
        sessions.clear(response);
    }

    @GetMapping("/auth/me")
    public Map<String, Object> me(HttpServletRequest request) {
        return sessions.metadata(sessions.require(request));
    }

    @GetMapping("/keys/me")
    public Map<String, Object> own(HttpServletRequest request) {
        return vault.own(sessions.require(request).account());
    }

    @PostMapping("/keys/setup/prepare")
    public Map<String, Object> prepare(
            @Valid @RequestBody AuthDtos.Setup input, HttpServletRequest request) {
        return vault.prepare(sessions.require(request).account(), input);
    }

    @PostMapping("/keys/setup/commit")
    public Map<String, Object> commit(
            @Valid @RequestBody AuthDtos.OperationId input, HttpServletRequest request) {
        return vault.commit(sessions.require(request).account(), input.operationId());
    }

    @GetMapping("/users/{userId}")
    public Map<String, Object> ownProfile(@PathVariable int userId, HttpServletRequest request) {
        var account = sessions.require(request).account();
        if (account.id() != userId)
            throw new AuthFailure(404, "NOT_FOUND", "The profile is unavailable.");
        var result = new LinkedHashMap<String, Object>(account.user());
        var row =
                Rows.query(
                                db,
                                "SELECT Specialization,About,ProfilePhotoUrl,CoverPhotoUrl FROM dbo.Users WHERE UserId=?",
                                userId)
                        .getFirst();
        result.put("jobTitle", Objects.toString(row.get("Specialization"), ""));
        result.put("description", Objects.toString(row.get("About"), ""));
        result.put("avatar", Objects.toString(row.get("ProfilePhotoUrl"), ""));
        result.put("cover", Objects.toString(row.get("CoverPhotoUrl"), ""));
        result.put("education", List.of());
        result.put("licenses", List.of());
        return result;
    }
}
