package am.polylink.settings;

import am.polylink.auth.*;
import am.polylink.chat.ChatService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class ExportController {
    private final Sessions sessions;
    private final Accounts accounts;
    private final JdbcTemplate db;
    private final Clock clock;
    private final Secrets secrets;
    private final PasswordEncoder encoder;
    private final TransactionTemplate tx;
    private final RateLimiter limits;
    private final SettingsService settings;
    private final ObjectProvider<ChatService> chat;

    public ExportController(
            Sessions sessions,
            Accounts accounts,
            JdbcTemplate db,
            Clock clock,
            Secrets secrets,
            PasswordEncoder encoder,
            TransactionTemplate tx,
            RateLimiter limits,
            SettingsService settings,
            ObjectProvider<ChatService> chat) {
        this.sessions = sessions;
        this.accounts = accounts;
        this.db = db;
        this.clock = clock;
        this.secrets = secrets;
        this.encoder = encoder;
        this.tx = tx;
        this.limits = limits;
        this.settings = settings;
        this.chat = chat;
    }

    @PostMapping("/account/export/authorize")
    public Map<String, Object> authorize(
            @RequestBody AccountSettings.Proof input, HttpServletRequest request) {
        var caller = sessions.require(request);
        limits.consume("EXPORT_PROOF", "" + caller.account().id(), 10, 3600);
        return tx.execute(
                s -> {
                    var a = accounts.lock(caller.account().id());
                    a.requireAdmitted();
                    Secrets.decode(input.loginSecret(), 32);
                    if (!Long.toString(a.credential()).equals(input.expectedCredential())
                            || !encoder.matches(input.loginSecret(), a.verifier()))
                        throw AuthFailure.denied();
                    String grant = secrets.token();
                    var expires = OffsetDateTime.now(clock).plusMinutes(15);
                    db.update(
                            "DELETE auth.ExportGrants WHERE UserId=? AND (FamilyId=? OR ExpiresAt<=?)",
                            a.id(),
                            caller.familyId(),
                            OffsetDateTime.now(clock));
                    db.update(
                            "INSERT auth.ExportGrants VALUES (?,?,?,?,?)",
                            Secrets.hash(grant),
                            a.id(),
                            caller.familyId(),
                            a.credential(),
                            expires);
                    return Map.of("grant", grant, "expiresAt", expires.toString());
                });
    }

    private Sessions.Principal authorized(HttpServletRequest request) {
        var caller = sessions.require(request);
        String grant = request.getHeader("X-Export-Grant");
        if (grant == null || grant.length() > 100) throw AuthFailure.denied();
        if (db.queryForObject(
                        "SELECT COUNT(*) FROM auth.ExportGrants WHERE GrantHash=? AND UserId=? AND FamilyId=? AND CredentialVersion=? AND ExpiresAt>?",
                        Integer.class,
                        Secrets.hash(grant),
                        caller.account().id(),
                        caller.familyId(),
                        caller.account().credential(),
                        OffsetDateTime.now(clock))
                != 1) throw AuthFailure.denied();
        return caller;
    }

    private static final Map<String, String> TABLES =
            Map.of(
                    "education",
                    "Education",
                    "certificates",
                    "Certificates",
                    "workExperience",
                    "WorkExperience",
                    "posts",
                    "Posts",
                    "comments",
                    "PostComments",
                    "topics",
                    "ForumTopics",
                    "replies",
                    "ForumReplies");
    private static final Map<String, String> IDS =
            Map.of(
                    "education",
                    "EducationId",
                    "certificates",
                    "CertificateId",
                    "workExperience",
                    "WorkExperienceId",
                    "posts",
                    "PostId",
                    "comments",
                    "CommentId",
                    "topics",
                    "TopicId",
                    "replies",
                    "ReplyId");

    @GetMapping("/account/export/data")
    public Map<String, Object> data(
            @RequestParam String category,
            @RequestParam(defaultValue = "0") int offset,
            HttpServletRequest request) {
        var caller = authorized(request);
        int user = caller.account().id();
        if (offset < 0) throw AuthFailure.invalid();
        if (category.equals("profile")) {
            var rows =
                    Rows.query(
                            db,
                            "SELECT UserId,FirstName,LastName,Email,Specialization,About,ProfilePhotoUrl,CoverPhotoUrl,CreatedAt FROM dbo.Users WHERE UserId=?",
                            user);
            return Map.of("items", rows, "complete", true);
        }
        if (category.equals("settings"))
            return Map.of("items", List.of(settings.get(user)), "complete", true);
        String table = TABLES.get(category);
        if (table == null) throw AuthFailure.invalid();
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM dbo."
                                + table
                                + " WHERE UserId=? ORDER BY "
                                + IDS.get(category)
                                + " OFFSET ? ROWS FETCH NEXT 100 ROWS ONLY",
                        user,
                        offset);
        return Map.of(
                "items", rows, "complete", rows.size() < 100, "nextOffset", offset + rows.size());
    }

    @GetMapping("/account/export/files/{id}")
    public org.springframework.http.ResponseEntity<byte[]> file(
            @PathVariable UUID id, HttpServletRequest request) {
        var caller = authorized(request);
        if (db.queryForObject(
                        "SELECT COUNT(*) FROM messaging.Attachments WHERE AttachmentId=? AND OwnerId=? AND Sequence IS NOT NULL",
                        Integer.class,
                        id,
                        caller.account().id())
                != 1) throw new AuthFailure(404, "NOT_FOUND", "File unavailable.");
        var service = chat.getIfAvailable();
        if (service == null) throw AuthFailure.unavailable();
        return org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.APPLICATION_OCTET_STREAM)
                .header("Content-Disposition", "attachment")
                .body(service.download(caller.account().id(), id));
    }

    @GetMapping("/account/export/messages")
    public Map<String, Object> messages(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit,
            HttpServletRequest request) {
        var caller = authorized(request);
        var service = chat.getIfAvailable();
        if (service == null) return Map.of("items", List.of());
        return service.exportOwn(caller.account().id(), cursor, limit);
    }
}
