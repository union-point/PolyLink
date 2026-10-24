package am.polylink.forum;

import java.io.*;
import javax.swing.text.html.*;
import javax.swing.text.html.parser.ParserDelegator;
import org.owasp.html.*;

public final class ForumContent {
    private static final PolicyFactory POLICY =
            new HtmlPolicyBuilder()
                    .allowElements(
                            "p",
                            "br",
                            "b",
                            "strong",
                            "i",
                            "em",
                            "u",
                            "ul",
                            "ol",
                            "li",
                            "a",
                            "div",
                            "h2",
                            "h3",
                            "blockquote")
                    .allowWithoutAttributes("a")
                    .allowUrlProtocols("http", "https", "mailto")
                    .allowAttributes("href")
                    .onElements("a")
                    .requireRelsOnLinks("noopener", "noreferrer")
                    .toFactory();

    private ForumContent() {}

    public static String sanitize(String html) {
        return POLICY.sanitize(html);
    }

    public static String content(Object value) {
        if (!(value instanceof String html) || html.length() > 100000)
            throw ForumFailure.invalid("content", "Բովանդակությունը չափազանց երկար է։");
        String clean = sanitize(html);
        String text = plain(clean).replace('\u00a0', ' ').strip();
        if (text.isBlank() || text.length() > 20000)
            throw ForumFailure.invalid("content", "Բովանդակությունը պետք է պարունակի 1–20000 նիշ։");
        return clean;
    }

    public static String title(Object value) {
        if (!(value instanceof String text)
                || text.strip().isEmpty()
                || text.strip().length() > 255)
            throw ForumFailure.invalid("title", "Վերնագիրը պետք է պարունակի 1–255 նիշ։");
        return text.strip();
    }

    public static String plain(String html) {
        var text = new StringBuilder();
        try {
            new ParserDelegator()
                    .parse(
                            new StringReader(html),
                            new HTMLEditorKit.ParserCallback() {
                                @Override
                                public void handleText(char[] data, int position) {
                                    text.append(data);
                                }

                                @Override
                                public void handleSimpleTag(
                                        HTML.Tag tag,
                                        javax.swing.text.MutableAttributeSet attrs,
                                        int pos) {
                                    if (tag == HTML.Tag.BR) text.append('\n');
                                }

                                @Override
                                public void handleEndTag(HTML.Tag tag, int pos) {
                                    if (tag.isBlock()) text.append('\n');
                                }
                            },
                            true);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return text.toString().strip();
    }
}
