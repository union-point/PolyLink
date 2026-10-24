package am.polylink.forum;

import am.polylink.auth.Rows;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import tools.jackson.databind.json.JsonMapper;

/** Offline, migration-credential-only review. Never exposed as an HTTP operation. */
public final class ForumMaintenanceCommand {
    private ForumMaintenanceCommand() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 1)
            throw new IllegalArgumentException(
                    "inspect | dry-run file.json | apply file.json | takedown-topic id operator reason");
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
                System.out.println(
                        JsonMapper.builder()
                                .build()
                                .writeValueAsString(
                                        Map.of(
                                                "topics",
                                                Rows.query(
                                                        db,
                                                        "SELECT TopicId,Title,CategoryId,CreatedAt,CreatedAtUtc FROM dbo.ForumTopics ORDER BY TopicId"),
                                                "replies",
                                                Rows.query(
                                                        db,
                                                        "SELECT ReplyId,TopicId,CreatedAt,CreatedAtUtc FROM dbo.ForumReplies ORDER BY ReplyId"))));
            } else if (Set.of("dry-run", "apply").contains(args[0]) && args.length == 2) {
                var review =
                        JsonMapper.builder()
                                .build()
                                .readValue(Files.readString(Path.of(args[1])), Map.class);
                review(connection, review, args[0].equals("apply"));
            } else if (args[0].equals("takedown-topic") && args.length == 4) {
                takedown(connection, Integer.parseInt(args[1]), args[2], args[3]);
            } else throw new IllegalArgumentException("Invalid maintenance arguments");
        }
    }

    public static void review(Connection connection, Map<?, ?> input, boolean apply)
            throws Exception {
        if (!input.keySet().equals(Set.of("operator", "timezone", "topics")))
            throw new IllegalArgumentException("Require operator, timezone and topics");
        String operator = text(input.get("operator"), 100);
        ZoneId zone = ZoneId.of(text(input.get("timezone"), 100));
        if (!(input.get("topics") instanceof Map<?, ?> mapping))
            throw new IllegalArgumentException("topics must map topic IDs to category codes");
        boolean auto = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try {
            var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
            var topics =
                    Rows.query(
                            db,
                            "SELECT TopicId,CreatedAt FROM dbo.ForumTopics WITH(UPDLOCK,HOLDLOCK) WHERE CategoryId IS NULL OR CreatedAtUtc IS NULL");
            var replies =
                    Rows.query(
                            db,
                            "SELECT ReplyId,CreatedAt FROM dbo.ForumReplies WITH(UPDLOCK,HOLDLOCK) WHERE CreatedAtUtc IS NULL");
            var expected = new HashSet<String>();
            for (var row : topics) expected.add(row.get("TopicId").toString());
            if (!expected.equals(mapping.keySet()))
                throw new IllegalArgumentException(
                        "Mapping must cover exactly the topics requiring review: " + expected);
            for (var row : topics) {
                int id = ((Number) row.get("TopicId")).intValue();
                var codes =
                        db.queryForList(
                                "SELECT CategoryId FROM dbo.ForumCategories WHERE Code=?",
                                Integer.class,
                                mapping.get("" + id));
                if (codes.size() != 1)
                    throw new IllegalArgumentException("Unknown category for topic " + id);
                var utc = utc(row.get("CreatedAt"), zone);
                db.update(
                        "UPDATE dbo.ForumTopics SET CategoryId=?,CreatedAtUtc=? WHERE TopicId=?",
                        codes.getFirst(),
                        utc,
                        id);
                audit(db, "topic", id, row.get("CreatedAt"), zone, operator);
            }
            for (var row : replies) {
                int id = ((Number) row.get("ReplyId")).intValue();
                db.update(
                        "UPDATE dbo.ForumReplies SET CreatedAtUtc=? WHERE ReplyId=?",
                        utc(row.get("CreatedAt"), zone),
                        id);
                audit(db, "reply", id, row.get("CreatedAt"), zone, operator);
            }
            if (apply) connection.commit();
            else connection.rollback();
            System.out.println(
                    (apply ? "Applied" : "Validated dry-run")
                            + ": "
                            + topics.size()
                            + " topics, "
                            + replies.size()
                            + " replies");
        } catch (Exception e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(auto);
        }
    }

    private static OffsetDateTime utc(Object value, ZoneId zone) {
        var local = ((Timestamp) value).toLocalDateTime();
        var offsets = zone.getRules().getValidOffsets(local);
        if (offsets.size() != 1)
            throw new IllegalArgumentException("Ambiguous/nonexistent historical time: " + local);
        return local.atOffset(offsets.getFirst()).withOffsetSameInstant(ZoneOffset.UTC);
    }

    private static void audit(
            JdbcTemplate db, String kind, int id, Object original, ZoneId zone, String operator) {
        db.update(
                "INSERT forum.LegacyReview(Kind,RecordId,OriginalCreatedAt,SourceTimezone,Operator,ReviewedAt) VALUES (?,?,?,?,?,?)",
                kind,
                id,
                original,
                zone.getId(),
                operator,
                OffsetDateTime.now(ZoneOffset.UTC));
    }

    private static String text(Object value, int max) {
        if (!(value instanceof String s) || s.isBlank() || s.length() > max)
            throw new IllegalArgumentException("Invalid review metadata");
        return s.strip();
    }

    public static void takedown(Connection connection, int topic, String operator, String reason)
            throws Exception {
        text(operator, 100);
        text(reason, 1000);
        boolean auto = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try {
            var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
            if (db.queryForList(
                            "SELECT TopicId FROM dbo.ForumTopics WITH(UPDLOCK,HOLDLOCK) WHERE TopicId=?",
                            topic)
                    .isEmpty()) throw new IllegalArgumentException("Topic not found");
            int count =
                    db.queryForObject(
                            "SELECT COUNT(*) FROM dbo.ForumReplies WHERE TopicId=?",
                            Integer.class,
                            topic);
            db.update(
                    "INSERT forum.Takedowns(TopicId,Operator,Reason,RemovedAt,ReplyCount) VALUES (?,?,?,?,?)",
                    topic,
                    operator,
                    reason,
                    OffsetDateTime.now(ZoneOffset.UTC),
                    count);
            deleteTopic(db, topic);
            connection.commit();
        } catch (Exception e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(auto);
        }
    }

    static void deleteTopic(JdbcTemplate db, int topic) {
        db.update(
                "DELETE auth.ActivityNotifications WHERE Kind='FORUM_REPLY' AND TopicId=?", topic);
        db.update(
                "DELETE l FROM dbo.ForumReplyLikes l JOIN dbo.ForumReplies r ON r.ReplyId=l.ReplyId WHERE r.TopicId=?",
                topic);
        db.update("DELETE dbo.ForumReplies WHERE TopicId=?", topic);
        db.update("DELETE dbo.ForumTopics WHERE TopicId=?", topic);
    }
}
