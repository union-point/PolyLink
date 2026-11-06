package am.polylink.profile;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@IdentityEnabled
public class ProfileMediaController {
    private final Accounts accounts;
    private final Sessions sessions;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ProfileService profiles;
    private final RateLimiter limits;

    public ProfileMediaController(
            Accounts accounts,
            Sessions sessions,
            JdbcTemplate db,
            TransactionTemplate tx,
            ProfileService profiles,
            RateLimiter limits) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.db = db;
        this.tx = tx;
        this.profiles = profiles;
        this.limits = limits;
    }

    @PostMapping("/users/me/photo")
    public Object avatar(@RequestParam MultipartFile photo, HttpServletRequest r)
            throws IOException {
        return upload(photo, true, r);
    }

    @PostMapping("/users/me/banner")
    public Object cover(@RequestParam MultipartFile banner, HttpServletRequest r)
            throws IOException {
        return upload(banner, false, r);
    }

    private Object upload(MultipartFile file, boolean avatar, HttpServletRequest r)
            throws IOException {
        int user = sessions.require(r).account().id();
        limits.consume("PROFILE_IMAGE", "" + user, 20, 3600);
        if (file.isEmpty()
                || file.getSize() > 5 * 1024 * 1024
                || !Set.of("image/jpeg", "image/png")
                        .contains(Objects.toString(file.getContentType(), "")))
            throw AuthFailure.invalid();
        byte[] input = file.getBytes();
        boolean png =
                input.length >= 8
                        && input[0] == (byte) 137
                        && input[1] == 80
                        && input[2] == 78
                        && input[3] == 71;
        if (("image/png".equals(file.getContentType())) != png) throw AuthFailure.invalid();
        byte[] bytes = ProfileImages.normalize(input, avatar, false);
        UUID id = UUID.randomUUID();
        String table = avatar ? "ProfileAvatars" : "ProfileCovers",
                column = avatar ? "ProfilePhotoUrl" : "CoverPhotoUrl";
        String url =
                ServletUriComponentsBuilder.fromCurrentContextPath()
                        .path(avatar ? "/auth/avatars/" : "/users/media/covers/")
                        .path(id.toString())
                        .toUriString();
        return tx.execute(
                s -> {
                    accounts.lock(user).requireAdmitted();
                    if (sessions.require(r).account().id() != user) throw AuthFailure.denied();
                    // Serialize replacements for this owner so concurrent first uploads cannot race
                    // on PK.
                    db.queryForList(
                            "SELECT UserId FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE UserId=?",
                            user);
                    db.update("DELETE auth." + table + " WHERE UserId=?", user);
                    db.update(
                            "INSERT auth." + table + "(UserId,PhotoId,Content) VALUES (?,?,?)",
                            user,
                            id,
                            bytes);
                    db.update("UPDATE dbo.Users SET " + column + "=? WHERE UserId=?", url, user);
                    return profiles.get(user, user);
                });
    }

    @GetMapping("/users/media/covers/{id}")
    public ResponseEntity<byte[]> cover(@PathVariable UUID id) {
        var rows =
                db.queryForList(
                        "SELECT p.Content FROM auth.ProfileCovers p JOIN auth.AccountSecurity a ON a.UserId=p.UserId WHERE p.PhotoId=? AND a.AdmissionStatus='ADMITTED'",
                        id);
        return rows.isEmpty()
                ? ResponseEntity.notFound().build()
                : ResponseEntity.ok()
                        .contentType(MediaType.IMAGE_JPEG)
                        .header("X-Content-Type-Options", "nosniff")
                        .body((byte[]) rows.getFirst().get("Content"));
    }
}
