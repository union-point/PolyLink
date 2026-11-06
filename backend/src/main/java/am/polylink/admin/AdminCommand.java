package am.polylink.admin;

import am.polylink.auth.Accounts;
import am.polylink.auth.Secrets;
import java.net.URI;
import java.security.SecureRandom;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/** Offline admin custody. No public invitation, cancellation or re-enable endpoint. */
public final class AdminCommand {
    private AdminCommand() {}

    public record Invitation(String token, OffsetDateTime expiresAt) {
        @Override
        public String toString() {
            return "AdminInvitation[redacted]";
        }
    }

    public static String email(String input) {
        if (input == null) throw new IllegalArgumentException("Supply an email address");
        String value = Accounts.email(input);
        if (value.length() > 255 || !value.matches("[^@\\s]+@[^@\\s.]+(?:\\.[^@\\s.]+)+"))
            throw new IllegalArgumentException("Supply a valid email address");
        return value;
    }

    /** Caller owns the transaction so account creation and local commands share lock ordering. */
    public static Invitation invite(Connection connection, String address, Clock clock)
            throws SQLException {
        requireTransaction(connection);
        String email = email(address);
        var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
        if (!db.queryForList(
                        "SELECT AdminId FROM admin.Admins WITH(UPDLOCK,HOLDLOCK) WHERE Email=?",
                        email)
                .isEmpty())
            throw new IllegalArgumentException("An admin identity already exists for this email");
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        String token = Secrets.encode(random);
        var now = OffsetDateTime.now(clock).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        db.update(
                "INSERT admin.Invitations(InvitationId,TokenHash,Email,CreatedAt,ExpiresAt) VALUES (?,?,?,?,?)",
                UUID.randomUUID(),
                Secrets.hash(token),
                email,
                now,
                now.plusHours(24));
        return new Invitation(token, now.plusHours(24));
    }

    public static void disable(Connection connection, int id, Clock clock) throws SQLException {
        requireTransaction(connection);
        if (id < 1) throw new IllegalArgumentException("Supply a positive admin ID");
        var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
        if (db.queryForList(
                        "SELECT AdminId FROM admin.Admins WITH(UPDLOCK,HOLDLOCK) WHERE AdminId=?",
                        id)
                .isEmpty()) throw new IllegalArgumentException("Admin identity does not exist");
        var now = OffsetDateTime.now(clock);
        db.update(
                "UPDATE admin.Admins SET Enabled=0,SessionVersion=CASE WHEN Enabled=1 THEN SessionVersion+1 ELSE SessionVersion END WHERE AdminId=?",
                id);
        db.update(
                "UPDATE admin.Sessions SET RevokedAt=COALESCE(RevokedAt,?) WHERE AdminId=?",
                now,
                id);
        db.update(
                "UPDATE admin.Challenges SET ConsumedAt=COALESCE(ConsumedAt,?) WHERE AdminId=?",
                now,
                id);
    }

    private static void requireTransaction(Connection connection) throws SQLException {
        if (connection.getAutoCommit())
            throw new IllegalStateException("An explicit transaction is required");
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2 || !Set.of("invite", "disable").contains(args[0]))
            throw new IllegalArgumentException("Use: invite EMAIL | disable ADMIN_ID");
        String registration =
                args[0].equals("invite")
                        ? registrationUrl(required("ADMIN_REGISTRATION_URL"))
                        : null;
        var properties = new Properties();
        properties.setProperty("databaseName", required("DB_NAME"));
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
            try {
                if (registration != null) {
                    var invitation = invite(connection, args[1], Clock.systemUTC());
                    connection.commit();
                    System.out.println(registration + "#invite=" + invitation.token());
                    System.out.println("Expires at " + invitation.expiresAt().toInstant());
                } else {
                    disable(connection, Integer.parseInt(args[1]), Clock.systemUTC());
                    connection.commit();
                    System.out.println("Admin access disabled.");
                }
            } catch (Exception failure) {
                connection.rollback();
                throw failure;
            }
        }
    }

    public static String registrationUrl(String value) {
        var uri = URI.create(value);
        if (uri.getHost() == null
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || !("https".equals(uri.getScheme())
                        || "http".equals(uri.getScheme())
                                && Set.of("localhost", "127.0.0.1", "[::1]")
                                        .contains(uri.getHost())))
            throw new IllegalArgumentException(
                    "Use an HTTPS registration URL (HTTP is limited to loopback)");
        return uri.toString();
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
