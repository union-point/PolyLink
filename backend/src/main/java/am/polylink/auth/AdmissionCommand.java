package am.polylink.auth;

import java.sql.*;
import java.time.*;
import java.util.*;

/** Operator-only CLI. Email approval never bypasses mailbox verification. */
public final class AdmissionCommand {
    private AdmissionCommand() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 3
                || !args[0].equals("invite")
                || !Set.of("graduate", "lecturer").contains(args[2])
                || !args[1].matches("[^@\\s]+@[^@\\s]+\\.[^@\\s]+"))
            throw new IllegalArgumentException("Use: invite email graduate|lecturer");
        var properties = new Properties();
        properties.setProperty("databaseName", required("DB_NAME"));
        properties.setProperty("user", required("MIGRATION_DB_USERNAME"));
        properties.setProperty("password", required("MIGRATION_DB_PASSWORD"));
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate",
                System.getenv().getOrDefault("DB_TRUST_SERVER_CERTIFICATE", "false"));
        String url =
                "jdbc:sqlserver://"
                        + System.getenv().getOrDefault("DB_HOST", "localhost")
                        + ":"
                        + System.getenv().getOrDefault("DB_PORT", "1433");
        try (var connection = DriverManager.getConnection(url, properties)) {
            connection.setAutoCommit(false);
            try (var revoke =
                            connection.prepareStatement(
                                    "UPDATE auth.Invitations WITH(UPDLOCK,HOLDLOCK) SET RevokedAt=? WHERE Email=? AND ConsumedUserId IS NULL AND RevokedAt IS NULL");
                    var insert =
                            connection.prepareStatement(
                                    "INSERT auth.Invitations(InvitationId,Email,RoleCode,ExpiresAt) VALUES (?,?,?,?)")) {
                var now = OffsetDateTime.now(ZoneOffset.UTC);
                revoke.setObject(1, now);
                revoke.setNString(2, Accounts.email(args[1]));
                revoke.executeUpdate();
                insert.setObject(1, UUID.randomUUID());
                insert.setNString(2, Accounts.email(args[1]));
                insert.setString(3, args[2]);
                insert.setObject(4, now.plusDays(7));
                insert.executeUpdate();
                connection.commit();
            }
        }
        System.out.println(
                "Single-use email/role approval recorded for seven days. Mailbox verification is still required.");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
