package am.polylink.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {}

    public record EmailRequest(@NotBlank @Email @Size(max = 255) String email) {}

    public record Derivation(
            @Pattern(regexp = "PLK1") @NotNull String scheme,
            @Pattern(regexp = "[A-Za-z0-9_-]{22}") @NotNull String salt,
            @Min(2) @Max(4) int opsLimit,
            @Min(67108864) @Max(268435456) long memoryBytes) {}

    public record Login(
            @NotBlank @Email @Size(max = 255) String email,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret,
            @NotNull @Pattern(regexp = "PLK1") String scheme) {
        @Override
        public String toString() {
            return "Login[redacted]";
        }
    }

    public record Registration(
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(max = 100) String firstName,
            @NotBlank @Size(max = 100) String lastName,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret,
            @NotNull @Valid Derivation derivation,
            @NotNull @Pattern(regexp = "graduate|lecturer") String role) {
        @Override
        public String toString() {
            return "Registration[redacted]";
        }
    }

    public record CodeProof(
            @NotNull UUID challengeId, @NotNull @Pattern(regexp = "[0-9]{6}") String code) {
        @Override
        public String toString() {
            return "CodeProof[redacted]";
        }
    }

    public record ChallengeId(@NotNull UUID challengeId) {}

    public record OperationId(@NotNull UUID operationId) {}

    public record Versions(
            @NotNull @Pattern(regexp = "[0-9]{1,19}") String credential,
            @NotNull @Pattern(regexp = "[0-9]{1,19}") String vaultKey,
            @NotNull @Pattern(regexp = "[0-9]{1,19}") String vaultRevision,
            @NotNull @Pattern(regexp = "[0-9]{1,19}") String identity) {}

    public record Packet(
            @NotNull @Pattern(regexp = "PLK1") String scheme,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{32}") String nonce,
            @NotNull @Size(min = 22, max = 1398123) @Pattern(regexp = "[A-Za-z0-9_-]+")
                    String ciphertext) {}

    public record Identity(
            @NotNull @Pattern(regexp = "[1-9][0-9]{0,9}") String userId,
            @NotNull @Pattern(regexp = "[1-9][0-9]{0,18}") String version,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String publicKey) {}

    public record Setup(
            @NotNull @Pattern(regexp = "SETUP") String kind,
            @NotNull UUID operationId,
            @NotNull @Valid Versions expected,
            @NotNull @Valid Derivation derivation,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret,
            @NotNull @Valid Packet vault,
            @NotNull @Valid Packet passwordCopy,
            @NotNull @Valid Identity identity,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String serviceVaultKey) {
        @Override
        public String toString() {
            return "Setup[redacted]";
        }
    }

    public record Recovery(
            @NotNull @Pattern(regexp = "RECOVERY_LOCAL|RECOVERY_SERVICE") String kind,
            @NotNull UUID operationId,
            @NotNull @Valid Versions expected,
            @NotNull @Valid Derivation derivation,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret,
            @NotNull @Valid Packet vault,
            @NotNull @Valid Packet passwordCopy,
            @NotNull @Valid Identity identity,
            @Pattern(regexp = "[A-Za-z0-9_-]{43}") String serviceVaultKey) {
        @Override
        public String toString() {
            return "Recovery[redacted]";
        }
    }

    public record PasswordChange(
            @NotNull @Pattern(regexp = "PASSWORD_CHANGE") String kind,
            @NotNull UUID operationId,
            @NotNull @Valid Versions expected,
            @NotNull @Valid Derivation derivation,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret,
            @NotNull @Valid Packet vault,
            @NotNull @Valid Packet passwordCopy,
            @NotNull @Valid Identity identity) {
        @Override
        public String toString() {
            return "PasswordChange[redacted]";
        }
    }
}
