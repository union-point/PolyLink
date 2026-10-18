package am.polylink.auth;

import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Bound concurrent memory-hard verification work instead of queuing arbitrary requests. */
public final class BoundedPasswordEncoder implements PasswordEncoder {
    private final PasswordEncoder delegate;
    private final Semaphore permits;

    public BoundedPasswordEncoder(PasswordEncoder delegate, int parallelism) {
        this.delegate = delegate;
        this.permits = new Semaphore(parallelism);
    }

    @Override
    public String encode(CharSequence input) {
        return bounded(() -> delegate.encode(input));
    }

    @Override
    public boolean matches(CharSequence input, String verifier) {
        return bounded(() -> delegate.matches(input, verifier));
    }

    private <T> T bounded(Supplier<T> work) {
        if (!permits.tryAcquire()) throw AuthFailure.unavailable();
        try {
            return work.get();
        } finally {
            permits.release();
        }
    }
}
