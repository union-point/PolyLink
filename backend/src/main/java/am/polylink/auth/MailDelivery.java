package am.polylink.auth;

public interface MailDelivery {
    void sendCode(String email, String purpose, String code);
}
