package am.polylink.keyvault;

public interface TransitClient {
    record Wrapped(String ciphertext, String context) {}

    byte[] unwrap(int user, long version, String ciphertext, String context);

    Wrapped wrap(int user, long version, byte[] key);
}
