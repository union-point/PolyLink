package am.polylink.auth;

import static org.junit.jupiter.api.Assertions.*;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class EnrollmentAvatarTests {
    @Test
    void normalizesImageIntoBoundedSquareJpeg() throws Exception {
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(640, 320, BufferedImage.TYPE_INT_ARGB), "png", bytes);
        byte[] result =
                EnrollmentAvatarController.normalize(
                        Base64.getEncoder().encodeToString(bytes.toByteArray()));
        var image = ImageIO.read(new ByteArrayInputStream(result));
        assertEquals(256, image.getWidth());
        assertEquals(256, image.getHeight());
        assertFalse(image.getColorModel().hasAlpha());
        assertTrue(result.length <= 262144);
    }

    @Test
    void rejectsInvalidOversizedAndExcessiveDimensionImages() throws Exception {
        assertThrows(AuthFailure.class, () -> EnrollmentAvatarController.normalize("not-base64"));
        assertThrows(
                AuthFailure.class,
                () ->
                        EnrollmentAvatarController.normalize(
                                Base64.getEncoder().encodeToString(new byte[262145])));
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(1025, 1, BufferedImage.TYPE_INT_RGB), "png", bytes);
        assertThrows(
                AuthFailure.class,
                () ->
                        EnrollmentAvatarController.normalize(
                                Base64.getEncoder().encodeToString(bytes.toByteArray())));
    }
}
