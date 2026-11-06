package am.polylink.profile;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class ProfileImagesTests {
    static byte[] png(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    @Test
    void normalizesAndBoundsBeforeDecoding() throws Exception {
        var avatar =
                ImageIO.read(
                        new ByteArrayInputStream(
                                ProfileImages.normalize(png(700, 400), true, false)));
        assertThat(avatar.getWidth()).isEqualTo(256);
        assertThat(avatar.getHeight()).isEqualTo(256);
        var cover =
                ImageIO.read(
                        new ByteArrayInputStream(
                                ProfileImages.normalize(png(2400, 1200), false, false)));
        assertThat(cover.getWidth()).isEqualTo(1920);
        assertThat(cover.getHeight()).isEqualTo(960);
        assertThatThrownBy(
                        () -> ProfileImages.normalize(new byte[5 * 1024 * 1024 + 1], true, false))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileImages.normalize(png(4097, 1), false, false))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileImages.normalize(new byte[] {1, 2, 3}, true, false))
                .isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> ProfileImages.normalize(png(1025, 1), true, true))
                .isInstanceOf(AuthFailure.class);
    }
}
