package am.polylink.auth;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.text.Normalizer;
import java.util.Locale;

/** V25 identity contract. Change normalization only with an explicit forward data migration. */
public final class RegistryKeys {
    private RegistryKeys() {}

    public static String text(String input) {
        if (input == null) return "";
        return Normalizer.normalize(input, Normalizer.Form.NFKC)
                .replaceAll("[\\p{Z}\\s]+", " ")
                .strip()
                .toLowerCase(Locale.ROOT);
    }

    public static String email(String input) {
        return input.strip().toLowerCase(Locale.ROOT);
    }

    public static byte[] lecturer(String input) {
        return source(email(input));
    }

    public static byte[] diploma(String input) {
        return source(text(input));
    }

    /** UTF-16LE matches SQL Server HASHBYTES over the exact nvarchar display value. */
    public static byte[] source(String input) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(StandardCharsets.UTF_16LE));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
