package am.polylink.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@IdentityEnabled
public class EnrollmentAvatarController {
    private final JdbcTemplate db;
    private final EnrollmentSessions sessions;
    private final TransactionTemplate tx;
    private final RateLimiter limits;

    public EnrollmentAvatarController(
            JdbcTemplate db,
            EnrollmentSessions sessions,
            TransactionTemplate tx,
            RateLimiter limits) {
        this.db = db;
        this.sessions = sessions;
        this.tx = tx;
        this.limits = limits;
    }

    public record Photo(@NotNull @Size(min = 1, max = 349528) String content) {
        @Override
        public String toString() {
            return "Photo[redacted]";
        }
    }

    @PutMapping("/auth/enrollment/avatar")
    public Map<String, String> upload(@Valid @RequestBody Photo photo, HttpServletRequest request) {
        // Authenticate before decoding, and bound dimensions before allocating image pixels.
        int user = tx.execute(status -> sessions.require(request, false).account().id());
        limits.consume("ENROLL_AVATAR", Integer.toString(user), 20, 3600);
        byte[] normalized = normalize(photo.content());
        String url =
                ServletUriComponentsBuilder.fromCurrentContextPath()
                        .path("/auth/avatars/")
                        .path(UUID.randomUUID().toString())
                        .toUriString();
        UUID id = UUID.fromString(url.substring(url.lastIndexOf('/') + 1));
        tx.executeWithoutResult(
                status -> {
                    var caller = sessions.require(request, false);
                    if (caller.account().id() != user) throw AuthFailure.denied();
                    db.update("DELETE FROM auth.ProfileAvatars WHERE UserId=?", user);
                    db.update(
                            "INSERT auth.ProfileAvatars(UserId,PhotoId,Content) VALUES (?,?,?)",
                            user,
                            id,
                            normalized);
                    db.update("UPDATE dbo.Users SET ProfilePhotoUrl=? WHERE UserId=?", url, user);
                });
        return Map.of("url", url);
    }

    @DeleteMapping("/auth/enrollment/avatar")
    public void remove(HttpServletRequest request) {
        tx.executeWithoutResult(
                status -> {
                    int user = sessions.require(request, false).account().id();
                    db.update("DELETE FROM auth.ProfileAvatars WHERE UserId=?", user);
                    db.update("UPDATE dbo.Users SET ProfilePhotoUrl=NULL WHERE UserId=?", user);
                });
    }

    @GetMapping("/auth/avatars/{id}")
    public ResponseEntity<byte[]> image(@PathVariable UUID id) {
        var rows =
                db.queryForList(
                        "SELECT p.Content FROM auth.ProfileAvatars p JOIN auth.AccountSecurity a ON a.UserId=p.UserId WHERE p.PhotoId=? AND a.AdmissionStatus IN ('PENDING','ADMITTED')",
                        id);
        if (rows.isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .header("X-Content-Type-Options", "nosniff")
                .body((byte[]) rows.getFirst().get("Content"));
    }

    static byte[] normalize(String content) {
        try {
            byte[] bytes = Base64.getDecoder().decode(content);
            if (bytes.length == 0 || bytes.length > 262144) throw AuthFailure.invalid();
            try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) throw AuthFailure.invalid();
                var reader = readers.next();
                try {
                    reader.setInput(stream);
                    if (!java.util.Set.of("JPEG", "PNG")
                                    .contains(
                                            reader.getFormatName()
                                                    .toUpperCase(java.util.Locale.ROOT))
                            || reader.getWidth(0) > 1024
                            || reader.getHeight(0) > 1024) throw AuthFailure.invalid();
                    var image = reader.read(0);
                    var square = new BufferedImage(256, 256, BufferedImage.TYPE_INT_RGB);
                    var graphics = square.createGraphics();
                    try {
                        graphics.setColor(java.awt.Color.WHITE);
                        graphics.fillRect(0, 0, 256, 256);
                        int side = Math.min(image.getWidth(), image.getHeight());
                        int x = (image.getWidth() - side) / 2, y = (image.getHeight() - side) / 2;
                        graphics.setRenderingHint(
                                java.awt.RenderingHints.KEY_INTERPOLATION,
                                java.awt.RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                        graphics.drawImage(image, 0, 0, 256, 256, x, y, x + side, y + side, null);
                    } finally {
                        graphics.dispose();
                    }
                    var output = new ByteArrayOutputStream();
                    ImageIO.write(square, "jpeg", output);
                    return output.toByteArray();
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException | IllegalArgumentException exception) {
            throw new AuthFailure(400, "VALIDATION", "Ընտրեք վավեր JPG կամ PNG պատկեր։");
        }
    }
}
