package am.polylink.auth;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Origin checks apply even to login/verification; cookie authentication also checks session-bound
 * CSRF.
 */
public final class IdentityBoundary extends OncePerRequestFilter {
    private final Set<String> origins;

    public IdentityBoundary(Set<String> origins) {
        this.origins = origins;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (!Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())
                && (request.getHeader("Origin") == null
                        || !origins.contains(request.getHeader("Origin")))) {
            response.setStatus(403);
            response.setContentType("application/json");
            response.getWriter()
                    .write(
                            "{\"code\":\"FORBIDDEN\",\"message\":\"Request origin is not allowed.\"}");
            return;
        }
        long limit =
                "POST".equals(request.getMethod())
                                && request.getRequestURI()
                                        .matches("/chat/rooms/[0-9a-f-]{36}/attachments")
                        ? 5_242_896
                        : 2_100_000;
        if (request.getContentLengthLong() > limit) {
            response.setStatus(413);
            return;
        }
        var limited =
                new HttpServletRequestWrapper(request) {
                    @Override
                    public ServletInputStream getInputStream() throws IOException {
                        var source = request.getInputStream();
                        return new ServletInputStream() {
                            private long count;

                            private void count(int size) throws IOException {
                                if (size > 0 && (count += size) > limit)
                                    throw new IOException("Request size limit exceeded");
                            }

                            @Override
                            public int read() throws IOException {
                                int value = source.read();
                                count(value < 0 ? 0 : 1);
                                return value;
                            }

                            @Override
                            public int read(byte[] bytes, int offset, int length)
                                    throws IOException {
                                int size = source.read(bytes, offset, length);
                                count(size);
                                return size;
                            }

                            @Override
                            public boolean isFinished() {
                                return source.isFinished();
                            }

                            @Override
                            public boolean isReady() {
                                return source.isReady();
                            }

                            @Override
                            public void setReadListener(jakarta.servlet.ReadListener listener) {
                                source.setReadListener(listener);
                            }
                        };
                    }
                };
        chain.doFilter(limited, response);
    }
}
