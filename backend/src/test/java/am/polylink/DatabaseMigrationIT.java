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
