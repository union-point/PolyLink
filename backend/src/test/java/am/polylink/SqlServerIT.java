package am.polylink;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Properties;
import org.junit.jupiter.api.Test;

class SqlServerIT {

    @Test
    void connectsToSqlServerAndPreservesUnicodeAndTransactionRollback() throws Exception {
        var local = new Properties();
        var config = Path.of("config/application-local.properties");
        if (Files.exists(config)) {
            try (var reader = Files.newBufferedReader(config)) {
                local.load(reader);
            }
        }
        var password = System.getenv("DB_PASSWORD");
        if (password == null || password.isBlank()) {
            password = local.getProperty("spring.datasource.password");
        }
        assertThat(password)
                .as("Set DB_PASSWORD or configure config/application-local.properties")
                .isNotBlank();

        var database = env("DB_NAME", "polylink");
        var url =
                "jdbc:sqlserver://"
                        + env("DB_HOST", "localhost")
                        + ":"
                        + env("DB_PORT", local.getProperty("DB_PORT", "1433"));
        var properties = new Properties();
        properties.setProperty("databaseName", database);
        properties.setProperty("user", env("DB_USERNAME", "sa"));
        properties.setProperty("password", password);
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate", env("DB_TRUST_SERVER_CERTIFICATE", "true"));
        properties.setProperty("loginTimeout", "10");

        try (var connection = DriverManager.getConnection(url, properties);
                var statement = connection.createStatement()) {
            try (var result = statement.executeQuery("SELECT DB_NAME()")) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1)).isEqualTo(database);
            }
            // Session-local table; the restored application's schema stays untouched.
            statement.execute("CREATE TABLE #ScaffoldProbe (value nvarchar(100) NOT NULL)");
            connection.setAutoCommit(false);
            try (var insert =
                    connection.prepareStatement("INSERT INTO #ScaffoldProbe VALUES (?)")) {
                insert.setNString(1, "PolyLink տվյալներ");
                insert.executeUpdate();
            }
            try (var result = statement.executeQuery("SELECT value FROM #ScaffoldProbe")) {
                assertThat(result.next()).isTrue();
                assertThat(result.getNString(1)).isEqualTo("PolyLink տվյալներ");
            }
            connection.rollback();
            try (var result = statement.executeQuery("SELECT COUNT(*) FROM #ScaffoldProbe")) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isZero();
            }
            connection.rollback();
        }
    }

    private static String env(String name, String fallback) {
        return System.getenv().getOrDefault(name, fallback);
    }
}
