package am.polylink.database;

import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.util.Properties;

/** Explicit, one-shot seed for an empty, migrated disposable database. */
public final class TestSeedCommand {
    private TestSeedCommand() {}

    public static void main(String[] args) throws Exception {
        String database = required("DB_NAME");
        if (args.length != 1 || !args[0].equals(database))
            throw new IllegalArgumentException("Pass the exact DB_NAME as the only argument");
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
            connection.setAutoCommit(false);
            connection.setTransactionIsolation(java.sql.Connection.TRANSACTION_SERIALIZABLE);
            try (var statement = connection.createStatement()) {
                try (var result =
                        statement.executeQuery(
                                "SELECT DB_NAME(), (SELECT MAX(TRY_CONVERT(int,version)) FROM dbo.flyway_schema_history WHERE success=1)")) {
                    if (!result.next()
                            || !database.equals(result.getString(1))
                            || result.getInt(2) != 21)
                        throw new IllegalStateException(
                                "Expected the named database migrated through V21");
                }
                for (String table :
                        java.util.List.of(
                                "Users",
                                "AlumniRegistry",
                                "LecturerRegistry",
                                "Institutes",
                                "Specializations",
                                "Departments",
                                "Professions",
                                "Degrees")) {
                    try (var result =
                            statement.executeQuery(
                                    "SELECT COUNT(*) FROM dbo."
                                            + table
                                            + " WITH (TABLOCKX, HOLDLOCK)")) {
                        result.next();
                        if (result.getLong(1) != 0)
                            throw new IllegalStateException(table + " must be empty");
                    }
                }
                try (var result =
                        statement.executeQuery(
                                "SELECT COUNT(*) FROM dbo.Spheres WITH (TABLOCKX, HOLDLOCK) WHERE Code <> 'other'")) {
                    result.next();
                    if (result.getLong(1) != 0)
                        throw new IllegalStateException("Spheres must contain only migration data");
                }
                try (var stream =
                        TestSeedCommand.class
                                .getClassLoader()
                                .getResourceAsStream("db/test-seed/armenian.sql")) {
                    if (stream == null)
                        throw new IllegalStateException("Missing test seed resource");
                    statement.execute(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
                }
                connection.commit();
                System.out.println("Synthetic Armenian test data inserted into " + database + ".");
            } catch (Exception e) {
                connection.rollback();
                throw e;
            }
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
