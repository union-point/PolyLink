package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.admin.AdminCommand;
import org.junit.jupiter.api.Test;

class AdminCommandTests {
    @Test
    void emailsAllowNonUniversityDomainsAndNormalizeWithoutDomainBypass() {
        assertThat(AdminCommand.email(" Owner@Example.org ")).isEqualTo("owner@example.org");
        for (String bad : new String[] {"", "user", "a@@b.org", "a@b..org", "a b@b.org", "a@.org"})
            assertThatThrownBy(() -> AdminCommand.email(bad))
                    .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void invitationLinkDestinationRequiresHttpsOrLoopbackAndNoEmbeddedSecrets() {
        assertThat(AdminCommand.registrationUrl("https://example.org/admin-register.html"))
                .contains("admin-register");
        assertThat(AdminCommand.registrationUrl("http://localhost:8001/admin-register.html"))
                .startsWith("http:");
        for (String bad :
                new String[] {
                    "http://example.org/admin-register.html",
                    "https://user:pass@example.org/a",
                    "https://example.org/a?token=secret",
                    "https://example.org/a#secret",
                    "javascript:alert(1)"
                })
            assertThatThrownBy(() -> AdminCommand.registrationUrl(bad))
                    .isInstanceOf(IllegalArgumentException.class);
    }
}
