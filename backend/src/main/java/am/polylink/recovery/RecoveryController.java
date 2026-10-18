package am.polylink.recovery;

import am.polylink.auth.*;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
@RequestMapping("/auth/recovery")
public class RecoveryController {
    private final RecoveryService recovery;
    private final Sessions sessions;

    public RecoveryController(RecoveryService recovery, Sessions sessions) {
        this.recovery = recovery;
        this.sessions = sessions;
    }

    @PostMapping("/request")
    public Map<String, Object> request(
            @Valid @RequestBody AuthDtos.EmailRequest input,
            HttpServletRequest request,
            HttpServletResponse response) {
        return recovery.request(input.email(), request.getRemoteAddr(), response);
    }

    @PostMapping("/verify")
    public Map<String, Object> verify(
            @Valid @RequestBody AuthDtos.CodeProof input,
            HttpServletRequest request,
            HttpServletResponse response) {
        return recovery.verify(input, request, response);
    }

    @GetMapping("/status")
    public Map<String, Object> status(HttpServletRequest request) {
        return recovery.status(request);
    }

    @PostMapping("/unlock")
    public Map<String, Object> unlock(
            @Valid @RequestBody AuthDtos.OperationId input, HttpServletRequest request) {
        return recovery.unlock(input, request);
    }

    @PostMapping("/prepare")
    public Map<String, Object> prepare(
            @Valid @RequestBody AuthDtos.Recovery input, HttpServletRequest request) {
        return recovery.prepare(input, request);
    }

    @PostMapping("/commit")
    public Map<String, Object> commit(
            @Valid @RequestBody AuthDtos.OperationId input, HttpServletRequest request) {
        return recovery.commit(input, request);
    }

    @PostMapping("/login")
    public Map<String, Object> login(
            @Valid @RequestBody AuthDtos.Login input,
            HttpServletRequest request,
            HttpServletResponse response) {
        var issued = recovery.login(input, request);
        sessions.attach(response, issued);
        return issued.response();
    }
}
