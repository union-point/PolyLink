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
            @Value("${polylink.forum.enabled:false}") boolean forum,
            @Value("${polylink.posts.enabled:false}") boolean posts,
            @Value("${polylink.frontend-origins:http://localhost:8001}") String allowedOrigins)
            throws Exception {
        var origins = Set.copyOf(Arrays.asList(allowedOrigins.split(",")));
        if (enabled) {
            var cors = new CorsConfiguration();
            cors.setAllowedOrigins(List.copyOf(origins));
            cors.setAllowCredentials(true);
            cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
            cors.setAllowedHeaders(
                    List.of(
                            "Content-Type",
                            "Authorization",
                            "X-CSRF-Token",
                            "X-Attachment-Id",
                            "X-Export-Grant"));
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
                                        "/auth/recovery/request",
                                        "/auth/recovery/verify",
                                        "/auth/recovery/unlock",
                                        "/auth/recovery/prepare",
                                        "/auth/recovery/commit",
                                        "/auth/recovery/login",
                                        "/auth/parameters",
                                        "/auth/register",
                                        "/auth/enrollment/submit",
                                        "/auth/enrollment/logout",
                                        "/auth/email/verify",
                                        "/auth/login",
                                        "/auth/login/verify",
                                        "/auth/challenges/resend",
                                        "/auth/refresh",
                                        "/auth/logout",
                                        "/account/deactivate",
                                        "/account/delete",
                                        "/auth/password-change/prepare",
                                        "/auth/password-change/commit",
                                        "/keys/setup/prepare",
                                        "/keys/setup/commit")
                                .permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.GET,
                                        "/auth/recovery/status",
                                        "/auth/me",
                                        "/auth/enrollment",
                                        "/auth/enrollment/options",
                                        "/auth/avatars/*",
                                        "/keys/me",
                                        "/users/*")
                                .permitAll();
                    }
                    if (enabled)
                        authorize
                                .requestMatchers(
                                        HttpMethod.PUT,
                                        "/auth/enrollment/profile",
                                        "/auth/enrollment/password",
                                        "/auth/enrollment/avatar")
                                .permitAll();
                    if (enabled)
                        authorize
                                .requestMatchers(HttpMethod.DELETE, "/auth/enrollment/avatar")
                                .permitAll();
                    if (enabled && messenger) {
                        authorize
                                .requestMatchers(
                                        HttpMethod.GET,
                                        "/chat/rooms",
                                        "/chat/export",
                                        "/chat/rooms/*/messages",
                                        "/chat/rooms/*/keys",
                                        "/chat/rooms/*/participants",
                                        "/chat/attachments/*")
                                .permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/chat/direct",
                                        "/chat/groups",
                                        "/chat/groups/prepare",
                                        "/chat/rooms/*/participants",
                                        "/chat/rooms/*/participants/prepare",
                                        "/chat/rooms/*/leave",
                                        "/chat/rooms/*/messages",
                                        "/chat/rooms/*/keys/activate",
                                        "/chat/rooms/*/hide",
                                        "/chat/rooms/*/attachments")
                                .permitAll();
                    }
                    if (enabled && messenger)
                        authorize
                                .requestMatchers(
                                        HttpMethod.PUT,
                                        "/chat/rooms/*/read",
                                        "/chat/rooms/*/owner",
                                        "/chat/rooms/*/mute",
                                        "/chat/blocks/*")
                                .permitAll();
                    if (enabled)
                        authorize
                                .requestMatchers(
                                        HttpMethod.GET,
                                        "/search",
                                        "/search/people",
                                        "/search/filters")
                                .permitAll();
                    if (enabled && messenger) {
                        authorize.requestMatchers(HttpMethod.PATCH, "/chat/rooms/*").permitAll();
                        authorize
                                .requestMatchers(HttpMethod.DELETE, "/chat/rooms/*/participants/*")
                                .permitAll();
                    }
                    if (enabled) {
                        authorize
                                .requestMatchers(
                                        HttpMethod.GET,
                                        "/settings",
                                        "/notifications",
                                        "/notifications/history",
                                        "/account/export/data",
                                        "/account/export/messages",
                                        "/account/export/files/*")
                                .permitAll();
                        authorize.requestMatchers(HttpMethod.PATCH, "/settings").permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.POST,
                                        "/account/export/authorize",
                                        "/account/email-change/start",
                                        "/account/email-change/verify",
                                        "/account/email-change/resend")
                                .permitAll();
                        authorize
                                .requestMatchers(HttpMethod.PUT, "/account/email-factor")
                                .permitAll();
                    }
                    if (enabled && posts)
                        authorize.requestMatchers("/posts", "/posts/**").permitAll();
                    if (enabled && forum) {
                        authorize
                                .requestMatchers(
                                        HttpMethod.GET,
                                        "/forum/categories",
                                        "/forum/topics",
                                        "/forum/topics/*",
                                        "/forum/topics/*/replies",
                                        "/forum/replies/*")
                                .permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.POST, "/forum/topics", "/forum/topics/*/replies")
                                .permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.PATCH, "/forum/topics/*", "/forum/replies/*")
                                .permitAll();
                        authorize
                                .requestMatchers(
                                        HttpMethod.DELETE, "/forum/topics/*", "/forum/replies/*")
                                .permitAll();
                        authorize
                                .requestMatchers(HttpMethod.PUT, "/forum/replies/*/like")
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
