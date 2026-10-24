package am.polylink.auth;

import java.sql.*;
import java.util.*;

/** Offline, audited maintenance. This command can never admit a never-admitted account. */
public final class AdmissionCommand {
    private AdmissionCommand() {}

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("invite"))
            throw new IllegalArgumentException("Invitations are retired. Use registry enrollment.");
        boolean readmit = args.length == 3 && args[0].equals("readmit");
        boolean correct =
                args.length == 5
                        && args[0].equals("correct")
                        && Set.of("graduate", "lecturer").contains(args[2]);
        if (!readmit && !correct)
            throw new IllegalArgumentException(
                    "Use: readmit userId operator | correct userId graduate|lecturer registryId operator");
        int user = Integer.parseInt(args[1]);
        String actor = args[args.length - 1].strip();
        if (user < 1 || actor.isEmpty() || actor.length() > 200)
            throw new IllegalArgumentException("Supply a user and operator identity");
        var properties = new Properties();
        properties.setProperty("databaseName", required("DB_NAME"));
        properties.setProperty("user", required("MIGRATION_DB_USERNAME"));
        properties.setProperty("password", required("MIGRATION_DB_PASSWORD"));
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
            connection.setAutoCommit(false);
            var db =
                    new org.springframework.jdbc.core.JdbcTemplate(
                            new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                                    connection, true));
            try {
                var rows =
                        Rows.query(
                                db,
                                "SELECT a.*,r.Name AS RoleCode FROM auth.AccountSecurity a WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Users u ON u.UserId=a.UserId JOIN dbo.Roles r ON r.RoleId=u.RoleId WHERE a.UserId=?",
                                user);
                if (rows.isEmpty()) throw AuthFailure.denied();
                var a = rows.getFirst();
                if (readmit) {
                    if (!"DEACTIVATED".equals(a.get("AdmissionStatus"))
                            || a.get("EmailVerifiedAt") == null
                            || (!Boolean.TRUE.equals(a.get("GrandfatheredAdmission"))
                                    && Rows.query(
                                                    db,
                                                    "SELECT UserId FROM auth.RegistryClaims WHERE UserId=?",
                                                    user)
                                            .isEmpty())) throw AuthFailure.denied();
                    db.update(
                            "UPDATE auth.AccountSecurity SET AdmissionStatus='ADMITTED',UpdatedAt=SYSDATETIMEOFFSET() WHERE UserId=?",
                            user);
                    db.update(
                            "INSERT auth.RegistryClaimAudit(UserId,Action,Actor) VALUES (?,'READMIT',?)",
                            user,
                            actor);
                } else {
                    if (!Set.of("ADMITTED", "DEACTIVATED").contains(a.get("AdmissionStatus"))
                            || !args[2].equals(a.get("RoleCode"))
                            || Rows.query(
                                            db,
                                            "SELECT UserId FROM auth.RegistryClaims WITH(UPDLOCK,HOLDLOCK) WHERE UserId=?",
                                            user)
                                    .isEmpty()) throw AuthFailure.denied();
                    int registry = Integer.parseInt(args[3]);
                    db.update(
                            "INSERT auth.RegistryClaimAudit(UserId,AlumniRegistryId,LecturerRegistryId,Action,Actor) SELECT UserId,AlumniRegistryId,LecturerRegistryId,'CORRECT_OLD',? FROM auth.RegistryClaims WHERE UserId=?",
                            actor,
                            user);
                    db.update(
                            "UPDATE auth.RegistryClaims SET AlumniRegistryId=?,LecturerRegistryId=?,VerifiedAt=SYSDATETIMEOFFSET() WHERE UserId=?",
                            args[2].equals("graduate") ? registry : null,
                            args[2].equals("lecturer") ? registry : null,
                            user);
                    db.update(
                            "INSERT auth.RegistryClaimAudit(UserId,AlumniRegistryId,LecturerRegistryId,Action,Actor) SELECT UserId,AlumniRegistryId,LecturerRegistryId,'CORRECT_NEW',? FROM auth.RegistryClaims WHERE UserId=?",
                            actor,
                            user);
                }
                connection.commit();
            } catch (Exception failure) {
                connection.rollback();
                throw failure;
            }
        }
        System.out.println("Audited registry maintenance completed.");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
