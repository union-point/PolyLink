package am.polylink;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@org.springframework.scheduling.annotation.EnableScheduling
@SpringBootApplication
public class PolyLinkApplication {

    public static void main(String[] args) {
        SpringApplication.run(PolyLinkApplication.class, args);
    }
}
