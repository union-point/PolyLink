package am.polylink.auth;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Call inside a transaction: registry primary row first, then its claim key/range. */
public final class RegistryLinks {
    private RegistryLinks() {}

    public static Map<String, Object> lock(JdbcTemplate db, boolean lecturer, int id) {
        String table = lecturer ? "LecturerRegistry" : "AlumniRegistry";
        String key = lecturer ? "LecturerRegistryId" : "AlumniRegistryId";
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM dbo."
                                + table
                                + " WITH(UPDLOCK,HOLDLOCK) WHERE "
                                + key
                                + "=?",
                        id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public static List<Map<String, Object>> claims(JdbcTemplate db, boolean lecturer, int id) {
        String key = lecturer ? "LecturerRegistryId" : "AlumniRegistryId";
        return Rows.query(
                db,
                "SELECT UserId FROM auth.RegistryClaims WITH(UPDLOCK,HOLDLOCK) WHERE " + key + "=?",
                id);
    }
}
