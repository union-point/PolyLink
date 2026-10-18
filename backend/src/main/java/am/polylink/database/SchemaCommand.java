package am.polylink.database;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;
import org.flywaydb.core.Flyway;
import tools.jackson.databind.json.JsonMapper;

/** Explicit offline migration entry point. Never invoked by application startup. */
public final class SchemaCommand {
    private SchemaCommand() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 1
                || !java.util.Set.of("inventory", "fresh", "upgrade").contains(args[0])) {
            throw new IllegalArgumentException("Use inventory, fresh or upgrade");
        }
        String database = required("DB_NAME");
        // Properties keep credentials and database names out of JDBC URL interpolation/logging.
        var properties = new Properties();
        properties.setProperty("databaseName", database);
        properties.setProperty("user", required("MIGRATION_DB_USERNAME"));
        properties.setProperty("password", required("MIGRATION_DB_PASSWORD"));
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate",
                System.getenv().getOrDefault("DB_TRUST_SERVER_CERTIFICATE", "false"));
        properties.setProperty("loginTimeout", "10");
        String url =
                "jdbc:sqlserver://"
                        + System.getenv().getOrDefault("DB_HOST", "localhost")
                        + ":"
                        + System.getenv().getOrDefault("DB_PORT", "1433");
        try (var connection = DriverManager.getConnection(url, properties)) {
            if (args[0].equals("inventory")) {
                System.out.println(inventory(connection));
                return;
            }
            migrate(connection, args[0]);
        }
    }

    public static void migrate(Connection connection, String mode) throws Exception {
        if (!java.util.Set.of("fresh", "upgrade").contains(mode)) {
            throw new IllegalArgumentException("Use fresh or upgrade");
        }
        var flyway =
                migrations(
                        new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                                connection, true));
        boolean history = exists(connection, "dbo", "flyway_schema_history");
        if (mode.equals("fresh")) {
            if (tableCount(connection) != 0 || !inventory(connection).equals("{}")) {
                throw new IllegalStateException("Fresh installation requires an empty database");
            }
        } else {
            assertLegacySchema(connection);
            if (!history) {
                if (tableCount(connection) != 27) {
                    throw new IllegalStateException("Unrecognized objects: upgrade refused");
                }
                flyway.baseline();
            }
        }
        flyway.migrate();
        flyway.validate();
        System.out.println("Schema migrated and validated; application data was not imported.");
    }

    public static String inventory(Connection connection) throws Exception {
        try (var statement = connection.createStatement();
                var result = statement.executeQuery(resource("db/inventory/legacy-schema.sql"))) {
            var output = new StringBuilder();
            while (result.next()) {
                output.append(result.getString(1));
            }
            return output.toString();
        }
    }

    public static void assertLegacySchema(Connection connection) throws Exception {
        var mapper = JsonMapper.builder().build();
        var expected = mapper.readTree(resource("db/inventory/legacy-schema.json"));
        var actual = mapper.readTree(inventory(connection));
        if (!expected.equals(actual)) {
            throw new IllegalStateException(
                    "Legacy schema differs from the inspected baseline; inventory and review required");
        }
    }

    public static Flyway migrations(javax.sql.DataSource source) {
        return Flyway.configure()
                .dataSource(source)
                .locations("classpath:db/migration")
                .schemas("dbo")
                .baselineOnMigrate(false)
                .baselineVersion("1")
                .cleanDisabled(true)
                .load();
    }

    private static boolean exists(Connection connection, String schema, String table)
            throws SQLException {
        try (var result =
                connection.getMetaData().getTables(null, schema, table, new String[] {"TABLE"})) {
            return result.next();
        }
    }

    private static int tableCount(Connection connection) throws SQLException {
        try (var statement = connection.createStatement();
                var result =
                        statement.executeQuery(
                                "SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0")) {
            result.next();
            return result.getInt(1);
        }
    }

    private static String resource(String name) throws Exception {
        try (var stream = SchemaCommand.class.getClassLoader().getResourceAsStream(name)) {
            if (stream == null) throw new IllegalStateException("Missing schema resource: " + name);
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
