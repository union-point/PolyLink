package am.polylink.profile;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class ProfileController {
    private final Sessions sessions;
    private final ProfileService profiles;
    private final RateLimiter limits;

    public ProfileController(Sessions sessions, ProfileService profiles, RateLimiter limits) {
        this.sessions = sessions;
        this.profiles = profiles;
        this.limits = limits;
    }

    private int caller(HttpServletRequest r, boolean write) {
        int user = sessions.require(r).account().id();
        if (write) limits.consume("PROFILE_WRITE", "" + user, 120, 60);
        return user;
    }

    @PutMapping("/users/me")
    public Object update(@RequestBody Map<String, Object> input, HttpServletRequest r) {
        return profiles.update(caller(r, true), input);
    }

    @GetMapping("/users/me/education/options")
    public Object options(HttpServletRequest r) {
        caller(r, false);
        return profiles.options();
    }

    @GetMapping("/users/me/education")
    public Object education(HttpServletRequest r) {
        return profiles.education(caller(r, false));
    }

    @PostMapping("/users/me/education")
    public ResponseEntity<?> createEducation(
            @RequestBody Map<String, Object> input, HttpServletRequest r) {
        return ResponseEntity.status(201)
                .body(profiles.saveEducation(caller(r, true), null, input));
    }

    @PutMapping("/users/me/education/{id}")
    public Object updateEducation(
            @PathVariable String id, @RequestBody Map<String, Object> input, HttpServletRequest r) {
        return profiles.saveEducation(caller(r, true), ProfileValues.id(id, true), input);
    }

    @DeleteMapping("/users/me/education/{id}")
    public ResponseEntity<?> deleteEducation(@PathVariable String id, HttpServletRequest r) {
        profiles.delete(caller(r, true), ProfileValues.id(id, true), true);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/users/me/licenses")
    public Object certificates(HttpServletRequest r) {
        return profiles.certificates(caller(r, false));
    }

    @PostMapping("/users/me/licenses")
    public ResponseEntity<?> createCertificate(
            @RequestBody Map<String, Object> input, HttpServletRequest r) {
        return ResponseEntity.status(201)
                .body(profiles.saveCertificate(caller(r, true), null, input));
    }

    @PutMapping("/users/me/licenses/{id}")
    public Object updateCertificate(
            @PathVariable String id, @RequestBody Map<String, Object> input, HttpServletRequest r) {
        return profiles.saveCertificate(caller(r, true), ProfileValues.id(id, true), input);
    }

    @DeleteMapping("/users/me/licenses/{id}")
    public ResponseEntity<?> deleteCertificate(@PathVariable String id, HttpServletRequest r) {
        profiles.delete(caller(r, true), ProfileValues.id(id, true), false);
        return ResponseEntity.noContent().build();
    }
}
