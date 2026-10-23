package am.polylink.auth;

public interface MailDelivery {
    default void sendNotice(String email, String subject, String body) {
        throw AuthFailure.unavailable();
    }

    void sendCode(String email, String purpose, String code);
}
