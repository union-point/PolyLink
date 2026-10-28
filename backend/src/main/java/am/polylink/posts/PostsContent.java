package am.polylink.posts;

import am.polylink.forum.ForumContent;
import org.owasp.html.*;

/**
 * Posts have a narrower policy than forum content. Lengths count UTF-16 units, as HTML inputs do.
 */
public final class PostsContent {
    private static final PolicyFactory POLICY =
            new HtmlPolicyBuilder()
                    .allowElements("p", "br", "b", "strong", "i", "em", "a")
                    .allowWithoutAttributes("a")
                    .allowUrlProtocols("http", "https", "mailto")
                    .allowAttributes("href")
                    .onElements("a")
                    .requireRelsOnLinks("noopener", "noreferrer")
                    .toFactory();

    private PostsContent() {}

    public static String sanitize(String html) {
        // Normalize contenteditable block wrappers before sanitizing their attributes.
        return POLICY.sanitize(
                (html == null ? "" : html)
                        .replaceAll("(?i)<div(?=[\\s>])", "<p")
                        .replaceAll("(?i)</div\\s*>", "</p>"));
    }

    public static String plain(String html) {
        return ForumContent.plain(html).replace('\u00a0', ' ').strip();
    }

    public static String title(Object value) {
        return text(value, "title", 255);
    }

    public static String comment(Object value) {
        return text(value, "text", 2000);
    }

    private static String text(Object value, String field, int limit) {
        if (!(value instanceof String s)
                || s.replace('\u00a0', ' ').strip().isEmpty()
                || s.strip().length() > limit)
            throw PostsFailure.invalid(field, "Լրացրեք դաշտը՝ առավելագույնը " + limit + " նիշ։");
        return s.strip();
    }

    public static String content(Object value) {
        if (!(value instanceof String html) || html.length() > 100000)
            throw PostsFailure.invalid("content", "Բովանդակությունը չափազանց երկար է։");
        String clean = sanitize(html), text = plain(clean);
        if (text.isEmpty() || text.length() > 20000)
            throw PostsFailure.invalid("content", "Բովանդակությունը պետք է պարունակի 1–20000 նիշ։");
        return clean;
    }
}
