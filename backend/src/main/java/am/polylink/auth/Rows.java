package am.polylink.auth;

import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

public final class Rows {
    private Rows() {}

    public static List<Map<String, Object>> query(JdbcTemplate db, String sql, Object... args) {
        return db.query(
                sql,
                (rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    var metadata = rs.getMetaData();
                    for (int i = 1; i <= metadata.getColumnCount(); i++)
                        row.put(
                                metadata.getColumnLabel(i),
                                metadata.getColumnTypeName(i).equalsIgnoreCase("datetimeoffset")
                                        ? rs.getObject(i, OffsetDateTime.class)
                                        : rs.getObject(i));
                    return row;
                },
                args);
    }
}
