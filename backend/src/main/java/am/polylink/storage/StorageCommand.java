package am.polylink.storage;

import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Explicit offline maintenance. Never initialize or migrate infrastructure on app startup. */
public final class StorageCommand {
    private StorageCommand() {}

    static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + key);
        return value;
    }

    public static JdbcTemplate database() {
        var properties = new Properties();
        properties.setProperty("databaseName", required("DB_NAME"));
        properties.setProperty("user", required("MIGRATION_DB_USERNAME"));
        properties.setProperty("password", required("MIGRATION_DB_PASSWORD"));
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate",
                System.getenv().getOrDefault("DB_TRUST_SERVER_CERTIFICATE", "false"));
        properties.setProperty("loginTimeout", "10");
        var source = new DriverManagerDataSource();
        source.setUrl(
                "jdbc:sqlserver://"
                        + System.getenv().getOrDefault("DB_HOST", "localhost")
                        + ":"
                        + System.getenv().getOrDefault("DB_PORT", "1433"));
        source.setConnectionProperties(properties);
        return new JdbcTemplate(source);
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1
                || !Set.of(
                                "init-bucket",
                                "migrate",
                                "verify",
                                "cleanup",
                                "sweep",
                                "retire-sql-bodies",
                                "restore-report",
                                "abandon-uploads")
                        .contains(args[0]))
            throw new IllegalArgumentException(
                    "Use init-bucket, migrate, verify, cleanup, sweep or retire-sql-bodies");
        try (var objects =
                new S3ObjectStorage(
                        required("S3_ENDPOINT"),
                        System.getenv().getOrDefault("S3_REGION", "us-east-1"),
                        System.getenv().getOrDefault("S3_BUCKET", "polylink"),
                        Path.of(
                                required(
                                        args[0].equals("init-bucket")
                                                ? "S3_ADMIN_CREDENTIALS_FILE"
                                                : "S3_CREDENTIALS_FILE")))) {
            if (args[0].equals("init-bucket")) {
                objects.createBucket();
                return;
            }
            var db = database();
            var clock = Clock.systemUTC();
            var temp = Path.of(required("OBJECT_STORAGE_TEMP_DIR"));
            var migration = new StorageMigration(db, objects, temp, clock);
            switch (args[0]) {
                case "abandon-uploads" -> {
                    for (String table : List.of("messaging.Attachments", "auth.ProfileAvatars"))
                        db.update(
                                "UPDATE "
                                        + table
                                        + " SET "
                                        + (table.startsWith("auth") ? "IsCurrent=0," : "")
                                        + "StorageState='DELETE_PENDING',LeaseToken=NULL,LeaseUntil=NULL,RetryAt=NULL WHERE StorageState='UPLOADING' AND LeaseUntil<=SYSDATETIMEOFFSET()");
                    System.out.println(
                            "Expired unfinished uploads marked for cleanup; immutable IDs retained.");
                }
                case "restore-report" -> {
                    var mapper = JsonMapper.builder().build();
                    var ledger =
                            mapper.readTree(
                                    Files.readString(Path.of(required("DELETION_LEDGER_FILE"))));
                    if (!ledger.path("userIds").isArray())
                        throw new IllegalArgumentException("Invalid deletion ledger");
                    for (var id : ledger.path("userIds"))
                        if (db.queryForObject(
                                        "SELECT COUNT(*) FROM dbo.Users u LEFT JOIN auth.AccountSecurity a ON a.UserId=u.UserId WHERE u.UserId=? AND (a.AdmissionStatus IS NULL OR a.AdmissionStatus<>'DELETED')",
                                        Integer.class,
                                        Integer.parseInt(id.asText()))
                                != 0)
                            throw new IllegalStateException(
                                    "Deletion ledger has not been replayed");
                    var transit =
                            new am.polylink.keyvault.OpenBaoTransitClient(
                                    required("OPENBAO_URL"),
                                    required("OPENBAO_TOKEN_FILE"),
                                    false,
                                    mapper);
                    long copies = 0;
                    for (var row :
                            am.polylink.auth.Rows.query(
                                    db,
                                    "SELECT UserId,VaultKeyVersion,ServiceCopy,TransitContext FROM keyvault.Vaults")) {
                        byte[] key =
                                transit.unwrap(
                                        ((Number) row.get("UserId")).intValue(),
                                        ((Number) row.get("VaultKeyVersion")).longValue(),
                                        row.get("ServiceCopy").toString(),
                                        row.get("TransitContext").toString());
                        Arrays.fill(key, (byte) 0);
                        copies++;
                    }
                    var report = new LinkedHashMap<>(migration.verify());
                    report.put("backupSet", required("BACKUP_SET"));
                    report.put("transitVerified", true);
                    report.put("serviceCopies", copies);
                    report.put("deletionLedgerReplayed", true);
                    System.out.println(mapper.writeValueAsString(report));
                }
                case "migrate" -> {
                    migration.migrate();
                    System.out.println(
                            "Object backfill and readback verification completed; SQL bytes retained.");
                }
                case "verify" ->
                        System.out.println(
                                JsonMapper.builder()
                                        .build()
                                        .writeValueAsString(migration.verify()));
                case "retire-sql-bodies" -> {
                    // Require the operator's restore report, then independently verify this
                    // database/object set again.
                    var report =
                            JsonMapper.builder()
                                    .build()
                                    .readTree(
                                            Files.readString(
                                                    Path.of(required("STORAGE_RESTORE_REPORT"))));
                    if (!report.path("verified").asBoolean()
                            || report.path("backupSet").asText().isBlank()
                            || !report.path("transitVerified").asBoolean()
                            || !report.path("deletionLedgerReplayed").asBoolean())
                        throw new IllegalStateException(
                                "Successful coordinated restore report required");
                    migration.verify();
                    var tx =
                            new TransactionTemplate(
                                    new DataSourceTransactionManager(
                                            Objects.requireNonNull(db.getDataSource())));
                    tx.executeWithoutResult(
                            s -> {
                                db.execute("DROP TABLE IF EXISTS messaging.AttachmentBodies");
                                if (db.queryForObject(
                                                "SELECT COUNT(*) FROM sys.extended_properties WHERE class=0 AND name='polylink.storage.sql-retired'",
                                                Integer.class)
                                        == 0)
                                    db.execute(
                                            "EXEC sys.sp_addextendedproperty @name=N'polylink.storage.sql-retired',@value=1");
                                if (db.queryForObject(
                                                "SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID('auth.ProfileAvatars') AND name='Content'",
                                                Integer.class)
                                        == 1) {
                                    db.execute(
                                            "ALTER TABLE auth.ProfileAvatars DROP CONSTRAINT CK_ProfileAvatarSize");
                                    db.execute(
                                            "ALTER TABLE auth.ProfileAvatars DROP COLUMN Content");
                                }
                            });
                    System.out.println(
                            "Verified legacy SQL binary storage retired. Keep object storage enabled.");
                }
                default -> {
                    var factory = new StaticListableBeanFactory(Map.of("objects", objects));
                    var service =
                            new StorageService(
                                    factory.getBeanProvider(ObjectStorage.class), temp.toString());
                    var cleanup =
                            new StorageCleanup(
                                    db,
                                    new TransactionTemplate(
                                            new DataSourceTransactionManager(
                                                    Objects.requireNonNull(db.getDataSource()))),
                                    clock,
                                    service);
                    if (args[0].equals("cleanup")) cleanup.clean();
                    else System.out.println("Orphans deleted: " + cleanup.sweepOrphans());
                }
            }
        }
    }
}
