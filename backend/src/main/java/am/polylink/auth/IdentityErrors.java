package am.polylink.auth;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
@IdentityEnabled
public class IdentityErrors {
    @ExceptionHandler(AuthFailure.class)
    public ResponseEntity<?> auth(AuthFailure failure) {
        var response = ResponseEntity.status(failure.status).header("Cache-Control", "no-store");
        if (failure.status == 429) response.header("Retry-After", "60");
        if (failure.status == 503) response.header("Retry-After", "3");
        return response.body(Map.of("code", failure.code, "message", failure.getMessage()));
    }

    @ExceptionHandler({
        org.springframework.web.bind.MethodArgumentNotValidException.class,
        org.springframework.http.converter.HttpMessageNotReadableException.class,
        org.springframework.web.method.annotation.HandlerMethodValidationException.class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
    })
    public ResponseEntity<?> invalid(Exception ignored) {
        return auth(AuthFailure.invalid());
    }

    @ExceptionHandler(org.springframework.dao.DataAccessException.class)
    public ResponseEntity<?> database(Exception ignored) {
        return auth(AuthFailure.unavailable());
    }
}
