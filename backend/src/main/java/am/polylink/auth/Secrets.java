package am.polylink.auth;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
@IdentityEnabled
public final class Secrets {
    private final SecureRandom random = new SecureRandom();
    private final byte[] macKey;
    private final byte[] replayKey;

    public Secrets(
            @Value("${polylink.auth.hmac-key:}") String macKey,
            @Value("${polylink.auth.replay-key:}") String replayKey) {
        this.macKey = decode(macKey, 32);
        this.replayKey = decode(replayKey, 32);
    }

    public byte[] random(int size) {
        byte[] value = new byte[size];
        random.nextBytes(value);
        return value;
    }

    public String token() {
        return encode(random(32));
    }

    public String code() {
        return "%06d".formatted(random.nextInt(1_000_000));
    }

    public byte[] mac(String purpose, String value) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(macKey, "HmacSHA256"));
            return mac.doFinal((purpose + "\u0000" + value).getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC unavailable");
        }
    }

    public static byte[] hash(String value) {
        return digest(value.getBytes(StandardCharsets.UTF_8));
    }

    public static byte[] digest(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }

    public static boolean equal(byte[] a, byte[] b) {
        return a != null && b != null && MessageDigest.isEqual(a, b);
    }

    public static String encode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static byte[] decode(String value, int length) {
        try {
            var bytes = Base64.getUrlDecoder().decode(value);
            if (bytes.length != length || !encode(bytes).equals(value)) throw AuthFailure.invalid();
            return bytes;
        } catch (IllegalArgumentException | NullPointerException e) {
            throw AuthFailure.invalid();
        }
    }

    public byte[] encryptReplay(byte[] plaintext) {
        try {
            byte[] iv = random(12);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(replayKey, "AES"),
                    new GCMParameterSpec(128, iv));
            cipher.updateAAD("PLK1/session-replay".getBytes(StandardCharsets.US_ASCII));
            byte[] encrypted = cipher.doFinal(plaintext);
            return ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array();
        } catch (GeneralSecurityException e) {
            throw AuthFailure.unavailable();
        }
    }

    public byte[] decryptReplay(byte[] packet) {
        try {
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(replayKey, "AES"),
                    new GCMParameterSpec(128, Arrays.copyOfRange(packet, 0, 12)));
            cipher.updateAAD("PLK1/session-replay".getBytes(StandardCharsets.US_ASCII));
            return cipher.doFinal(Arrays.copyOfRange(packet, 12, packet.length));
        } catch (GeneralSecurityException | RuntimeException e) {
            throw AuthFailure.denied();
        }
    }
}
