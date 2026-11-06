package db.migration;

import am.polylink.auth.RegistryKeys;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.api.migration.*;

/** Transactional JVM backfill: preserve display data and refuse ambiguous identities. */
public class V25__registry_keys extends BaseJavaMigration {
    record Entry(int id, byte[] key, byte[] source) {}

    @Override
    public void migrate(Context context) throws Exception {
        var connection = context.getConnection();
        // Lock both tables before inspecting either, retaining the snapshot through all
        // DDL/backfill.
        try (var statement = connection.createStatement()) {
            statement.execute("SELECT COUNT(*) FROM dbo.LecturerRegistry WITH(TABLOCKX,HOLDLOCK)");
            statement.execute("SELECT COUNT(*) FROM dbo.AlumniRegistry WITH(TABLOCKX,HOLDLOCK)");
        }
        var lecturers = inspect(connection, true);
        var alumni = inspect(connection, false);
        install(connection, true, lecturers);
        install(connection, false, alumni);
    }

    private static List<Entry> inspect(Connection connection, boolean lecturer)
            throws SQLException {
        String table = lecturer ? "LecturerRegistry" : "AlumniRegistry";
        String id = lecturer ? "LecturerRegistryId" : "AlumniRegistryId";
        String field = lecturer ? "Email" : "DiplomaNumber";
        var rows = new ArrayList<Entry>();
        var seen = new HashMap<String, Integer>();
        var digests = new HashMap<String, Integer>();
        try (var statement = connection.createStatement();
                var result =
                        statement.executeQuery(
                                "SELECT "
                                        + id
                                        + ","
                                        + field
                                        + " FROM dbo."
                                        + table
                                        + " ORDER BY "
                                        + id)) {
            while (result.next()) {
                int record = result.getInt(1);
                String raw = result.getString(2);
                String key = lecturer ? RegistryKeys.email(raw) : RegistryKeys.text(raw);
                if (key.isEmpty())
                    throw new SQLException(
                            "Registry normalization review required: "
                                    + table
                                    + " empty identity at ID "
                                    + record);
                Integer previous = seen.putIfAbsent(key, record);
                if (previous != null)
                    throw new SQLException(
                            "Registry normalization collision: "
                                    + table
                                    + " IDs "
                                    + previous
                                    + " and "
                                    + record
                                    + "; resolve explicitly before retrying V25");
                byte[] digest = RegistryKeys.source(key);
                previous = digests.putIfAbsent(HexFormat.of().formatHex(digest), record);
                if (previous != null)
                    throw new SQLException(
                            "Registry digest collision: review "
                                    + table
                                    + " IDs "
                                    + previous
                                    + " and "
                                    + record);
                rows.add(new Entry(record, digest, RegistryKeys.source(raw)));
            }
        }
        return rows;
    }

    private static void install(Connection connection, boolean lecturer, List<Entry> rows)
            throws SQLException {
        String table = lecturer ? "LecturerRegistry" : "AlumniRegistry";
        String id = lecturer ? "LecturerRegistryId" : "AlumniRegistryId";
        String field = lecturer ? "Email" : "DiplomaNumber";
        String key = lecturer ? "EmailKey" : "DiplomaKey";
        try (var statement = connection.createStatement()) {
            statement.execute(
                    "ALTER TABLE dbo."
                            + table
                            + " ADD "
                            + key
                            + " binary(32) NULL,KeySourceHash binary(32) NULL,AdminVersion rowversion NOT NULL");
        }
        try (var update =
                connection.prepareStatement(
                        "UPDATE dbo."
                                + table
                                + " SET "
                                + key
                                + "=?,KeySourceHash=? WHERE "
                                + id
                                + "=?")) {
            int batch = 0;
            for (var row : rows) {
                update.setBytes(1, row.key());
                update.setBytes(2, row.source());
                update.setInt(3, row.id());
                update.addBatch();
                if (++batch % 500 == 0) update.executeBatch();
            }
            update.executeBatch();
        }
        try (var statement = connection.createStatement()) {
            statement.execute(
                    "ALTER TABLE dbo." + table + " ALTER COLUMN " + key + " binary(32) NOT NULL");
            statement.execute(
                    "ALTER TABLE dbo." + table + " ALTER COLUMN KeySourceHash binary(32) NOT NULL");
            statement.execute(
                    "ALTER TABLE dbo." + table + " DROP CONSTRAINT UQ_" + table + "_" + field);
            statement.execute(
                    "CREATE UNIQUE INDEX UX_"
                            + table
                            + "_"
                            + key
                            + " ON dbo."
                            + table
                            + "("
                            + key
                            + ")");
            statement.execute(
                    "ALTER TABLE dbo."
                            + table
                            + " ADD CONSTRAINT CK_"
                            + table
                            + "_KeySource CHECK (KeySourceHash=CONVERT(binary(32),HASHBYTES('SHA2_256',CONVERT(varbinary(max),"
                            + field
                            + "))))");
        }
    }
}
