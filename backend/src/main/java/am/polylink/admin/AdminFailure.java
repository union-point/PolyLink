package am.polylink.admin;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

final class AdminFailure extends RuntimeException {
    final int status;
    final String code;
    final Map<String, String> fields;

    private AdminFailure(int status, String code, String message, Map<String, String> fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
    }

    static AdminFailure invalid(String field, String message) {
        return new AdminFailure(400, "VALIDATION", message, Map.of(field, message));
    }

    static AdminFailure missing() {
        return new AdminFailure(404, "NOT_FOUND", "The reference value was not found.", Map.of());
    }

    static AdminFailure conflict(String code, String message) {
        return new AdminFailure(409, code, message, Map.of());
    }

    static AdminFailure registryMissing() {
        return new AdminFailure(404, "NOT_FOUND", "The registry record was not found.", Map.of());
    }

    static AdminFailure registryDuplicate(String field, String code) {
        String message = "A registry record with this identity already exists.";
        return new AdminFailure(409, code, message, Map.of(field, message));
    }

    static AdminFailure duplicate(String field) {
        String message = "A reference value with this " + field + " already exists.";
        return new AdminFailure(
                409,
                "DUPLICATE_" + field.toUpperCase(java.util.Locale.ROOT),
                message,
                Map.of(field, message));
    }

    @RestControllerAdvice(basePackages = "am.polylink.admin")
    public static class Handler {
        @ExceptionHandler(AdminFailure.class)
        public ResponseEntity<?> handle(AdminFailure failure) {
            return ResponseEntity.status(failure.status)
                    .header("Cache-Control", "no-store")
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
