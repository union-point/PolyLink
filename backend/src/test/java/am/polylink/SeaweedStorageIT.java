package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.database.SchemaCommand;
import am.polylink.storage.*;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

@EnabledIfEnvironmentVariable(named = "OBJECT_STORAGE_ENABLED", matches = "true")
class SeaweedStorageIT {
    @TempDir Path temp;

    @Test
    void migratesResumablyVerifiesBytesAndRejectsCorruptRestore() throws Exception {
        DatabaseMigrationIT.inIsolatedDatabase(
                connection -> {
                    var source = new SingleConnectionDataSource(connection, true);
                    SchemaCommand.migrations(source, "21").migrate();
                    var db = new JdbcTemplate(source);
                    UUID id = UUID.randomUUID();
                    db.execute(
                            "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId) SELECT N'Storage',N'Fixture',N'storage-fixture@example.invalid',(SELECT TOP(1) RoleId FROM dbo.Roles),(SELECT TOP(1) Id FROM dbo.Languages)");
                    int user =
                            db.queryForObject(
                                    "SELECT UserId FROM dbo.Users WHERE Email='storage-fixture@example.invalid'",
                                    Integer.class);
                    db.update(
                            "INSERT auth.AccountSecurity(UserId,AdmissionStatus,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled) VALUES (?,'ADMITTED',1,1,0x00,2,67108864,'TEST',0)",
                            user);
                    byte[] jpeg = {1, 2, 3, 4, 5};
                    db.update(
                            "INSERT auth.ProfileAvatars(UserId,PhotoId,Content) VALUES (?,?,?)",
                            user,
                            id,
                            jpeg);
                    SchemaCommand.migrate(connection, "upgrade");
                    try (var storage =
                            new S3ObjectStorage(
                                    System.getenv("S3_ENDPOINT"),
                                    "us-east-1",
                                    "polylink",
                                    Path.of(System.getenv("S3_CREDENTIALS_FILE")))) {
                        var migration = new StorageMigration(db, storage, temp, Clock.systemUTC());
                        migration.migrate();
                        migration.migrate();
                        assertThat(migration.verify().get("bytes")).isEqualTo(5L);
                        assertThat(
                                        db.queryForObject(
                                                "SELECT Content FROM auth.ProfileAvatars WHERE PhotoId=?",
                                                byte[].class,
                                                id))
                                .isEqualTo(jpeg);
                        String key =
                                db.queryForObject(
                                        "SELECT ObjectKey FROM auth.ProfileAvatars WHERE PhotoId=?",
                                        String.class,
                                        id);
                        Path changed = temp.resolve("corrupt");
                        Files.write(changed, new byte[] {9, 8, 7, 6, 5});
                        storage.put(key, changed, "image/jpeg");
                        assertThatThrownBy(migration::verify)
                                .isInstanceOf(am.polylink.auth.AuthFailure.class);
                        Files.write(changed, jpeg);
                        storage.put(key, changed, "image/jpeg");
                        assertThat(migration.verify().get("verified")).isEqualTo(true);
                        storage.delete(key);
                        storage.delete(key);
                        assertThatThrownBy(migration::verify)
                                .isInstanceOf(am.polylink.auth.AuthFailure.class);
                    }
                });
    }
}
