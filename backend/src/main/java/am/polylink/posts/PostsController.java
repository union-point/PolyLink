package am.polylink.posts;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.posts.enabled", havingValue = "true")
public class PostsController {
    private final Sessions sessions;
    private final PostsService posts;
    private final RateLimiter limits;

    public PostsController(Sessions sessions, PostsService posts, RateLimiter limits) {
        this.sessions = sessions;
        this.posts = posts;
        this.limits = limits;
    }

    private int caller(HttpServletRequest request, boolean write) {
        var account = sessions.require(request).account();
        posts.requireAccess(account, write);
        if (write) limits.consume("POSTS_WRITE", "" + account.id(), 120, 60);
        return account.id();
    }

    private static int id(String value) {
        return PostsService.id(value, "id");
    }

    private static void query(HttpServletRequest request, Set<String> allowed) {
        for (var entry : request.getParameterMap().entrySet())
            if (!allowed.contains(entry.getKey()) || entry.getValue().length != 1)
                throw PostsFailure.invalid(entry.getKey(), "Անվավեր հարցման դաշտ։");
    }

    @GetMapping("/posts/options")
    public Object options(HttpServletRequest r) {
        caller(r, false);
        return posts.options();
    }

    @GetMapping("/posts")
    public Object list(
            @RequestParam(defaultValue = "") String category,
            @RequestParam(defaultValue = "") String sphereCode,
            @RequestParam(defaultValue = "") String userId,
            @RequestParam(defaultValue = "") String cursor,
            HttpServletRequest r) {
        int user = caller(r, false);
        query(r, Set.of("category", "sphereCode", "userId", "cursor"));
        return posts.list(user, category, sphereCode, userId, cursor);
    }

    @GetMapping("/posts/{post}")
    public Object get(@PathVariable String post, HttpServletRequest r) {
        return posts.get(caller(r, false), id(post));
    }

    @PostMapping("/posts")
    public ResponseEntity<?> create(@RequestBody Map<String, Object> input, HttpServletRequest r) {
        return ResponseEntity.status(201).body(posts.create(caller(r, true), input));
    }

    @PutMapping("/posts/{post}")
    public Object update(
            @PathVariable String post,
            @RequestBody Map<String, Object> input,
            HttpServletRequest r) {
        return posts.update(caller(r, true), id(post), input);
    }

    @DeleteMapping("/posts/{post}")
    public ResponseEntity<?> delete(@PathVariable String post, HttpServletRequest r) {
        posts.delete(caller(r, true), id(post));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/posts/{post}/comments")
    public Object comments(
            @PathVariable String post,
            @RequestParam(defaultValue = "") String cursor,
            HttpServletRequest r) {
        int user = caller(r, false);
        query(r, Set.of("cursor"));
        return posts.comments(user, id(post), cursor);
    }

    @PostMapping("/posts/{post}/comments")
    public ResponseEntity<?> comment(
            @PathVariable String post,
            @RequestBody Map<String, Object> input,
            HttpServletRequest r) {
        return ResponseEntity.status(201)
                .body(posts.createComment(caller(r, true), id(post), input));
    }

    @PutMapping("/posts/{post}/comments/{comment}")
    public Object updateComment(
            @PathVariable String post,
            @PathVariable String comment,
            @RequestBody Map<String, Object> input,
            HttpServletRequest r) {
        return posts.updateComment(caller(r, true), id(post), id(comment), input);
    }

    @DeleteMapping("/posts/{post}/comments/{comment}")
    public ResponseEntity<?> deleteComment(
            @PathVariable String post, @PathVariable String comment, HttpServletRequest r) {
        posts.deleteComment(caller(r, true), id(post), id(comment));
        return ResponseEntity.noContent().build();
    }
}
