package am.polylink.posts;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.Test;

class PostsContentTests {
    @Test
    void preservesOnlyPostsFormattingAndNormalizesBlocks() {
        var clean =
                PostsContent.content(
                        "<div onclick='bad()'><b>Բարև 😀</b></div><p><i>yes</i><a href='https://example.org'>link</a><a href='javascript:bad()'>no</a><img src=x><script>bad()</script><u>text</u></p>");
        assertThat(clean)
                .contains("<p>", "<b>", "<i>", "noopener", "https://example.org")
                .doesNotContain("onclick", "javascript:", "<script", "<img", "<u>", "<div");
        assertThat(PostsContent.plain(clean)).contains("Բարև 😀\nyes");
        assertThat(PostsContent.sanitize("<script>bad()</script><p>legacy</p>"))
                .isEqualTo("<p>legacy</p>");
    }

    @Test
    void validatesVisibleUtf16LengthsAndPlainComments() {
        assertThat(PostsContent.content("<p>" + "&#65;".repeat(10000) + "😀".repeat(5000) + "</p>"))
                .isNotEmpty();
        assertThatThrownBy(() -> PostsContent.content("<p>" + "😀".repeat(10001) + "</p>"))
                .isInstanceOf(PostsFailure.class);
        assertThatThrownBy(() -> PostsContent.content("<p>&nbsp; <br></p>"))
                .isInstanceOf(PostsFailure.class);
        assertThatThrownBy(() -> PostsContent.content("<script>bad()</script>"))
                .isInstanceOf(PostsFailure.class);
        assertThatThrownBy(() -> PostsContent.title("😀".repeat(128)))
                .isInstanceOf(PostsFailure.class);
        assertThat(PostsContent.comment("<b>literal</b>\nline")).isEqualTo("<b>literal</b>\nline");
        assertThatThrownBy(() -> PostsContent.comment("a".repeat(2001)))
                .isInstanceOf(PostsFailure.class);
    }
}
