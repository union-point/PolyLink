package am.polylink.posts;

import java.util.List;
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
                    .matching(
                            (element, attribute, value) ->
                                    value.matches("(?is)^(https?://|mailto:).+") ? value : null)
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
        var text = new StringBuilder();
        HtmlSanitizer.sanitize(
                html,
                POLICY.apply(
                        new HtmlStreamEventReceiver() {
                            public void openDocument() {}

                            public void closeDocument() {}

                            public void openTag(String name, List<String> attributes) {
                                if (name.equals("br")) text.append('\n');
                            }

                            public void closeTag(String name) {
                                if (name.equals("p")) text.append('\n');
                            }

                            public void text(String value) {
                                text.append(value);
                            }
                        }));
        return trim(text.toString().replace('\u00a0', ' '));
    }

    public static String trim(String value) {
        return value.replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$", "");
    }

    public static String title(Object value) {
        return text(value, "title", 255);
    }

    public static String comment(Object value) {
        return text(value, "text", 2000);
    }

    private static String text(Object value, String field, int limit) {
        if (!(value instanceof String s) || trim(s).isEmpty() || trim(s).length() > limit)
            throw PostsFailure.invalid(field, "Լրացրեք դաշտը՝ առավելագույնը " + limit + " նիշ։");
        return trim(s);
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
