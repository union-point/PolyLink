package am.polylink.auth;

import java.text.Normalizer;
import java.util.Locale;

/** Shared matching contract: NFKC, Unicode whitespace collapse, ROOT lowercase, no fuzzy match. */
public final class EnrollmentRules {
    private EnrollmentRules() {}

    public static String text(String input) {
        if (input == null) return "";
        return Normalizer.normalize(input, Normalizer.Form.NFKC)
                .replaceAll("[\\p{Z}\\s]+", " ")
                .strip()
                .toLowerCase(Locale.ROOT);
    }

    public static String universityEmail(String input) {
        String email = Accounts.email(input);
        if (!email.matches("[^@\\s]+@polytechnic\\.am") || email.length() > 255)
            throw new AuthFailure(400, "VALIDATION", "Use your polytechnic.am email address.");
        return email;
    }
}
