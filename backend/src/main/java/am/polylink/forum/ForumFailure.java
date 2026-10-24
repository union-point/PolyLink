package am.polylink.forum;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

public final class ForumFailure extends RuntimeException {
    final int status;
    final String code;
    final Map<String, String> fields;

    ForumFailure(int status, String code, String message, Map<String, String> fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
    }

    public static ForumFailure invalid(String field, String message) {
        return new ForumFailure(400, "VALIDATION", message, Map.of(field, message));
    }

    static ForumFailure missing() {
        return new ForumFailure(404, "NOT_FOUND", "Թեման կամ պատասխանը չի գտնվել։", Map.of());
    }

    static ForumFailure forbidden() {
        return new ForumFailure(403, "FORBIDDEN", "Այս գործողությունը հասանելի չէ։", Map.of());
    }

    static ForumFailure stale() {
        return new ForumFailure(
                409,
                "EDIT_CONFLICT",
                "Բովանդակությունը փոխվել է։ Ձեր սևագիրը պահպանված է․ բեռնեք վերջին տարբերակը։",
                Map.of());
    }

    static ForumFailure requestConflict() {
        return new ForumFailure(
                409,
                "REQUEST_CONFLICT",
                "Այս հարցման նույնացուցիչն արդեն օգտագործվել է այլ բովանդակության համար։",
                Map.of());
    }

    @RestControllerAdvice(assignableTypes = ForumController.class)
    public static class Handler {
        @ExceptionHandler(ForumFailure.class)
        public ResponseEntity<?> handle(ForumFailure failure) {
            return ResponseEntity.status(failure.status)
                    .body(
                            Map.of(
                                    "code",
                                    failure.code,
                                    "message",
                                    failure.getMessage(),
                                    "fieldErrors",
                                    failure.fields));
        }
    }
}
