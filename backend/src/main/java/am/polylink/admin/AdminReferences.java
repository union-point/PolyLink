package am.polylink.admin;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.dao.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Every mutation holds the admin account, reference and dependency range locks until commit. */
@Service
@AdminEnabled
public class AdminReferences {
    private static final int PAGE_SIZE = 50;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final AdminSessions sessions;
    private final Secrets secrets;

    public AdminReferences(
            JdbcTemplate db, TransactionTemplate tx, AdminSessions sessions, Secrets secrets) {
        this.db = db;
        this.tx = tx;
        this.sessions = sessions;
        this.secrets = secrets;
    }

    public Map<String, Object> list(
            String kind, String search, String cursor, HttpServletRequest request) {
        sessions.require(request, false);
        var resource = ReferenceCatalog.require(kind);
        String query = search == null ? "" : search.strip();
        if (query.length() > 255 || query.codePoints().anyMatch(Character::isISOControl))
            throw AdminFailure.invalid("q", "Use a search of at most 255 characters.");
        int after = decodeCursor(resource, query, cursor);
        String pattern =
                "%"
                        + query.replace("~", "~~")
                                .replace("%", "~%")
                                .replace("_", "~_")
                                .replace("[", "~[")
                        + "%";
        String filter =
                "r.Name LIKE ? ESCAPE '~'"
                        + (resource.coded() ? " OR r.Code LIKE ? ESCAPE '~'" : "");
        var args = new ArrayList<Object>(List.of(after, pattern));
        if (resource.coded()) args.add(pattern);
        var rows =
                Rows.query(
                        db,
                        "SELECT TOP(51) "
                                + projection(resource)
                                + " FROM dbo."
                                + resource.table()
                                + " r WHERE r."
                                + resource.id()
                                + ">? AND ("
                                + filter
                                + ") ORDER BY r."
                                + resource.id(),
                        args.toArray());
        boolean more = rows.size() > PAGE_SIZE;
        var items = rows.stream().limit(PAGE_SIZE).map(row -> metadata(resource, row)).toList();
        var output = new LinkedHashMap<String, Object>();
        output.put("items", items);
        output.put(
                "nextCursor",
                more
                        ? encodeCursor(
                                resource,
                                query,
                                ((Number) rows.get(PAGE_SIZE - 1).get("Id")).intValue())
                        : null);
        return output;
    }

    public Map<String, Object> detail(String kind, int id, HttpServletRequest request) {
        sessions.require(request, false);
        var resource = ReferenceCatalog.require(kind);
        return metadata(resource, row(resource, id, false));
    }

    public Map<String, Object> create(
            String kind, Map<String, Object> input, HttpServletRequest request) {
        return mutate(
                () -> {
                    sessions.require(request, true);
                    var resource = ReferenceCatalog.require(kind);
                    compatible(resource);
                    fields(input, resource.coded() ? Set.of("name", "code") : Set.of("name"));
                    String name = name(resource, input.get("name"));
                    String code = resource.coded() ? code(resource, input.get("code")) : null;
                    unique(resource, "Name", name, 0);
                    if (resource.coded()) unique(resource, "Code", code, 0);
                    int id =
                            resource.coded()
                                    ? db.queryForObject(
                                            "INSERT dbo."
                                                    + resource.table()
                                                    + "(Name,Code) OUTPUT inserted."
                                                    + resource.id()
                                                    + " VALUES (?,?)",
                                            Integer.class,
                                            name,
                                            code)
                                    : db.queryForObject(
                                            "INSERT dbo."
                                                    + resource.table()
                                                    + "(Name) OUTPUT inserted."
                                                    + resource.id()
                                                    + " VALUES (?)",
                                            Integer.class,
                                            name);
                    return metadata(resource, row(resource, id, false));
                });
    }

    public Map<String, Object> update(
            String kind, int id, Map<String, Object> input, HttpServletRequest request) {
        return mutate(
                () -> {
                    sessions.require(request, true);
                    var resource = ReferenceCatalog.require(kind);
                    fields(input, Set.of("name", "version"));
                    String name = name(resource, input.get("name"));
                    byte[] version = version(input.get("version"));
                    var current = row(resource, id, true);
                    writable(resource, current, version);
                    unique(resource, "Name", name, id);
                    db.update(
                            "UPDATE dbo."
                                    + resource.table()
                                    + " SET Name=? WHERE "
                                    + resource.id()
                                    + "=?",
                            name,
                            id);
                    return metadata(resource, row(resource, id, false));
                });
    }

    public void delete(String kind, int id, Map<String, Object> input, HttpServletRequest request) {
        mutate(
                () -> {
                    sessions.require(request, true);
                    var resource = ReferenceCatalog.require(kind);
                    fields(input, Set.of("version"));
                    byte[] version = version(input.get("version"));
                    var current = row(resource, id, true);
                    writable(resource, current, version);
                    db.update(
                            "DELETE dbo." + resource.table() + " WHERE " + resource.id() + "=?",
                            id);
                    return null;
                });
    }

    private <T> T mutate(java.util.function.Supplier<T> action) {
        try {
            return tx.execute(status -> action.get());
        } catch (DataAccessException failure) {
            // SQL Server reports lock timeout 1222 as S0051, which Spring leaves uncategorized.
            if (failure instanceof PessimisticLockingFailureException
                    || sqlCode(failure, 1205, 1222))
                throw AdminFailure.conflict(
                        "REFERENCE_BUSY",
                        "Another operation is changing this value. Reload and retry.");
            if (failure instanceof DuplicateKeyException || sqlCode(failure, 2601, 2627))
                throw AdminFailure.conflict(
                        "DUPLICATE_REFERENCE",
                        "A reference value with this name or code already exists.");
            if (failure instanceof DataIntegrityViolationException)
                throw AdminFailure.conflict(
                        "REFERENCE_CONFLICT",
                        "The reference value changed or is in use. Reload and retry.");
            throw failure;
        }
    }

    private static boolean sqlCode(DataAccessException failure, int... codes) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause())
            if (cause instanceof java.sql.SQLException sql)
                for (int code : codes) if (sql.getErrorCode() == code) return true;
        return false;
    }

    private Map<String, Object> row(ReferenceCatalog.Resource resource, int id, boolean lock) {
        if (id <= 0) throw AdminFailure.missing();
        // The mutation's dependency checks run separately with HOLDLOCK after this parent X lock.
        String selection =
                lock
                        ? "r."
                                + resource.id()
                                + " AS Id,r.Name,r.AdminVersion"
                                + (resource.coded() ? ",r.Code" : "")
                        : projection(resource);
        var rows =
                Rows.query(
                        db,
                        "SELECT "
                                + selection
                                + " FROM dbo."
                                + resource.table()
                                + " r"
                                + (lock ? " WITH(XLOCK,HOLDLOCK)" : "")
                                + " WHERE r."
                                + resource.id()
                                + "=?",
                        id);
        if (rows.isEmpty()) throw AdminFailure.missing();
        return rows.getFirst();
    }

    private void writable(
            ReferenceCatalog.Resource resource, Map<String, Object> current, byte[] version) {
        if (!Secrets.equal(version, (byte[]) current.get("AdminVersion")))
            throw AdminFailure.conflict(
                    "VERSION_CONFLICT",
                    "This value changed. Reload the current version before saving.");
        int id = ((Number) current.get("Id")).intValue();
        if (!Rows.query(
                        db,
                        "SELECT ReferenceId FROM admin.SystemReferences WITH(HOLDLOCK) WHERE Resource=? AND ReferenceId=?",
                        resource.key(),
                        id)
                .isEmpty())
            throw AdminFailure.conflict(
                    "SYSTEM_VALUE", "This system value cannot be changed or deleted.");
        compatible(resource);
        for (var dependency : resource.dependencies()) {
            if (!Rows.query(
                            db,
                            "SELECT TOP(1) "
                                    + dependency.column()
                                    + " FROM "
                                    + dependency.table()
                                    + " WITH(HOLDLOCK) WHERE "
                                    + dependency.column()
                                    + "=?",
                            id)
                    .isEmpty())
                throw AdminFailure.conflict(
                        "REFERENCE_IN_USE",
                        "This value is in use and cannot be changed or deleted.");
        }
    }

    private static void compatible(ReferenceCatalog.Resource resource) {
        if (resource.key().equals("post-types"))
            throw AdminFailure.conflict(
                    "POST_TYPE_COMPATIBILITY",
                    "Post-type changes are unavailable until all publication clients support dynamic types.");
    }

    private void unique(
            ReferenceCatalog.Resource resource, String field, String value, int except) {
        if (!Rows.query(
                        db,
                        "SELECT TOP(1) "
                                + resource.id()
                                + " FROM dbo."
                                + resource.table()
                                + " WITH(UPDLOCK,HOLDLOCK) WHERE "
                                + field
                                + "=? AND "
                                + resource.id()
                                + "<>?",
                        value,
                        except)
                .isEmpty()) throw AdminFailure.duplicate(field.toLowerCase(Locale.ROOT));
    }

    private static String projection(ReferenceCatalog.Resource resource) {
        String used =
                resource.dependencies().stream()
                        .map(
                                d ->
                                        "EXISTS(SELECT 1 FROM "
                                                + d.table()
                                                + " d WHERE d."
                                                + d.column()
                                                + "=r."
                                                + resource.id()
                                                + ")")
                        .collect(java.util.stream.Collectors.joining(" OR "));
        return "r."
                + resource.id()
                + " AS Id,r.Name,r.AdminVersion"
                + (resource.coded() ? ",r.Code" : "")
                + ",CASE WHEN EXISTS(SELECT 1 FROM admin.SystemReferences p WHERE p.Resource='"
                + resource.key()
                + "' AND p.ReferenceId=r."
                + resource.id()
                + ") THEN 1 ELSE 0 END AS SystemValue"
                + ",CASE WHEN "
                + used
                + " THEN 1 ELSE 0 END AS InUse";
    }

    private static Map<String, Object> metadata(
            ReferenceCatalog.Resource resource, Map<String, Object> row) {
        var reasons = new ArrayList<String>();
        if (((Number) row.get("SystemValue")).intValue() == 1) reasons.add("SYSTEM_VALUE");
        if (((Number) row.get("InUse")).intValue() == 1) reasons.add("REFERENCE_IN_USE");
        if (resource.key().equals("post-types")) reasons.add("POST_TYPE_COMPATIBILITY");
        var output = new LinkedHashMap<String, Object>();
        output.put("id", row.get("Id").toString());
        output.put("name", row.get("Name"));
        output.put("version", Secrets.encode((byte[]) row.get("AdminVersion")));
        if (resource.coded()) output.put("code", row.get("Code"));
        output.put("protectionReasons", reasons);
        return output;
    }

    private String encodeCursor(ReferenceCatalog.Resource resource, String query, int id) {
        return id
                + "."
                + Secrets.encode(
                        secrets.mac(
                                "admin-reference-cursor",
                                resource.key() + "\n" + query + "\n" + id));
    }

    private int decodeCursor(ReferenceCatalog.Resource resource, String query, String cursor) {
        if (cursor == null || cursor.isEmpty()) return 0;
        try {
            if (!cursor.matches("[1-9][0-9]{0,9}\\.[A-Za-z0-9_-]{43}"))
                throw new IllegalArgumentException();
            int id = Integer.parseInt(cursor.substring(0, cursor.indexOf('.')));
            if (!encodeCursor(resource, query, id).equals(cursor))
                throw new IllegalArgumentException();
            return id;
        } catch (IllegalArgumentException invalid) {
            throw AdminFailure.invalid("cursor", "Reload the list to restart this search.");
        }
    }

    private static void fields(Map<String, Object> input, Set<String> allowed) {
        if (!input.keySet().equals(allowed))
            throw AdminFailure.invalid("request", "Supply only the required writable fields.");
    }

    private static String name(ReferenceCatalog.Resource resource, Object value) {
        if (!(value instanceof String text)
                || text.isBlank()
                || text.strip().length() > resource.nameLimit()
                || text.codePoints().anyMatch(Character::isISOControl))
            throw AdminFailure.invalid(
                    "name", "Enter a name of at most " + resource.nameLimit() + " characters.");
        return text.strip();
    }

    private static String code(ReferenceCatalog.Resource resource, Object value) {
        if (!(value instanceof String text)
                || text.length() > resource.codeLimit()
                || !text.matches("[a-z][a-z0-9]*(?:-[a-z0-9]+)*"))
            throw AdminFailure.invalid(
                    "code",
                    "Use a lowercase code of at most "
                            + resource.codeLimit()
                            + " letters, digits and single hyphens.");
        return text;
    }

    private static byte[] version(Object value) {
        if (!(value instanceof String text))
            throw AdminFailure.invalid("version", "Reload the current version before saving.");
        try {
            return Secrets.decode(text, 8);
        } catch (AuthFailure invalid) {
            throw AdminFailure.invalid("version", "Reload the current version before saving.");
        }
    }
}
