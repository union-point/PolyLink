package am.polylink.posts;

import am.polylink.auth.Rows;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import tools.jackson.databind.json.JsonMapper;

/** Explicit offline timestamp review using migration credentials, never runtime credentials. */
public final class PostsMaintenanceCommand {
    private PostsMaintenanceCommand() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 1)
            throw new IllegalArgumentException("inspect | dry-run review.json | apply review.json");
        var properties = new Properties();
        for (var field :
                Map.of(
                                "databaseName",
                                "DB_NAME",
                                "user",
                                "MIGRATION_DB_USERNAME",
                                "password",
                                "MIGRATION_DB_PASSWORD")
                        .entrySet()) {
            var value = System.getenv(field.getValue());
            if (value == null || value.isBlank())
                throw new IllegalArgumentException("Set " + field.getValue());
            properties.setProperty(field.getKey(), value);
        }
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate",
                System.getenv().getOrDefault("DB_TRUST_SERVER_CERTIFICATE", "false"));
        try (var connection =
                DriverManager.getConnection(
                        "jdbc:sqlserver://"
                                + System.getenv().getOrDefault("DB_HOST", "localhost")
                                + ":"
                                + System.getenv().getOrDefault("DB_PORT", "1433"),
                        properties)) {
            var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));

            if (args[0].equals("inspect") && args.length == 1) {
                requireLegacyTimestamps(connection);
                System.out.println(
                        JsonMapper.builder()
                                .build()
                                .writeValueAsString(
                                        Map.of(
                                                "posts",
                                                        Rows.query(
                                                                db,
                                                                "SELECT PostId,PostTypeId,SphereId,Title,CreatedAt,CreatedAtUtc FROM dbo.Posts ORDER BY PostId"),
                                                "comments",
                                                        Rows.query(
                                                                db,
                                                                "SELECT CommentId,PostId,CreatedAt,CreatedAtUtc FROM dbo.PostComments ORDER BY CommentId"),
                                                "types",
                                                        Rows.query(
                                                                db,
                                                                "SELECT * FROM dbo.PostTypes ORDER BY PostTypeId"),
                                                "spheres",
                                                        Rows.query(
                                                                db,
                                                                "SELECT * FROM dbo.Spheres ORDER BY SphereId"))));
            } else if (Set.of("dry-run", "apply").contains(args[0]) && args.length == 2) {
                review(
                        connection,
                        JsonMapper.builder()
                                .build()
                                .readValue(Files.readString(Path.of(args[1])), Map.class),
                        args[0].equals("apply"));
            } else throw new IllegalArgumentException("Invalid maintenance arguments");
        }
    }

    private static void requireLegacyTimestamps(Connection connection) throws SQLException {
        try (var columns = connection.getMetaData().getColumns(null, "dbo", "Posts", "CreatedAt")) {
            if (!columns.next())
                throw new IllegalStateException(
                        "Legacy timestamp review is unavailable after V20; review historical data before completing the upgrade");
        }
    }

    public static void review(Connection connection, Map<?, ?> input, boolean apply)
            throws Exception {
        requireLegacyTimestamps(connection);
        if (!input.keySet().equals(Set.of("operator", "posts", "comments"))
                || !(input.get("operator") instanceof String operator)
                || operator.isBlank()
                || operator.length() > 100)
            throw new IllegalArgumentException("Require operator, posts and comments");
        boolean auto = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try {
            var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
            reviewRows(db, "Posts", "PostId", "post", input.get("posts"), operator);
            reviewRows(db, "PostComments", "CommentId", "comment", input.get("comments"), operator);
            if (apply) connection.commit();
            else connection.rollback();
            System.out.println(
                    apply
                            ? "Applied reviewed timestamps"
                            : "Validated dry-run; no timestamps changed");
        } catch (Exception e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(auto);
        }
    }

    private static void reviewRows(
            JdbcTemplate db, String table, String key, String kind, Object value, String operator) {
        if (!(value instanceof Map<?, ?> mapping))
            throw new IllegalArgumentException("Require per-record timezone mapping");
        var rows =
                Rows.query(
                        db,
                        "SELECT "
                                + key
                                + ",CreatedAt FROM dbo."
                                + table
                                + " WITH(UPDLOCK,HOLDLOCK) WHERE CreatedAtUtc IS NULL");
        var expected = new HashSet<String>();
        for (var row : rows) expected.add(row.get(key).toString());
        if (!expected.equals(mapping.keySet()))
            throw new IllegalArgumentException(
                    "Mapping must cover exactly the " + table + " requiring review: " + expected);
        for (var row : rows) {
            String id = row.get(key).toString();
            if (!(mapping.get(id) instanceof Map<?, ?> entry)
                    || !entry.keySet().equals(Set.of("originalCreatedAt", "timezone"))
                    || !(entry.get("timezone") instanceof String timezone)
                    || timezone.length() > 100)
                throw new IllegalArgumentException(
                        "Require originalCreatedAt and timezone for " + id);
            LocalDateTime local = ((Timestamp) row.get("CreatedAt")).toLocalDateTime();
            if (!local.equals(
                    LocalDateTime.parse(Objects.toString(entry.get("originalCreatedAt"), ""))))
                throw new IllegalArgumentException("Original timestamp changed for " + id);
            ZoneId zone = ZoneId.of(timezone);
            var offsets = zone.getRules().getValidOffsets(local);
            if (offsets.size() != 1)
                throw new IllegalArgumentException(
                        "Ambiguous/nonexistent historical time; review an explicit offset for "
                                + id);
            var utc = local.atOffset(offsets.getFirst()).withOffsetSameInstant(ZoneOffset.UTC);
            db.update(
                    "UPDATE dbo." + table + " SET CreatedAtUtc=? WHERE " + key + "=?",
                    utc,
                    Integer.parseInt(id));
            db.update(
                    "INSERT auth.PostsLegacyReview(Kind,RecordId,OriginalCreatedAt,SourceTimezone,Operator,ReviewedAt) VALUES (?,?,?,?,?,?)",
                    kind,
                    Integer.parseInt(id),
                    local,
                    timezone,
                    operator,
                    OffsetDateTime.now(ZoneOffset.UTC));
        }
    }
}
