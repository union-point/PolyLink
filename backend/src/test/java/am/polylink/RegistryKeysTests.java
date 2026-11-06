package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.*;
import org.junit.jupiter.api.Test;

class RegistryKeysTests {
    @Test
    void keysUseAdmissionNormalizationAndPreserveUnicodeDistinctions() {
        assertThat(RegistryKeys.lecturer(" Owner@Example.org "))
                .isEqualTo(RegistryKeys.lecturer("owner@example.org"));
        assertThat(RegistryKeys.diploma("ＡＢＣ\u00a0 １２３"))
                .isEqualTo(RegistryKeys.diploma("abc 123"));
        assertThat(RegistryKeys.diploma("e\u0301")).isEqualTo(RegistryKeys.diploma("é"));
        assertThat(RegistryKeys.diploma("é")).isNotEqualTo(RegistryKeys.diploma("e"));
        assertThat(RegistryKeys.diploma("ß")).isNotEqualTo(RegistryKeys.diploma("ss"));
        assertThat(RegistryKeys.diploma("ﷺ".repeat(100))).hasSize(32);
        assertThat(RegistryKeys.source(" Raw ")).isNotEqualTo(RegistryKeys.source("raw"));
    }
}
