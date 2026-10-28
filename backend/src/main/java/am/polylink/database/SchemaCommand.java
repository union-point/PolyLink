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
        if ((args.length != 1 && args.length != 2)
                || !java.util.Set.of("inventory", "fresh", "upgrade").contains(args[0])) {
            throw new IllegalArgumentException(
                    "Use inventory, fresh or upgrade [--target=12|--target=18]");
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
            if (args.length == 2
                    && !java.util.Set.of("--target=12", "--target=18").contains(args[1]))
                throw new IllegalArgumentException(
                        "Use --target=12 for forum review or --target=18 for posts review");
            migrate(connection, args[0], args.length == 2 ? args[1].substring(9) : null);
        }
    }

    public static void migrate(Connection connection, String mode) throws Exception {
        migrate(connection, mode, null);
    }

    public static void migrate(Connection connection, String mode, String target) throws Exception {
        if (!java.util.Set.of("fresh", "upgrade").contains(mode)) {
            throw new IllegalArgumentException("Use fresh or upgrade");
        }
        var flyway =
                migrations(
                        new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                                connection, true),
                        target);
        boolean history = exists(connection, "dbo", "flyway_schema_history");
        if (mode.equals("fresh")) {
            if (tableCount(connection) != 0 || !inventory(connection).equals("{}")) {
                throw new IllegalStateException("Fresh installation requires an empty database");
            }
        } else {
            assertSchema(connection, history ? appliedVersion(connection) : 1);
            if (!history) {
                if (tableCount(connection) != 27) {
                    throw new IllegalStateException("Unrecognized objects: upgrade refused");
                }
                flyway.baseline();
            }
        }
        flyway.migrate();
        flyway.validate();
        assertCurrentSchema(connection);
        System.out.println(
                "Schema migrated and validated through V" + appliedVersion(connection) + ".");
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
        assertSchema(connection, 1);
    }

    public static void assertCurrentSchema(Connection connection) throws Exception {
        assertSchema(connection, appliedVersion(connection));
    }

    private static int appliedVersion(Connection connection) throws SQLException {
        try (var statement = connection.createStatement();
                var result =
                        statement.executeQuery(
                                "SELECT MAX(TRY_CONVERT(int,version)) FROM dbo.flyway_schema_history WHERE success=1")) {
            result.next();
            return result.getInt(1);
        }
    }

    private static void assertSchema(Connection connection, int version) throws Exception {
        var mapper = JsonMapper.builder().build();
        if (version >= 12) {
            var expectedForum =
                    mapper.readTree(
                            resource(
                                    "db/inventory/forum-schema-v"
                                            + (version >= 13 ? 13 : 12)
                                            + ".json"));
            if (version >= 14) {
                for (var table : expectedForum.path("tables"))
                    if (table.path("name").asText().equals("LecturerRegistry")) {
                        var columns = (tools.jackson.databind.node.ArrayNode) table.path("columns");
                        for (String name : java.util.List.of("FirstName", "LastName"))
                            columns.add(
                                    mapper.readTree(
                                            "{\"name\":\""
                                                    + name
                                                    + "\",\"type\":\"nvarchar\",\"maxLength\":200,\"precision\":0,\"scale\":0,\"nullable\":true,\"collation\":\"SQL_Latin1_General_CP1_CI_AS\"}"));
                    }
            }
            if (version >= 16) {
                var tables = (tools.jackson.databind.node.ArrayNode) expectedForum.path("tables");
                for (int i = tables.size() - 1; i >= 0; i--)
                    if (tables.get(i).path("name").asText().equals("AlumniRegistry_Import"))
                        tables.remove(i);
            }
            if (version >= 17) {
                for (var table : expectedForum.path("tables"))
                    if (table.path("name").asText().equals("Education"))
                        for (var column : table.path("columns"))
                            if (column.path("name").asText().equals("DegreeId"))
                                ((tools.jackson.databind.node.ObjectNode) column)
                                        .put("nullable", true);
            }
            if (version >= 18) {
                var replacements = mapper.readTree(resource("db/inventory/posts-schema-v18.json"));
                var tables = (tools.jackson.databind.node.ArrayNode) expectedForum.path("tables");
                for (int i = 0; i < tables.size(); i++) {
                    var replacement = replacements.get(tables.get(i).path("name").asText());
                    if (replacement != null) tables.set(i, replacement.deepCopy());
                }
                if (version >= 19) {
                    for (var table : tables) {
                        String name = table.path("name").asText();
                        if (!java.util.Set.of("Posts", "PostComments").contains(name)) continue;
                        for (var column : table.path("columns"))
                            if (column.path("name").asText().equals("CreatedAtUtc"))
                                ((tools.jackson.databind.node.ObjectNode) column)
                                        .put("nullable", false);
                        var additions =
                                mapper.readTree(resource("db/inventory/posts-indexes-v19.json"))
                                        .get(name);
                        var indexes = (tools.jackson.databind.node.ArrayNode) table.path("indexes");
                        var sorted =
                                new java.util.TreeMap<String, tools.jackson.databind.JsonNode>();
                        for (var index : indexes) sorted.put(index.path("name").asText(), index);
                        for (var index : additions) sorted.put(index.path("name").asText(), index);
                        indexes.removeAll();
                        sorted.values().forEach(indexes::add);
                    }
                }
            }
            if (version >= 18) assertPostsAuxiliarySchema(connection);
            if (!expectedForum.equals(mapper.readTree(inventory(connection))))
                throw new IllegalStateException(
                        "Schema differs from the inspected baseline; reviewed forum inventory required");
            return;
        }
        var expected = mapper.readTree(resource("db/inventory/legacy-schema.json"));
        if (version >= 8) {
            var tables = (tools.jackson.databind.node.ArrayNode) expected.path("tables");
            for (int i = tables.size() - 1; i >= 0; i--) {
                if (java.util.Set.of("ChatMessages", "ChatParticipants", "ChatRooms")
                        .contains(tables.get(i).path("name").asText())) tables.remove(i);
            }
        }
        if (version >= 9) {
            for (var table : expected.path("tables")) {
                if (table.path("name").asText().equals("Users")) {
                    var columns = (tools.jackson.databind.node.ArrayNode) table.path("columns");
                    for (int i = columns.size() - 1; i >= 0; i--) {
                        if (java.util.Set.of("PasswordHash", "TwoFactorEnabled")
                                .contains(columns.get(i).path("name").asText())) columns.remove(i);
                    }
                }
            }
        }
        if (version >= 10) {
            for (var table : expected.path("tables")) {
                if (table.path("name").asText().equals("Users")) {
                    ((tools.jackson.databind.node.ArrayNode) table.path("columns"))
                            .add(
                                    mapper.readTree(
                                            "{\"name\":\"ShowEmail\",\"type\":\"bit\",\"maxLength\":1,\"precision\":1,\"scale\":0,\"nullable\":false,\"defaultName\":\"DF_Users_ShowEmail\",\"defaultDefinition\":\"((0))\"}"));
                }
                if (table.path("name").asText().equals("UserNotificationSettings")) {
                    for (var column : table.path("columns"))
                        ((tools.jackson.databind.node.ObjectNode) column).put("nullable", false);
                }
            }
        }
        var actual = mapper.readTree(inventory(connection));
        if (!expected.equals(actual)) {
            throw new IllegalStateException(
                    "Legacy schema differs from the inspected baseline; inventory and review required");
        }
    }

    private static void assertPostsAuxiliarySchema(Connection connection) throws Exception {
        var db =
                new org.springframework.jdbc.core.JdbcTemplate(
                        new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                                connection, true));
        int targets =
                db.queryForObject(
                        "SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'auth.ActivityNotifications') AND name IN ('PostId','CommentId') AND TYPE_NAME(user_type_id)='int' AND is_nullable=1",
                        Integer.class);
        int review =
                db.queryForObject(
                        "SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'auth.PostsLegacyReview')",
                        Integer.class);
        int reviewColumns =
                db.queryForObject(
                        "SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'auth.PostsLegacyReview') AND is_nullable=0 AND ((name='Kind' AND TYPE_NAME(user_type_id)='varchar' AND max_length=8) OR (name='RecordId' AND TYPE_NAME(user_type_id)='int') OR (name='OriginalCreatedAt' AND TYPE_NAME(user_type_id)='datetime2' AND scale=7) OR (name IN ('SourceTimezone','Operator') AND TYPE_NAME(user_type_id)='nvarchar' AND max_length=200) OR (name='ReviewedAt' AND TYPE_NAME(user_type_id)='datetimeoffset' AND scale=7))",
                        Integer.class);
        if (targets != 2 || review != 6 || reviewColumns != 6)
            throw new IllegalStateException("Posts auxiliary inventory differs; review required");
        var definitions =
                db.queryForList(
                        "SELECT definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'auth.ActivityNotifications') AND name='CK_ActivityNotifications_Kind' AND is_disabled=0 AND is_not_trusted=0",
                        String.class);
        if (definitions.size() != 1)
            throw new IllegalStateException("Posts notification kind guard missing");
        var actual =
                new java.util.HashSet<>(
                        java.util.Arrays.asList(
                                definitions
                                        .getFirst()
                                        .replaceAll("[()\\[\\]]", "")
                                        .replaceAll("\\s+", " ")
                                        .split(" OR ")));
        if (!actual.equals(
                java.util.Set.of(
                        "Kind='DIRECT_MESSAGE'",
                        "Kind='ANNOUNCEMENT'",
                        "Kind='FORUM_REPLY'",
                        "Kind='POST_COMMENT'")))
            throw new IllegalStateException("Posts notification kinds differ; review required");
        for (var index :
                java.util.Map.of(
                                "IX_ActivityNotifications_Post",
                                "PostId,CommentId",
                                "UX_ActivityNotifications_Comment",
                                "UserId,CommentId",
                                "IX_ActivityNotifications_History",
                                "UserId,Id")
                        .entrySet()) {
            var columns =
                    db.queryForList(
                            "SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(N'auth.ActivityNotifications') AND i.name=? AND i.is_disabled=0 AND ic.key_ordinal>0 ORDER BY ic.key_ordinal",
                            String.class,
                            index.getKey());
            if (!String.join(",", columns).equals(index.getValue()))
                throw new IllegalStateException("Posts activity index differs: " + index.getKey());
        }
        if (db.queryForObject(
                        "SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'auth.ActivityNotifications') AND name='UX_ActivityNotifications_Comment' AND is_unique=1 AND filter_definition=N'([Kind]=''POST_COMMENT'')'",
                        Integer.class)
                != 1) throw new IllegalStateException("Posts unique event guard differs");
    }

    public static Flyway migrations(javax.sql.DataSource source) {
        return migrations(source, null);
    }

    public static Flyway migrations(javax.sql.DataSource source, String target) {
        var configuration =
                Flyway.configure()
                        .dataSource(source)
                        .locations("classpath:db/migration")
                        .schemas("dbo")
                        .baselineOnMigrate(false)
                        .baselineVersion("1")
                        .cleanDisabled(true);
        if (target != null) configuration.target(target);
        return configuration.load();
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
