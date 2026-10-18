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
    void freshInstallMatchesBaselineAndMigratesWithoutCredentialsOrLegacyContent()
            throws Exception {
        inIsolatedDatabase(
                connection -> {
                    var flyway =
                            SchemaCommand.migrations(
                                    new SingleConnectionDataSource(connection, true));
                    SchemaCommand.migrate(connection, "fresh");
                    assertThatThrownBy(() -> SchemaCommand.migrate(connection, "fresh"))
                            .hasMessageContaining("requires an empty database");
                    SchemaCommand.assertLegacySchema(connection);
                    assertThat(flyway.migrate().migrationsExecuted).isZero();
                    flyway.validate();
                    assertThat(count(connection, "auth.AccountSecurity")).isZero();
                    assertThat(count(connection, "dbo.Users")).isZero();
                    assertThat(count(connection, "messaging.Messages")).isZero();
                });
    }

    @Test
    void existingSchemaUpgradeRetainsLegacyBodiesAndDoesNotAdmitLegacyUsers() throws Exception {
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
                                "INSERT dbo.ChatMessages(RoomId,SenderId,EncryptedContent) VALUES (1,1,N'Legacy plaintext must survive')");
                    }
                    SchemaCommand.assertLegacySchema(connection);
                    var flyway = SchemaCommand.migrations(source);
                    assertThatThrownBy(flyway::migrate).hasMessageContaining("non-empty schema");
                    SchemaCommand.migrate(connection, "upgrade");
                    assertThat(flyway.migrate().migrationsExecuted).isZero();
                    SchemaCommand.assertLegacySchema(connection);
                    try (var statement = connection.createStatement();
                            var result =
                                    statement.executeQuery(
                                            "SELECT EncryptedContent FROM dbo.ChatMessages")) {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getNString(1)).isEqualTo("Legacy plaintext must survive");
                    }
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
                    INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (@group,1,0,1,3,SYSDATETIMEOFFSET()),(@direct,0,0,1,0,SYSDATETIMEOFFSET());
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
                    assertThat(count(connection, "messaging.MembershipIntervals")).isEqualTo(2);
                    assertThat(count(connection, "messaging.DirectPairs")).isEqualTo(1);
                });
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
