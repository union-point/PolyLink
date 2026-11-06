package am.polylink.admin;

import java.lang.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
@ConditionalOnProperty(
        name = {"polylink.identity.enabled", "polylink.admin.enabled"},
        havingValue = "true")
public @interface AdminEnabled {}
