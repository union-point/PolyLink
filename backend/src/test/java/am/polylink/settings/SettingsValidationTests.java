package am.polylink.settings;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import java.util.*;
import org.junit.jupiter.api.Test;

class SettingsValidationTests {
    @Test
    void securityAndUnknownFieldsCannotBePatched() {
        for (var key :
                List.of("twoFactorEnabled", "email", "userId", "credentialVersion", "unknown"))
            assertThatThrownBy(() -> SettingsService.validate(Map.of(key, true)))
                    .isInstanceOf(AuthFailure.class);
    }

    @Test
    void booleanCoercionAndNullAreRejected() {
        for (var value : List.of("true", 1, List.of(true)))
            assertThatThrownBy(() -> SettingsService.validate(Map.of("showEmail", value)))
                    .isInstanceOf(AuthFailure.class);
        var nullValue = new HashMap<String, Object>();
        nullValue.put("showEmail", null);
        assertThatThrownBy(() -> SettingsService.validate(nullValue))
                .isInstanceOf(AuthFailure.class);
    }

    @Test
    void onlySupportedLanguageCodesAreAccepted() {
        for (var code : List.of("hy", "en", "ru"))
            assertThatCode(() -> SettingsService.validate(Map.of("language", code)))
                    .doesNotThrowAnyException();
        for (var code : List.of("HY", "fr", "", "en-US"))
            assertThatThrownBy(() -> SettingsService.validate(Map.of("language", code)))
                    .isInstanceOf(AuthFailure.class);
    }
}
