package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import org.junit.jupiter.api.Test;

class EnrollmentRulesTests {
    @Test
    void permitsOnlyTheExactNormalizedUniversityDomain() {
        assertThat(EnrollmentRules.universityEmail("  Person@POLYTECHNIC.AM "))
                .isEqualTo("person@polytechnic.am");
        for (String address :
                new String[] {
                    "a@sub.polytechnic.am",
                    "a@polytechnic.am.evil",
                    "a@evilpolytechnic.am",
                    "a@@polytechnic.am",
                    "a b@polytechnic.am",
                    "a@polytechnic․am"
                })
            assertThatThrownBy(() -> EnrollmentRules.universityEmail(address))
                    .isInstanceOf(AuthFailure.class);
    }

    @Test
    void normalizesUnicodeAndWhitespaceWithoutFuzzyMatching() {
        assertThat(EnrollmentRules.text("  ԱՐԱՄ\u00a0  ՍԱՐԳՍՅԱՆ ")).isEqualTo("արամ սարգսյան");
        assertThat(EnrollmentRules.text("ＡＢＣ  e\u0301")).isEqualTo("abc é");
        assertThat(EnrollmentRules.text("Ara")).isNotEqualTo(EnrollmentRules.text("Aram"));
        assertThat(EnrollmentRules.text("é")).isNotEqualTo(EnrollmentRules.text("e"));
    }
}
