package am.polylink.config;

import am.polylink.auth.IdentityBoundary;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            @Value("${polylink.identity.enabled:false}") boolean enabled,
            @Value("${polylink.messenger.enabled:false}") boolean messenger,
            @Value("${polylink.frontend-origins:http://localhost:8001}") String allowedOrigins)
            throws Exception {
        var origins = Set.copyOf(Arrays.asList(allowedOrigins.split(",")));
        if (enabled) {
            var cors = new CorsConfiguration();
            cors.setAllowedOrigins(List.copyOf(origins));
            cors.setAllowCredentials(true);
            cors.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
            cors.setAllowedHeaders(List.of("Content-Type", "Authorization", "X-CSRF-Token"));
            cors.setMaxAge(600L);
            var source = new UrlBasedCorsConfigurationSource();
            source.registerCorsConfiguration("/**", cors);
            http.cors(c -> c.configurationSource(source))
                    .csrf(AbstractHttpConfigurer::disable)
                    .addFilterBefore(new IdentityBoundary(origins), AuthorizationFilter.class);
        }
        http.authorizeHttpRequests(
                authorize -> {
                    authorize.requestMatchers("/actuator/health").permitAll();
                    if (enabled) {
                        authorize
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/auth/parameters",
                                        "/auth/register",
                                        "/auth/email/verify",
                                        "/auth/login",
                                        "/auth/login/verify",
                                        "/auth/challenges/resend",
                                        "/auth/refresh",
                                        "/auth/logout",
                                        "/keys/setup/prepare",
                                        "/keys/setup/commit")
                                .permitAll();
                        authorize
                                .requestMatchers(HttpMethod.GET, "/auth/me", "/keys/me", "/users/*")
                                .permitAll();
                    }
                    if (enabled && messenger) {
                        authorize
                                .requestMatchers(
                                        HttpMethod.GET,
                                        "/chat/rooms",
                                        "/chat/rooms/*/messages",
                                        "/chat/rooms/*/keys")
                                .permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/chat/direct",
                                        "/chat/rooms/*/messages",
                                        "/chat/rooms/*/keys/activate")
                                .permitAll();
                    }
                    authorize.anyRequest().denyAll();
                });
        return http.formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .sessionManagement(
                        s ->
                                s.sessionCreationPolicy(
                                        org.springframework.security.config.http
                                                .SessionCreationPolicy.STATELESS))
                .build();
    }

    @Bean
    InMemoryUserDetailsManager userDetailsService() {
        // Never create a generated or demo development account.
        return new InMemoryUserDetailsManager();
    }
}
