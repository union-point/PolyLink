package am.polylink.auth;

/** Shared matching contract: NFKC, Unicode whitespace collapse, ROOT lowercase, no fuzzy match. */
public final class EnrollmentRules {
    private EnrollmentRules() {}

    public static String text(String input) {
        return RegistryKeys.text(input);
    }

    public static String universityEmail(String input) {
        String email = Accounts.email(input);
        if (!email.matches("[^@\\s]+@polytechnic\\.am") || email.length() > 255)
            throw new AuthFailure(400, "VALIDATION", "Use your polytechnic.am email address.");
        return email;
    }
}
