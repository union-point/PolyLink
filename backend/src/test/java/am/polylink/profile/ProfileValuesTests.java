package am.polylink.profile;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import org.junit.jupiter.api.Test;

class ProfileValuesTests {
    @Test
    void comparesPeriodsWithoutInventingMonths() {
        ProfileValues.range(
                ProfileValues.period("2020", false), ProfileValues.period("2020-01", false), false);
        assertThatThrownBy(
                        () ->
                                ProfileValues.range(
                                        ProfileValues.period("2020-03", false),
                                        ProfileValues.period("2020-02", false),
                                        false))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileValues.period("2020-13", false))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileValues.period("1899", false))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileValues.url("https:relative"))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileValues.url("javascript:alert(1)"))
                .isInstanceOf(AuthFailure.class);
    }
}
