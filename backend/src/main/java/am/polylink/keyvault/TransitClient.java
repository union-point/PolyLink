package am.polylink.keyvault;

public interface TransitClient {
    record Wrapped(String ciphertext, String context) {}

    Wrapped wrap(int user, long version, byte[] key);
}
