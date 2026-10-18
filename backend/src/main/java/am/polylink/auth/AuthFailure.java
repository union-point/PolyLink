package am.polylink.auth;

public final class AuthFailure extends RuntimeException {
    public final int status;
    public final String code;

    public AuthFailure(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static AuthFailure denied() {
        return new AuthFailure(401, "UNAUTHORIZED", "Authentication could not be completed.");
    }

    public static AuthFailure invalid() {
        return new AuthFailure(400, "VALIDATION", "The request is invalid.");
    }

    public static AuthFailure unavailable() {
        return new AuthFailure(
                503,
                "SERVICE_UNAVAILABLE",
                "The service is temporarily unavailable. Please retry.");
    }

    public static AuthFailure conflict() {
        return new AuthFailure(
                409, "REVISION_CONFLICT", "Account state changed. Please sign in again.");
    }
}
