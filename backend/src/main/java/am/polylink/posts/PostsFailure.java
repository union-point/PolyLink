package am.polylink.posts;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

public final class PostsFailure extends RuntimeException {
    final int status;
    final String code;
    final Map<String, String> fields;

    private PostsFailure(int status, String code, String message, Map<String, String> fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
    }

    public static PostsFailure invalid(String field, String message) {
        return new PostsFailure(400, "VALIDATION", message, Map.of(field, message));
    }

    static PostsFailure missing() {
        return new PostsFailure(
                404, "NOT_FOUND", "Հայտարարությունը կամ մեկնաբանությունը հասանելի չէ։", Map.of());
    }

    static PostsFailure forbidden() {
        return new PostsFailure(403, "FORBIDDEN", "Այս գործողությունը հասանելի չէ։", Map.of());
    }

    @RestControllerAdvice(basePackages = "am.polylink.posts")
    public static class Handler {
        @ExceptionHandler(PostsFailure.class)
        public ResponseEntity<?> handle(PostsFailure e) {
            return ResponseEntity.status(e.status)
                    .body(
                            Map.of(
                                    "code",
                                    e.code,
                                    "message",
                                    e.getMessage(),
                                    "fieldErrors",
                                    e.fields));
        }
    }
}
