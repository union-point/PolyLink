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
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class EnrollmentAvatarController {
    private final JdbcTemplate db;
    private final EnrollmentSessions sessions;
    private final Sessions appSessions;
    private final TransactionTemplate tx;
    private final RateLimiter limits;
    private final am.polylink.storage.StorageService storage;
    private final java.time.Clock clock;

    public EnrollmentAvatarController(
            JdbcTemplate db,
            EnrollmentSessions sessions,
            Sessions appSessions,
            TransactionTemplate tx,
            RateLimiter limits,
            am.polylink.storage.StorageService storage,
            java.time.Clock clock) {
        this.db = db;
        this.sessions = sessions;
        this.appSessions = appSessions;
        this.tx = tx;
        this.limits = limits;
        this.storage = storage;
        this.clock = clock;
    }

    private java.time.OffsetDateTime now() {
        return java.time.OffsetDateTime.now(clock);
    }

    public record Photo(
            @NotNull @Size(min = 1, max = 349528) String content,
            @NotNull UUID operationId,
            UUID expectedPhotoId) {
        @Override
        public String toString() {
            return "Photo[redacted]";
        }
    }

    private UUID current(int user) {
        var ids =
                db.queryForList(
                        "SELECT PhotoId FROM auth.ProfileAvatars WHERE UserId=? AND IsCurrent=1",
                        String.class,
                        user);
        return ids.isEmpty() ? null : UUID.fromString(ids.getFirst());
    }

    private static String url(UUID id) {
        return "/auth/avatars/" + id;
    }

    private void expected(int user, UUID id) {
        if (!java.util.Objects.equals(current(user), id)) throw AuthFailure.conflict();
    }

    @PutMapping("/auth/enrollment/avatar")
    public Map<String, String> upload(@Valid @RequestBody Photo photo, HttpServletRequest request) {
        int user = tx.execute(s -> sessions.require(request, false).account().id());
        limits.consume("ENROLL_AVATAR", Integer.toString(user), 20, 3600);
        byte[] normalized = normalize(photo.content());
        UUID id = photo.operationId(), lease = UUID.randomUUID();
        try (var spool = storage.spool(new ByteArrayInputStream(normalized), 1, 262144)) {
            boolean complete =
                    tx.execute(
                            s -> {
                                if (sessions.require(request, false).account().id() != user)
                                    throw AuthFailure.denied();
                                var rows =
                                        Rows.query(
                                                db,
                                                "SELECT * FROM auth.ProfileAvatars WITH(UPDLOCK,HOLDLOCK) WHERE PhotoId=?",
                                                id);
                                if (!rows.isEmpty()) {
                                    var old = rows.getFirst();
                                    if (((Number) old.get("UserId")).intValue() != user)
                                        throw AuthFailure.conflict();
                                    if (!Secrets.equal(
                                                    spool.digest(),
                                                    (byte[]) old.get("ContentDigest"))
                                            || !java.util.Objects.equals(
                                                    old.get("ExpectedPhotoId") == null
                                                            ? null
                                                            : UUID.fromString(
                                                                    old.get("ExpectedPhotoId")
                                                                            .toString()),
                                                    photo.expectedPhotoId()))
                                        throw AuthFailure.conflict();
                                    if (Boolean.TRUE.equals(old.get("IsCurrent"))
                                            && java.util.Set.of("READY", "LEGACY")
                                                    .contains(old.get("StorageState"))) return true;
                                    if (!old.get("StorageState").equals("UPLOADING"))
                                        throw AuthFailure.conflict();
                                    if (old.get("LeaseUntil")
                                                    instanceof java.time.OffsetDateTime until
                                            && until.isAfter(now()))
                                        throw AuthFailure.unavailable();
                                }
                                expected(user, photo.expectedPhotoId());
                                if (rows.isEmpty())
                                    db.update(
                                            "INSERT auth.ProfileAvatars(UserId,PhotoId,IsCurrent,ExpectedPhotoId,StorageState,ContentBytes,ContentDigest) VALUES (?,?,0,?,'UPLOADING',?,?)",
                                            user,
                                            id,
                                            photo.expectedPhotoId(),
                                            spool.size(),
                                            spool.digest());
                                db.update(
                                        "UPDATE auth.ProfileAvatars SET ObjectKey=?,LeaseToken=?,LeaseUntil=? WHERE PhotoId=?",
                                        "avatars/" + id + "/" + lease,
                                        lease,
                                        now().plusMinutes(2),
                                        id);
                                return false;
                            });
            if (complete) return Map.of("url", url(id));
            if (storage.enabled()) storage.put("avatars/" + id + "/" + lease, spool, "image/jpeg");
            tx.executeWithoutResult(
                    s -> {
                        if (sessions.require(request, false).account().id() != user)
                            throw AuthFailure.denied();
                        expected(user, photo.expectedPhotoId());
                        db.update(
                                "UPDATE auth.ProfileAvatars SET IsCurrent=0,StorageState='DELETE_PENDING',RetryAt=NULL,LeaseToken=NULL,LeaseUntil=NULL WHERE UserId=? AND IsCurrent=1",
                                user);
                        int changed =
                                db.update(
                                        "UPDATE auth.ProfileAvatars SET IsCurrent=1,StorageState=?,VerifiedAt=?,LeaseToken=NULL,LeaseUntil=NULL,ObjectKey=? WHERE PhotoId=? AND StorageState='UPLOADING' AND LeaseToken=? AND LeaseUntil>?",
                                        storage.enabled() ? "READY" : "LEGACY",
                                        storage.enabled() ? now() : null,
                                        storage.enabled() ? "avatars/" + id + "/" + lease : null,
                                        id,
                                        lease,
                                        now());
                        if (!storage.enabled())
                            db.update(
                                    "UPDATE auth.ProfileAvatars SET Content=? WHERE PhotoId=?",
                                    normalized,
                                    id);
                        if (changed != 1) throw AuthFailure.conflict();
                        db.update(
                                "UPDATE dbo.Users SET ProfilePhotoUrl=? WHERE UserId=?",
                                url(id),
                                user);
                    });
            return Map.of("url", url(id));
        }
    }

    @DeleteMapping("/auth/enrollment/avatar")
    public void remove(@RequestParam UUID expectedPhotoId, HttpServletRequest request) {
        tx.executeWithoutResult(
                s -> {
                    int user = sessions.require(request, false).account().id();
                    UUID current = current(user);
                    if (current == null) return;
                    if (!current.equals(expectedPhotoId)) throw AuthFailure.conflict();
                    db.update(
                            "UPDATE auth.ProfileAvatars SET IsCurrent=0,StorageState='DELETE_PENDING',RetryAt=NULL,LeaseToken=NULL,LeaseUntil=NULL WHERE PhotoId=?",
                            current);
                    db.update("UPDATE dbo.Users SET ProfilePhotoUrl=NULL WHERE UserId=?", user);
                });
    }

    @GetMapping("/auth/avatars/{id}")
    public ResponseEntity<org.springframework.core.io.InputStreamResource> image(
            @PathVariable UUID id, HttpServletRequest request) {
        var reference =
                tx.execute(
                        s -> {
                            Integer pendingOwner = null;
                            if (request.getHeader("Authorization") != null)
                                appSessions.require(request).account().requireAdmitted();
                            else pendingOwner = sessions.require(request, true).account().id();
                            var rows =
                                    Rows.query(
                                            db,
                                            "SELECT p.*,a.AdmissionStatus FROM auth.ProfileAvatars p JOIN auth.AccountSecurity a ON a.UserId=p.UserId WHERE p.PhotoId=? AND p.IsCurrent=1 AND p.StorageState IN ('READY','LEGACY') AND a.AdmissionStatus IN ('PENDING','ADMITTED')",
                                            id);
                            if (rows.isEmpty()) return null;
                            var row = rows.getFirst();
                            if (pendingOwner != null
                                    ? pendingOwner != ((Number) row.get("UserId")).intValue()
                                    : !row.get("AdmissionStatus").equals("ADMITTED")) return null;
                            return row;
                        });
        if (reference == null) return ResponseEntity.notFound().build();
        am.polylink.storage.ObjectStorage.Download object;
        if (reference.get("StorageState").equals("LEGACY")) {
            byte[] bytes = (byte[]) reference.get("Content");
            if (bytes == null) throw AuthFailure.unavailable();
            object =
                    new am.polylink.storage.ObjectStorage.Download(
                            new ByteArrayInputStream(bytes), bytes.length);
        } else
            object =
                    storage.get(
                            reference.get("ObjectKey").toString(),
                            ((Number) reference.get("ContentBytes")).longValue());
        return am.polylink.storage.StorageService.response(object, "image/jpeg", false);
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
