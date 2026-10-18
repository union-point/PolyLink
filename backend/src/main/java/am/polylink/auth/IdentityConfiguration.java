package am.polylink.auth;

import java.time.Clock;
import org.springframework.context.annotation.*;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@org.springframework.scheduling.annotation.EnableScheduling
@Configuration(proxyBeanMethods = false)
@IdentityEnabled
public class IdentityConfiguration {
    @Bean
    Clock identityClock() {
        return Clock.systemUTC();
    }

    @Bean
    public PasswordEncoder loginSecretEncoder() {
        return new BoundedPasswordEncoder(new Argon2PasswordEncoder(16, 32, 1, 65536, 3), 2);
    }

    @Bean
    TransactionTemplate identityTransactions(PlatformTransactionManager manager) {
        return new TransactionTemplate(manager);
    }
}
