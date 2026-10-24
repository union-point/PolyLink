package am.polylink.forum;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.forum.enabled", havingValue = "true")
public class ForumController {
    private final Sessions sessions;
    private final ForumService forum;
    private final RateLimiter limits;

    public ForumController(Sessions sessions, ForumService forum, RateLimiter limits) {
        this.sessions = sessions;
        this.forum = forum;
        this.limits = limits;
    }

    private int caller(HttpServletRequest request, boolean write) {
        var account = sessions.require(request).account();
        forum.requireAccess(account);
        if (write) limits.consume("FORUM_WRITE", "" + account.id(), 120, 60);
        return account.id();
    }

    private static int id(String value) {
        try {
            if (!value.matches("[1-9][0-9]{0,9}")) throw new IllegalArgumentException();
            return Integer.parseInt(value);
        } catch (IllegalArgumentException e) {
            throw ForumFailure.missing();
        }
    }

    @GetMapping("/forum/categories")
    public Object categories(HttpServletRequest request) {
        caller(request, false);
        return forum.categories();
    }

    @GetMapping("/forum/topics")
    public Object topics(
            @RequestParam(defaultValue = "") String categoryCode,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "20") int limit,
            HttpServletRequest request) {
        return forum.topics(caller(request, false), categoryCode, cursor, limit);
    }

    @PostMapping("/forum/topics")
    public ResponseEntity<?> create(
            @RequestBody Map<String, Object> input, HttpServletRequest request) {
        return ResponseEntity.status(201).body(forum.createTopic(caller(request, true), input));
    }

    @GetMapping("/forum/topics/{topic}")
    public Object topic(@PathVariable String topic, HttpServletRequest request) {
        return forum.topic(caller(request, false), id(topic));
    }

    @PatchMapping("/forum/topics/{topic}")
    public Object update(
            @PathVariable String topic,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return forum.updateTopic(caller(request, true), id(topic), input);
    }

    @DeleteMapping("/forum/topics/{topic}")
    public ResponseEntity<?> delete(
            @PathVariable String topic,
            @RequestParam String expectedVersion,
            HttpServletRequest request) {
        forum.deleteTopic(caller(request, true), id(topic), expectedVersion);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/forum/topics/{topic}/replies")
    public Object replies(
            @PathVariable String topic,
            @RequestParam(defaultValue = "newest") String sort,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "20") int limit,
            HttpServletRequest request) {
        return forum.replies(caller(request, false), id(topic), sort, cursor, limit);
    }

    @PostMapping("/forum/topics/{topic}/replies")
    public ResponseEntity<?> reply(
            @PathVariable String topic,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return ResponseEntity.status(201)
                .body(forum.createReply(caller(request, true), id(topic), input));
    }

    @GetMapping("/forum/replies/{reply}")
    public Object getReply(@PathVariable String reply, HttpServletRequest request) {
        return forum.reply(caller(request, false), id(reply));
    }

    @PatchMapping("/forum/replies/{reply}")
    public Object updateReply(
            @PathVariable String reply,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return forum.updateReply(caller(request, true), id(reply), input);
    }

    @DeleteMapping("/forum/replies/{reply}")
    public ResponseEntity<?> deleteReply(
            @PathVariable String reply,
            @RequestParam String expectedVersion,
            HttpServletRequest request) {
        forum.deleteReply(caller(request, true), id(reply), expectedVersion);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/forum/replies/{reply}/like")
    public Object like(
            @PathVariable String reply,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return forum.like(caller(request, true), id(reply), input);
    }
}
