package am.polylink.storage;

import am.polylink.auth.*;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Operator-only, stopped-writer backfill. No HTTP route and no plaintext processing. */
public final class StorageMigration {
    private final JdbcTemplate db;
    private final ObjectStorage storage;
    private final Path temp;
    private final Clock clock;

    public StorageMigration(JdbcTemplate db, ObjectStorage storage, Path temp, Clock clock) {
        this.db = db;
        this.storage = storage;
        this.temp = temp;
        this.clock = clock;
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    public void migrate() {
        db.update(
                "UPDATE a SET StorageState='DELETE_PENDING',RetryAt=NULL FROM messaging.Attachments a JOIN auth.AccountSecurity s ON s.UserId=a.OwnerId WHERE a.StorageState='LEGACY' AND s.AdmissionStatus='DELETED'");
        db.update(
                "UPDATE p SET IsCurrent=0,StorageState='DELETE_PENDING',RetryAt=NULL FROM auth.ProfileAvatars p LEFT JOIN auth.AccountSecurity s ON s.UserId=p.UserId WHERE p.StorageState='LEGACY' AND (s.UserId IS NULL OR s.AdmissionStatus='DELETED')");
        // Existing expired/missing staged bodies are tombstones, never migration failures.
        db.update(
                "UPDATE a SET StorageState='DELETE_PENDING',RetryAt=NULL FROM messaging.Attachments a WHERE StorageState='LEGACY' AND Sequence IS NULL AND ExpiresAt<=?",
                now());
        for (boolean avatar : List.of(false, true)) {
            String table = avatar ? "auth.ProfileAvatars" : "messaging.Attachments",
                    idColumn = avatar ? "PhotoId" : "AttachmentId";
            while (true) {
                var batch =
                        Rows.query(
                                db,
                                "SELECT TOP(100) * FROM "
                                        + table
                                        + " WHERE StorageState='LEGACY' ORDER BY "
                                        + idColumn);
                if (batch.isEmpty()) break;
                for (var row : batch) {
                    Object id = row.get(idColumn);
                    String key =
                            (avatar ? "avatars/" : "attachments/")
                                    + id.toString().toLowerCase(Locale.ROOT)
                                    + "/migration-v22";
                    db.update(
                            "UPDATE "
                                    + table
                                    + " SET ObjectKey=? WHERE "
                                    + idColumn
                                    + "=? AND StorageState='LEGACY'",
                            key,
                            id);
                    String sql =
                            avatar
                                    ? "SELECT Content FROM auth.ProfileAvatars WHERE PhotoId=?"
                                    : "SELECT Ciphertext FROM messaging.AttachmentBodies WHERE AttachmentId=?";
                    var result =
                            db.query(
                                    sql,
                                    rs -> {
                                        if (!rs.next())
                                            throw new IllegalStateException(
                                                    "Live SQL object body missing; migration stopped");
                                        try (var input =
                                                        java.util.Objects.requireNonNull(
                                                                rs.getBinaryStream(1),
                                                                "Live SQL body missing");
                                                var spool =
                                                        Spool.read(
                                                                temp,
                                                                input,
                                                                avatar ? 1 : 17,
                                                                avatar ? 262144 : 5242896)) {
                                            if (!avatar
                                                    && (spool.size()
                                                                    != ((Number)
                                                                                    row.get(
                                                                                            "CiphertextBytes"))
                                                                            .longValue()
                                                            || !Secrets.equal(
                                                                    spool.digest(),
                                                                    (byte[])
                                                                            row.get(
                                                                                    "CiphertextDigest"))))
                                                throw new IllegalStateException(
                                                        "SQL attachment digest mismatch; migration stopped");
                                            storage.put(
                                                    key,
                                                    spool.path(),
                                                    avatar
                                                            ? "image/jpeg"
                                                            : "application/octet-stream");
                                            Spool.verify(
                                                    storage, key, spool.size(), spool.digest());
                                            return new Object[] {spool.size(), spool.digest()};
                                        } catch (java.io.IOException e) {
                                            throw AuthFailure.unavailable();
                                        }
                                    },
                                    id);
                    if (avatar)
                        db.update(
                                "UPDATE auth.ProfileAvatars SET ContentBytes=?,ContentDigest=?,VerifiedAt=?,StorageState='READY' WHERE PhotoId=? AND StorageState='LEGACY'",
                                result[0],
                                result[1],
                                now(),
                                id);
                    else
                        db.update(
                                "UPDATE messaging.Attachments SET VerifiedAt=?,StorageState='READY' WHERE AttachmentId=? AND StorageState='LEGACY'",
                                now(),
                                id);
                }
            }
        }
        verify();
    }

    /** Full readback, also used as the restore gate. It must fail closed. */
    public Map<String, Object> verify() {
        var inventory = new ArrayList<Map<String, Object>>();
        long total = 0;
        for (boolean avatar : List.of(false, true)) {
            String table = avatar ? "auth.ProfileAvatars" : "messaging.Attachments";
            if (db.queryForObject(
                            "SELECT COUNT(*) FROM "
                                    + table
                                    + " WHERE StorageState IN ('LEGACY','UPLOADING')",
                            Integer.class)
                    != 0)
                throw new IllegalStateException(
                        "Unmigrated or interrupted uploads remain; resolve before cutover");
            String idColumn = avatar ? "PhotoId" : "AttachmentId";
            String cursor = null;
            do {
                // Keyset pagination over the unique object key avoids loading bodies or an entire
                // inventory from SQL.
                var batch =
                        Rows.query(
                                db,
                                "SELECT TOP(100) * FROM "
                                        + table
                                        + " WHERE StorageState='READY' AND (? IS NULL OR ObjectKey>?) ORDER BY ObjectKey",
                                cursor,
                                cursor);
                for (var row : batch) {
                    String key = row.get("ObjectKey").toString();
                    long size =
                            ((Number) row.get(avatar ? "ContentBytes" : "CiphertextBytes"))
                                    .longValue();
                    byte[] digest = (byte[]) row.get(avatar ? "ContentDigest" : "CiphertextDigest");
                    Spool.verify(storage, key, size, digest);
                    inventory.add(
                            Map.of(
                                    "id",
                                    row.get(idColumn).toString(),
                                    "kind",
                                    avatar ? "avatar" : "attachment",
                                    "key",
                                    key,
                                    "bytes",
                                    size,
                                    "sha256",
                                    HexFormat.of().formatHex(digest)));
                    total += size;
                    cursor = key;
                }
                if (batch.size() < 100) break;
            } while (true);
        }
        return Map.of(
                "verified",
                true,
                "objects",
                inventory,
                "bytes",
                total,
                "verifiedAt",
                now().toString(),
                "schema",
                22);
    }
}
