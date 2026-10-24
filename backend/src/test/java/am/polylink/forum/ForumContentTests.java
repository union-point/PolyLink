package am.polylink.forum;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.Test;

class ForumContentTests {
    @Test
    void sanitizesExecutableHtmlWhilePreservingFormattingAndUnicode() {
        String html =
                ForumContent.content(
                        "<p onclick='bad()'><b>Բարև 😀</b><a href='javascript:alert(1)'>bad</a><a href='https://example.org' target='_blank'>safe</a><img src=x onerror=bad()><script>alert(1)</script></p>");
        assertThat(html)
                .contains("<b>Բարև &#x1f600;</b>", "https://example.org", "noopener")
                .doesNotContain("onclick", "javascript:", "<script", "<img", "target=");
        assertThat(ForumContent.plain(html)).contains("Բարև 😀", "safe");
    }

    @Test
    void validatesDecodedVisibleLengthAndRejectsBlankOrOversizeMarkup() {
        assertThat(ForumContent.content("<p>" + "&#65;".repeat(10000) + "A".repeat(10000) + "</p>"))
                .isNotEmpty();
        assertThatThrownBy(() -> ForumContent.content("<p>" + "😀".repeat(10001) + "</p>"))
                .isInstanceOf(ForumFailure.class);
        assertThatThrownBy(() -> ForumContent.content("<p>&nbsp; <br></p>"))
                .isInstanceOf(ForumFailure.class);
        assertThatThrownBy(() -> ForumContent.content("<script>alert(1)</script>"))
                .isInstanceOf(ForumFailure.class);
        assertThatThrownBy(() -> ForumContent.content(" ".repeat(100001)))
                .isInstanceOf(ForumFailure.class);
        assertThatThrownBy(() -> ForumContent.title("😀".repeat(128)))
                .isInstanceOf(ForumFailure.class);
    }
}
