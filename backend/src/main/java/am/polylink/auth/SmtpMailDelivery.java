package am.polylink.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
@IdentityEnabled
public class SmtpMailDelivery implements MailDelivery {
    private final JavaMailSender sender;
    private final String from;

    public SmtpMailDelivery(JavaMailSender sender, @Value("${polylink.mail.from}") String from) {
        this.sender = sender;
        this.from = from;
    }

    @Override
    public void sendCode(String email, String purpose, String code) {
        var mail = new SimpleMailMessage();
        mail.setFrom(from);
        mail.setTo(email);
        mail.setSubject("PolyLink verification code");
        mail.setText(
                "Your PolyLink "
                        + (purpose.equals("LOGIN") ? "sign-in" : "email verification")
                        + " code is "
                        + code
                        + ". It expires in 10 minutes. If you did not request it, ignore this email.");
        try {
            sender.send(mail);
        } catch (RuntimeException failure) {
            throw AuthFailure.unavailable();
        }
    }
}
