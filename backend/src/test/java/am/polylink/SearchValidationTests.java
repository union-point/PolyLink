package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import am.polylink.search.SearchService.Filters;
import org.junit.jupiter.api.Test;

class SearchValidationTests {
    @Test
    void rejectsInvalidBoundsAndTrimsQuery() {
        assertThat(new Filters("  Անի %_!  ", null, null, null, 50).q()).isEqualTo("Անի %_!");
        for (int limit : new int[] {0, -1, 101, Integer.MAX_VALUE})
            assertThatThrownBy(() -> new Filters("", null, null, null, limit))
                    .isInstanceOf(AuthFailure.class);
        for (int year : new int[] {0, -1, 9999})
            assertThatThrownBy(() -> new Filters("", null, null, year, 50))
                    .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> new Filters("x".repeat(101), null, null, null, 50))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> new Filters("", 0, null, null, 50))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> new Filters("", null, -1, null, 50))
                .isInstanceOf(AuthFailure.class);
    }
}
