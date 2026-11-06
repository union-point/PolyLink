package am.polylink.auth;

import am.polylink.keyvault.KeyVaultService;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class IdentityController {
    private final am.polylink.profile.ProfileService profiles;
    private final PasswordChanges passwords;
    private final EnrollmentService enrollment;
    private final EnrollmentSessions enrollmentSessions;
    private final Challenges challenges;
    private final Sessions sessions;
    private final KeyVaultService vault;
    private final Secrets secrets;
    private final RateLimiter limits;
    private final org.springframework.jdbc.core.JdbcTemplate db;

    public IdentityController(
            am.polylink.profile.ProfileService profiles,
            PasswordChanges passwords,
            EnrollmentService enrollment,
            EnrollmentSessions enrollmentSessions,
            Challenges challenges,
            Sessions sessions,
            KeyVaultService vault,
            Secrets secrets,
            RateLimiter limits,
            org.springframework.jdbc.core.JdbcTemplate db) {
        this.profiles = profiles;
        this.passwords = passwords;
        this.enrollment = enrollment;
        this.enrollmentSessions = enrollmentSessions;
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
        var result = enrollment.register(input, request.getRemoteAddr(), response);
        sessions.clear(response);
        return result;
    }

    @GetMapping("/auth/enrollment")
    public Map<String, Object> enrollment(HttpServletRequest request) {
        return enrollment.state(request);
    }

    @GetMapping("/auth/enrollment/options")
    public Map<String, Object> enrollmentOptions(HttpServletRequest request) {
        return enrollment.options(request);
    }

    @PutMapping("/auth/enrollment/profile")
    public Map<String, Object> enrollmentProfile(
            @Valid @RequestBody EnrollmentDtos.Profile input, HttpServletRequest request) {
        return enrollment.save(input, request);
    }

    @PostMapping("/auth/enrollment/submit")
    public Map<String, Object> enrollmentSubmit(
            @Valid @RequestBody EnrollmentDtos.Revision input, HttpServletRequest request) {
        return enrollment.submit(input.revision(), request);
    }

    @PutMapping("/auth/enrollment/password")
    public Map<String, Object> enrollmentPassword(
            @Valid @RequestBody EnrollmentDtos.Password input, HttpServletRequest request) {
        return enrollment.resetPassword(input, request);
    }

    @PostMapping("/auth/enrollment/logout")
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void enrollmentLogout(
            @RequestBody Map<String, Object> input,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (!input.isEmpty()) throw AuthFailure.invalid();
        enrollmentSessions.logout(request, response);
    }

    @PostMapping("/auth/email/verify")
    public Map<String, Object> verifyEmail(
            @Valid @RequestBody AuthDtos.CodeProof input, HttpServletRequest request) {
        return enrollment.verifyEmail(input, request);
    }

    @PostMapping("/auth/login")
    public Map<String, Object> login(
            @Valid @RequestBody AuthDtos.Login input,
            HttpServletRequest request,
            HttpServletResponse response) {
        var account = enrollment.password(input, request.getRemoteAddr());
        if (account.admission().equals("PENDING")) {
            sessions.clear(response);
            enrollmentSessions.issue(account.id(), account.credential(), response);
            return Map.of("status", "enrollment", "next", "profile_info.html");
        }
        EnrollmentSessions.clear(response);
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
        EnrollmentSessions.clear(response);
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
        EnrollmentSessions.clear(response);
        return issued.response();
    }

    @PostMapping("/auth/challenges/resend")
    public Map<String, Object> resend(
            @Valid @RequestBody AuthDtos.ChallengeId input,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (!Sessions.cookie(request, EnrollmentSessions.COOKIE).isEmpty()
                && challenges.isEnrollment(input.challengeId())) {
            return enrollment.resend(input.challengeId(), request);
        }
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
        EnrollmentSessions.clear(response);
        return issued.response();
    }

    @PostMapping("/auth/logout")
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout(
            @RequestBody Map<String, Object> input,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (!input.isEmpty()) throw AuthFailure.invalid();
        if (!Sessions.cookie(request, EnrollmentSessions.COOKIE).isEmpty())
            enrollmentSessions.logout(request, response);
        else sessions.logout(request);
        sessions.clear(response);
    }

    @PostMapping("/auth/password-change/prepare")
    public Map<String, Object> passwordPrepare(
            @Valid @RequestBody AuthDtos.PasswordChange input, HttpServletRequest request) {
        var caller = sessions.require(request);
        limits.consume("PASSWORD_CHANGE", "" + caller.account().id(), 10, 900);
        return passwords.prepare(caller, input);
    }

    @PostMapping("/auth/password-change/commit")
    public Map<String, Object> passwordCommit(
            @Valid @RequestBody AuthDtos.OperationId input, HttpServletRequest request) {
        Sessions.Principal caller;
        try {
            caller = sessions.require(request);
        } catch (AuthFailure e) {
            if (e.status != 401) throw e;
            return passwords.completed(sessions.passwordResultCaller(request), input.operationId());
        }
        return passwords.commit(caller, input.operationId());
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
        return profiles.get(sessions.require(request).account().id(), userId);
    }
}
