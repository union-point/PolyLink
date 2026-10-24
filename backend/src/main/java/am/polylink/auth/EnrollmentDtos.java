package am.polylink.auth;

import jakarta.validation.constraints.*;

public final class EnrollmentDtos {
    private EnrollmentDtos() {}

    public record Password(
            @NotNull @jakarta.validation.Valid AuthDtos.Derivation derivation,
            @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String loginSecret) {
        @Override
        public String toString() {
            return "EnrollmentPassword[redacted]";
        }
    }

    public record Revision(@Positive long revision) {}

    public record Profile(
            @Positive long revision,
            @NotNull @Pattern(regexp = "graduate|lecturer") String role,
            @NotBlank @Size(max = 100) String firstName,
            @NotBlank @Size(max = 100) String lastName,
            @Size(max = 100) String diplomaNumber,
            @Positive Integer specializationId,
            @Min(1900) @Max(2200) Integer startYear,
            @Min(1900) @Max(2200) Integer endYear,
            @Positive Integer departmentId,
            @Positive Integer professionId,
            @Size(max = 2000) String biography) {
        @Override
        public String toString() {
            return "EnrollmentProfile[redacted]";
        }
    }
}
