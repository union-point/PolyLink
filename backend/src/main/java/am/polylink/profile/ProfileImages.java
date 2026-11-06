package am.polylink.profile;

import am.polylink.auth.AuthFailure;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;

/** Bounded JPEG/PNG decoding; callers authenticate before invoking this processor. */
public final class ProfileImages {
    private ProfileImages() {}

    public static byte[] normalize(byte[] bytes, boolean avatar, boolean enrollment) {
        if (bytes.length == 0 || bytes.length > (enrollment ? 262144 : 5 * 1024 * 1024))
            throw AuthFailure.invalid();
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw AuthFailure.invalid();
            var reader = readers.next();
            try {
                reader.setInput(stream);
                String format = reader.getFormatName().toUpperCase(Locale.ROOT);
                int w = reader.getWidth(0), h = reader.getHeight(0), max = enrollment ? 1024 : 4096;
                if (!Set.of("JPEG", "PNG").contains(format)
                        || w < 1
                        || h < 1
                        || w > max
                        || h > max
                        || (long) w * h > 16_000_000) throw AuthFailure.invalid();
                var source = reader.read(0);
                double scale = Math.min(1, Math.min(1920.0 / w, 1080.0 / h));
                int width = avatar ? 256 : Math.max(1, (int) (w * scale)),
                        height = avatar ? 256 : Math.max(1, (int) (h * scale));
                var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
                var g = image.createGraphics();
                try {
                    g.setColor(java.awt.Color.WHITE);
                    g.fillRect(0, 0, width, height);
                    g.setRenderingHint(
                            java.awt.RenderingHints.KEY_INTERPOLATION,
                            java.awt.RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                    int side = Math.min(w, h), x = (w - side) / 2, y = (h - side) / 2;
                    if (avatar)
                        g.drawImage(source, 0, 0, width, height, x, y, x + side, y + side, null);
                    else g.drawImage(source, 0, 0, width, height, null);
                } finally {
                    g.dispose();
                }
                var output = new ByteArrayOutputStream();
                ImageIO.write(image, "jpeg", output);
                return output.toByteArray();
            } finally {
                reader.dispose();
            }
        } catch (IOException | IllegalArgumentException e) {
            throw AuthFailure.invalid();
        }
    }
}
