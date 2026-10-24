package am.polylink;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import am.polylink.database.SchemaCommand;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Properties;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

class DatabaseMigrationIT {
    @Test
    void forumReviewRequiresExactMappingAndPreservesOriginalDates() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var source = new SingleConnectionDataSource(connection, true);
                    SchemaCommand.migrations(source, "11").migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute(
                                "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId) SELECT N'Forum',N'Legacy',N'forum@example.invalid',(SELECT TOP(1) RoleId FROM dbo.Roles),(SELECT TOP(1) Id FROM dbo.Languages)");
                        statement.execute(
                                "INSERT dbo.ForumTopics(UserId,Title,Content,CreatedAt) SELECT UserId,N'Topic',N'<b>Legacy</b>','2020-01-01T12:00:00' FROM dbo.Users");
                        statement.execute(
                                "INSERT dbo.ForumReplies(TopicId,UserId,Content,CreatedAt) SELECT TopicId,UserId,N'Reply','2020-01-01T13:00:00' FROM dbo.ForumTopics");
                    }
                    SchemaCommand.migrate(connection, "upgrade", "12");
                    var db = new org.springframework.jdbc.core.JdbcTemplate(source);
                    assertThat(
                                    db.queryForObject(
                                            "SELECT COUNT(*) FROM dbo.ForumTopics WHERE CreatedAtUtc IS NULL",
                                            Integer.class))
                            .isEqualTo(1);
                    var review =
                            java.util.Map.of(
                                    "operator",
                                    "test operator",
                                    "timezone",
                                    "Asia/Yerevan",
                                    "topics",
                                    java.util.Map.of("1", "informatics"));
                    assertThatThrownBy(
                                    () ->
                                            am.polylink.forum.ForumMaintenanceCommand.review(
                                                    connection,
                                                    java.util.Map.of(
                                                            "operator",
                                                            "test",
                                                            "timezone",
                                                            "UTC",
                                                            "topics",
                                                            java.util.Map.of()),
                                                    false))
                            .hasMessageContaining("exactly");
                    am.polylink.forum.ForumMaintenanceCommand.review(connection, review, false);
                    assertThat(
                                    db.queryForObject(
                                            "SELECT COUNT(*) FROM forum.LegacyReview",
                                            Integer.class))
                            .isZero();
                    assertThatThrownBy(() -> SchemaCommand.migrations(source).migrate())
                            .hasMessageContaining("Forum legacy review required");
                    am.polylink.forum.ForumMaintenanceCommand.review(connection, review, true);
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(
                                    db.queryForObject(
                                            "SELECT COUNT(*) FROM forum.LegacyReview",
                                            Integer.class))
                            .isEqualTo(2);
                    assertThat(
                                    db.queryForObject(
                                            "SELECT CONVERT(varchar(30),CreatedAt,126) FROM dbo.ForumTopics",
                                            String.class))
                            .startsWith("2020-01-01T12:00:00");
                    assertThat(
                                    db.queryForObject(
                                            "SELECT DATEPART(hour,CreatedAtUtc) FROM dbo.ForumTopics",
                                            Integer.class))
                            .isEqualTo(8);
                    assertThat(
                                    db.queryForObject(
                                            "SELECT Content FROM dbo.ForumTopics", String.class))
                            .isEqualTo("<b>Legacy</b>");
                    db.execute("ALTER TABLE dbo.ForumTopics ADD UnexpectedForumState bit NULL");
                    assertThatThrownBy(() -> SchemaCommand.assertCurrentSchema(connection))
                            .hasMessageContaining("reviewed forum inventory");
                });
    }

    @Test
    void v9SettingsBackfillPreservesVisibilityAndLanguage() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var source = new SingleConnectionDataSource(connection, true);
                    Flyway.configure()
                            .dataSource(source)
                            .locations("classpath:db/migration")
                            .target("9")
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute(
                                "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId,IsProfilePublic) SELECT N'Settings',N'Fixture',N'settings@example.invalid',(SELECT TOP(1) RoleId FROM dbo.Roles),(SELECT Id FROM dbo.Languages WHERE Code=N'en'),0");
                        statement.execute(
                                "INSERT dbo.UserNotificationSettings(UserId,EmailEnabled,NewListingNotifications) SELECT UserId,0,NULL FROM dbo.Users");
                    }
                    SchemaCommand.migrate(connection, "upgrade");
                    SchemaCommand.assertCurrentSchema(connection);
                    try (var statement = connection.createStatement();
                            var rows =
                                    statement.executeQuery(
                                            "SELECT u.IsProfilePublic,u.ShowEmail,l.Code,n.EmailEnabled,n.NewListingNotifications FROM dbo.Users u JOIN dbo.Languages l ON l.Id=u.LanguageId JOIN dbo.UserNotificationSettings n ON n.UserId=u.UserId")) {
                        assertThat(rows.next()).isTrue();
                        assertThat(rows.getBoolean(1)).isFalse();
                        assertThat(rows.getBoolean(2)).isFalse();
                        assertThat(rows.getString(3)).isEqualTo("en");
                        assertThat(rows.getBoolean(4)).isFalse();
                        assertThat(rows.getBoolean(5)).isTrue();
                    }
                    assertThat(SchemaCommand.migrations(source).migrate().migrationsExecuted)
                            .isZero();
                });
    }

    @Test
    void freshInstallRetiresLegacyChatWithoutCredentialsOrContent() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var flyway =
                            SchemaCommand.migrations(
                                    new SingleConnectionDataSource(connection, true));
                    SchemaCommand.migrate(connection, "fresh");
                    assertThatThrownBy(() -> SchemaCommand.migrate(connection, "fresh"))
                            .hasMessageContaining("requires an empty database");
                    SchemaCommand.assertCurrentSchema(connection);
                    assertLegacyChatAbsent(connection);
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(flyway.migrate().migrationsExecuted).isZero();
                    flyway.validate();
                    assertThat(count(connection, "auth.AccountSecurity")).isZero();
                    assertThat(count(connection, "dbo.Users")).isZero();
                    assertThat(count(connection, "messaging.Messages")).isZero();
                });
    }

    @Test
    void existingSchemaUpgradeRemovesLegacyChatAndDoesNotAdmitLegacyUsers() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    // Create an exact V1 restore-equivalent schema without Flyway history.
                    var source = new SingleConnectionDataSource(connection, true);
                    Flyway.configure()
                            .dataSource(source)
                            .locations("classpath:db/migration")
                            .target("1")
                            .cleanDisabled(true)
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute("DROP TABLE dbo.flyway_schema_history");
                        statement.execute("INSERT dbo.Roles(Name) VALUES (N'graduate')");
                        statement.execute(
                                "INSERT dbo.Languages(Code,Name) VALUES (N'hy',N'Armenian')");
                        statement.execute(
                                "INSERT dbo.Users(FirstName,LastName,Email,PasswordHash,RoleId,LanguageId) VALUES (N'Փորձ',N'Fixture',N'fixture@example.invalid',N'NOT_AN_AUTH_VERIFIER',1,1)");
                        statement.execute("INSERT dbo.ChatRooms(IsGroup) VALUES (0)");
                        statement.execute(
                                "INSERT dbo.ChatParticipants(RoomId,UserId) VALUES (1,1)");
                        statement.execute(
                                "INSERT dbo.ChatMessages(RoomId,SenderId,EncryptedContent) VALUES (1,1,N'Legacy plaintext must be removed')");
                    }
                    SchemaCommand.assertLegacySchema(connection);
                    var flyway = SchemaCommand.migrations(source);
                    assertThatThrownBy(flyway::migrate).hasMessageContaining("non-empty schema");
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(flyway.migrate().migrationsExecuted).isZero();
                    SchemaCommand.assertCurrentSchema(connection);
                    assertLegacyChatAbsent(connection);
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(count(connection, "dbo.Users")).isEqualTo(1);
                    assertThat(count(connection, "auth.AccountSecurity")).isZero();
                    assertThat(count(connection, "messaging.Messages")).isZero();
                });
    }

    @Test
    void driftIsRejectedBeforeAnExistingDatabaseCanBeBaselined() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    Flyway.configure()
                            .dataSource(new SingleConnectionDataSource(connection, true))
                            .locations("classpath:db/migration")
                            .target("1")
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute("DROP TABLE dbo.flyway_schema_history");
                        statement.execute("ALTER TABLE dbo.Users ADD UnexpectedState bit NULL");
                    }
                    assertThatThrownBy(() -> SchemaCommand.migrate(connection, "upgrade"))
                            .hasMessageContaining("differs from the inspected baseline");
                });
    }

    @Test
    void m5UpgradePreservesCiphertextKeysAndPersonalStateAndAssignsExistingGroupOwner()
            throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var source = new SingleConnectionDataSource(connection, true);
                    Flyway.configure()
                            .dataSource(source)
                            .locations("classpath:db/migration")
                            .target("6")
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute(
                                "IF NOT EXISTS(SELECT 1 FROM dbo.Languages WHERE Code=N'en') INSERT dbo.Languages(Code,Name) VALUES (N'en',N'English')");
                        statement.execute(
                                """
                    INSERT dbo.Users(FirstName,LastName,Email,PasswordHash,RoleId,LanguageId)
                    SELECT N'Upgrade',N'One',N'upgrade1@example.invalid',N'NOT_AUTH',r.RoleId,l.Id FROM dbo.Roles r CROSS JOIN dbo.Languages l WHERE r.Name=N'graduate' AND l.Code=N'en';
                    INSERT dbo.Users(FirstName,LastName,Email,PasswordHash,RoleId,LanguageId)
                    SELECT N'Upgrade',N'Two',N'upgrade2@example.invalid',N'NOT_AUTH',r.RoleId,l.Id FROM dbo.Roles r CROSS JOIN dbo.Languages l WHERE r.Name=N'graduate' AND l.Code=N'en';
                    INSERT auth.AccountSecurity(UserId,AdmissionStatus,EmailVerifiedAt,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled)
                    SELECT UserId,'ADMITTED',SYSDATETIMEOFFSET(),1,1,0x00,2,67108864,'SYNTHETIC',0 FROM dbo.Users;
                    INSERT keyvault.Identities SELECT UserId,1,0x00,SYSDATETIMEOFFSET() FROM dbo.Users;
                    DECLARE @group uniqueidentifier='10000000-0000-4000-8000-000000000001',@direct uniqueidentifier='20000000-0000-4000-8000-000000000001';
                    INSERT dbo.ChatRooms(IsGroup) VALUES (1);
                    INSERT dbo.ChatParticipants(RoomId,UserId) VALUES (1,1),(1,2);
                    INSERT dbo.ChatMessages(RoomId,SenderId,EncryptedContent) VALUES (1,1,N'Obsolete plaintext');
                    INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (@group,1,0,1,3,SYSDATETIMEOFFSET()),(@direct,0,0,1,0,SYSDATETIMEOFFSET());
                    UPDATE messaging.Rooms SET LegacyRoomId=1 WHERE RoomId=@group;
                    INSERT messaging.Participants SELECT @group,UserId,1,1,2,1,1 FROM dbo.Users;
                    INSERT messaging.Participants SELECT @direct,UserId,1,0,0,0,0 FROM dbo.Users;
                    INSERT messaging.DirectPairs VALUES (1,2,@direct);
                    INSERT messaging.RoomKeys VALUES (@group,1,1,0x1122,0x00,SYSDATETIMEOFFSET());
                    UPDATE messaging.Rooms SET ActiveKeyVersion=1 WHERE RoomId=@group;
                    INSERT messaging.Envelopes SELECT @group,1,UserId,1,0x3344 FROM dbo.Users;
                    INSERT messaging.Messages(RoomId,Sequence,MessageId,SenderId,ClientOperationId,KeyVersion,Ciphertext,SentAt) VALUES (@group,3,NEWID(),1,NEWID(),1,0x5566,SYSDATETIMEOFFSET());
                    """);
                    }
                    SchemaCommand.migrate(connection, "upgrade");
                    try (var statement = connection.createStatement();
                            var rows =
                                    statement.executeQuery(
                                            "SELECT g.OwnerId,p.HistoryCutoff,p.LastReadSequence,p.Muted,p.Hidden,m.Ciphertext,e.SealedPacket FROM messaging.Groups g JOIN messaging.Participants p ON p.RoomId=g.RoomId JOIN messaging.Messages m ON m.RoomId=g.RoomId JOIN messaging.Envelopes e ON e.RoomId=p.RoomId AND e.UserId=p.UserId ORDER BY p.UserId")) {
                        int n = 0;
                        while (rows.next()) {
                            n++;
                            assertThat(rows.getInt("OwnerId")).isEqualTo(1);
                            assertThat(rows.getLong("HistoryCutoff")).isEqualTo(1);
                            assertThat(rows.getLong("LastReadSequence")).isEqualTo(2);
                            assertThat(rows.getBoolean("Muted")).isTrue();
                            assertThat(rows.getBoolean("Hidden")).isTrue();
                            assertThat(rows.getBytes("Ciphertext")).containsExactly(0x55, 0x66);
                            assertThat(rows.getBytes("SealedPacket")).containsExactly(0x33, 0x44);
                        }
                        assertThat(n).isEqualTo(2);
                    }
                    assertLegacyChatAbsent(connection);
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(count(connection, "messaging.MembershipIntervals")).isEqualTo(2);
                    assertThat(count(connection, "messaging.DirectPairs")).isEqualTo(1);
                });
    }

    @Test
    void unexpectedDependencyRollsBackRetirementAndAllowsRetry() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var source = new SingleConnectionDataSource(connection, true);
                    Flyway.configure()
                            .dataSource(source)
                            .locations("classpath:db/migration")
                            .target("7")
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute(
                                "CREATE TABLE messaging.LegacyRetention (MessageId int REFERENCES dbo.ChatMessages(MessageId))");
                    }
                    assertThatThrownBy(() -> SchemaCommand.migrate(connection, "upgrade"))
                            .hasMessageContaining("V8__remove_legacy_chat.sql");
                    SchemaCommand.assertLegacySchema(connection);
                    try (var statement = connection.createStatement();
                            var result =
                                    statement.executeQuery(
                                            "SELECT COL_LENGTH(N'messaging.Rooms',N'LegacyRoomId'),COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'messaging.Rooms') AND referenced_object_id=OBJECT_ID(N'dbo.ChatRooms')")) {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getInt(1)).isEqualTo(4);
                        assertThat(result.getInt(2)).isEqualTo(1);
                    }
                    try (var statement = connection.createStatement()) {
                        statement.execute("DROP TABLE messaging.LegacyRetention");
                    }
                    SchemaCommand.migrate(connection, "upgrade");
                    assertLegacyChatAbsent(connection);
                });
    }

    @Test
    void driftAfterLegacyChatRetirementIsStillRejected() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    SchemaCommand.migrate(connection, "fresh");
                    try (var statement = connection.createStatement()) {
                        statement.execute("ALTER TABLE dbo.Users ADD UnexpectedState bit NULL");
                    }
                    assertThatThrownBy(() -> SchemaCommand.migrate(connection, "upgrade"))
                            .hasMessageContaining("differs from the inspected baseline");
                });
    }

    @Test
    void v8UpgradeRetainsCurrentCredentialsFactorsSessionsAndVaults() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    Flyway.configure()
                            .dataSource(new SingleConnectionDataSource(connection, true))
                            .locations("classpath:db/migration")
                            .target("8")
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute(
                                """
                    INSERT dbo.Users(FirstName,LastName,Email,PasswordHash,TwoFactorEnabled,RoleId,LanguageId)
                    SELECT N'Legacy',N'Fixture',v.Email,N'UNUSED_OLD_HASH',v.Factor,r.RoleId,l.Id
                    FROM (VALUES (N'v9-one@example.invalid',1),(N'v9-two@example.invalid',0),(N'v9-unenrolled@example.invalid',1)) v(Email,Factor)
                    CROSS JOIN dbo.Roles r CROSS JOIN dbo.Languages l WHERE r.Name=N'graduate' AND l.Code=N'en';
                    INSERT auth.AccountSecurity(UserId,AdmissionStatus,EmailVerifiedAt,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled)
                    SELECT UserId,'ADMITTED',SYSDATETIMEOFFSET(),7,1,0x112233,3,134217728,'CURRENT_VERIFIER',CASE WHEN Email=N'v9-one@example.invalid' THEN 0 ELSE 1 END
                    FROM dbo.Users WHERE Email<>N'v9-unenrolled@example.invalid';
                    INSERT keyvault.Identities SELECT UserId,1,0x1122,SYSDATETIMEOFFSET() FROM auth.AccountSecurity;
                    INSERT keyvault.Vaults(UserId,VaultKeyVersion,VaultRevision,IdentityVersion,VaultPacket,PasswordCopy,ServiceCopy,TransitContext)
                    SELECT UserId,2,3,1,0x3344,0x5566,'SERVICE_COPY','CONTEXT' FROM auth.AccountSecurity;
                    INSERT auth.Sessions(SessionId,UserId,FamilyId,CredentialVersion,AccessHash,RefreshHash,AccessExpiresAt,IdleExpiresAt,AbsoluteExpiresAt)
                    SELECT NEWID(),MIN(UserId),NEWID(),7,0x1122,0x3344,DATEADD(minute,5,SYSDATETIMEOFFSET()),DATEADD(day,1,SYSDATETIMEOFFSET()),DATEADD(day,2,SYSDATETIMEOFFSET()) FROM auth.AccountSecurity;
                    INSERT auth.AccessTokens SELECT AccessHash,SessionId,AccessExpiresAt FROM auth.Sessions;
                    """);
                    }
                    var security = snapshot(connection, "auth.AccountSecurity", "UserId");
                    var sessions = snapshot(connection, "auth.Sessions", "SessionId");
                    var tokens = snapshot(connection, "auth.AccessTokens", "AccessHash");
                    var vaults = snapshot(connection, "keyvault.Vaults", "UserId");
                    SchemaCommand.migrate(connection, "upgrade");
                    assertLegacyChatAbsent(connection);
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(snapshot(connection, "auth.AccountSecurity", "UserId"))
                            .isEqualTo(security);
                    assertThat(snapshot(connection, "auth.Sessions", "SessionId"))
                            .isEqualTo(sessions);
                    assertThat(snapshot(connection, "auth.AccessTokens", "AccessHash"))
                            .isEqualTo(tokens);
                    assertThat(snapshot(connection, "keyvault.Vaults", "UserId")).isEqualTo(vaults);
                    assertThat(count(connection, "dbo.Users")).isEqualTo(3);
                    assertThat(count(connection, "auth.AccountSecurity")).isEqualTo(2);
                });
    }

    @Test
    void v9UnexpectedIndexRollsBackDefaultRemovalAndAllowsRetry() throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var source = new SingleConnectionDataSource(connection, true);
                    Flyway.configure()
                            .dataSource(source)
                            .locations("classpath:db/migration")
                            .target("8")
                            .load()
                            .migrate();
                    try (var statement = connection.createStatement()) {
                        statement.execute(
                                "CREATE INDEX IX_LegacyPasswordBlock ON dbo.Users(PasswordHash)");
                    }
                    assertThatThrownBy(() -> SchemaCommand.migrate(connection, "upgrade"))
                            .hasMessageContaining("differs from the inspected baseline");
                    // Deliberately bypass the guard to verify the SQL migration's own rollback
                    // behavior.
                    assertThatThrownBy(() -> SchemaCommand.migrations(source).migrate())
                            .hasMessageContaining("V9__remove_legacy_user_authentication.sql");
                    try (var statement = connection.createStatement();
                            var result =
                                    statement.executeQuery(
                                            "SELECT COL_LENGTH(N'dbo.Users',N'PasswordHash'),COL_LENGTH(N'dbo.Users',N'TwoFactorEnabled'),COUNT(*) FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.Users') AND name=N'DF__Users__TwoFactor__787EE5A0'")) {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getInt(1)).isEqualTo(1000);
                        assertThat(result.getInt(2)).isEqualTo(1);
                        assertThat(result.getInt(3)).isEqualTo(1);
                    }
                    try (var statement = connection.createStatement()) {
                        statement.execute("DROP INDEX IX_LegacyPasswordBlock ON dbo.Users");
                    }
                    SchemaCommand.migrate(connection, "upgrade");
                    assertLegacyChatAbsent(connection);
                });
    }

    private static String snapshot(Connection connection, String table, String order)
            throws Exception {
        try (var statement = connection.createStatement();
                var result =
                        statement.executeQuery(
                                "SELECT (SELECT * FROM "
                                        + table
                                        + " ORDER BY "
                                        + order
                                        + " FOR JSON PATH, INCLUDE_NULL_VALUES)")) {
            result.next();
            return result.getString(1)
                    .replace(",\"GrandfatheredAdmission\":true", "")
                    .replace(",\"GrandfatheredAdmission\":false", "");
        }
    }

    private static void assertLegacyChatAbsent(Connection connection) throws Exception {
        try (var statement = connection.createStatement();
                var result =
                        statement.executeQuery(
                                "SELECT OBJECT_ID(N'dbo.ChatMessages'),OBJECT_ID(N'dbo.ChatParticipants'),OBJECT_ID(N'dbo.ChatRooms'),COL_LENGTH(N'messaging.Rooms',N'LegacyRoomId'),COL_LENGTH(N'dbo.Users',N'PasswordHash'),COL_LENGTH(N'dbo.Users',N'TwoFactorEnabled')")) {
            assertThat(result.next()).isTrue();
            for (int column = 1; column <= 6; column++)
                assertThat(result.getObject(column)).isNull();
        }
    }

    private static int count(Connection connection, String table) throws Exception {
        try (var statement = connection.createStatement();
                var result = statement.executeQuery("SELECT COUNT(*) FROM " + table)) {
            result.next();
            return result.getInt(1);
        }
    }

    private static void inIsolatedDatabase(DatabaseWork work) throws Exception {
        String password = System.getenv("DB_TEST_ADMIN_PASSWORD");
        assertThat(password)
                .as(
                        "Set DB_TEST_ADMIN_PASSWORD; migration tests create/drop only uniquely named disposable databases")
                .isNotBlank();
        var properties = new Properties();
        properties.setProperty(
                "user", System.getenv().getOrDefault("DB_TEST_ADMIN_USERNAME", "sa"));
        properties.setProperty("password", password);
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate",
                System.getenv().getOrDefault("DB_TRUST_SERVER_CERTIFICATE", "true"));
        properties.setProperty("databaseName", "master");
        String url =
                "jdbc:sqlserver://"
                        + System.getenv().getOrDefault("DB_HOST", "localhost")
                        + ":"
                        + System.getenv().getOrDefault("DB_PORT", "1433");
        String name = "polylink_m0_" + UUID.randomUUID().toString().replace("-", "");
        try (var admin = DriverManager.getConnection(url, properties);
                var statement = admin.createStatement()) {
            statement.execute(
                    "CREATE DATABASE [" + name + "] COLLATE SQL_Latin1_General_CP1_CI_AS");
            try {
                properties.setProperty("databaseName", name);
                try (var connection = DriverManager.getConnection(url, properties)) {
                    work.run(connection);
                }
            } finally {
                statement.execute(
                        "ALTER DATABASE [" + name + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE");
                statement.execute("DROP DATABASE [" + name + "]");
            }
        }
    }

    @FunctionalInterface
    private interface DatabaseWork {
        void run(Connection connection) throws Exception;
    }
}
