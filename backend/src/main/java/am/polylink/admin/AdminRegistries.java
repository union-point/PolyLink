package am.polylink.admin;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.dao.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@AdminEnabled
public class AdminRegistries {
    private record Kind(
            boolean lecturer,
            String table,
            String id,
            String identity,
            String key,
            Set<String> fields) {}

    private static final Set<String> LECTURER_FIELDS =
            Set.of("firstName", "lastName", "email", "departmentId");
    private static final Set<String> ALUMNI_FIELDS =
            Set.of(
                    "firstName",
                    "lastName",
                    "diplomaNumber",
                    "studyStartDate",
                    "studyEndDate",
                    "specializationId");
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final AdminSessions sessions;
    private final Secrets secrets;

    public AdminRegistries(
            JdbcTemplate db, TransactionTemplate tx, AdminSessions sessions, Secrets secrets) {
        this.db = db;
        this.tx = tx;
        this.sessions = sessions;
        this.secrets = secrets;
    }

    private static Kind kind(String value) {
        return switch (value) {
            case "lecturers" ->
                    new Kind(
                            true,
                            "LecturerRegistry",
                            "LecturerRegistryId",
                            "Email",
                            "EmailKey",
                            LECTURER_FIELDS);
            case "alumni" ->
                    new Kind(
                            false,
                            "AlumniRegistry",
                            "AlumniRegistryId",
                            "DiplomaNumber",
                            "DiplomaKey",
                            ALUMNI_FIELDS);
            default -> throw missing();
        };
    }

    public Map<String, Object> list(
            String resource, String search, String cursor, HttpServletRequest request) {
        sessions.require(request, false);
        var kind = kind(resource);
        String query = search == null ? "" : search.strip();
        if (query.length() > 255 || query.codePoints().anyMatch(Character::isISOControl))
            throw AdminFailure.invalid("q", "Use a search of at most 255 characters.");
        int after = cursor(resource, query, cursor);
        String like =
                "%"
                        + query.replace("~", "~~")
                                .replace("%", "~%")
                                .replace("_", "~_")
                                .replace("[", "~[")
                        + "%";
        byte[] key = kind.lecturer() ? RegistryKeys.lecturer(query) : RegistryKeys.diploma(query);
        var rows =
                Rows.query(
                        db,
                        "SELECT TOP(51) "
                                + projection(kind)
                                + " FROM dbo."
                                + kind.table()
                                + " r WHERE r."
                                + kind.id()
                                + ">? AND (r.FirstName LIKE ? ESCAPE '~' OR r.LastName LIKE ? ESCAPE '~' OR CONCAT(r.FirstName,N' ',r.LastName) LIKE ? ESCAPE '~' OR r."
                                + kind.identity()
                                + " LIKE ? ESCAPE '~' OR r."
                                + kind.key()
                                + "=?) ORDER BY r."
                                + kind.id(),
                        after,
                        like,
                        like,
                        like,
                        like,
                        key);
        var items = rows.stream().limit(50).map(row -> metadata(kind, row)).toList();
        var output = new LinkedHashMap<String, Object>();
        output.put("items", items);
        output.put(
                "nextCursor",
                rows.size() > 50
                        ? cursor(resource, query, ((Number) rows.get(49).get(kind.id())).intValue())
                        : null);
        return output;
    }

    public Map<String, Object> detail(String resource, int id, HttpServletRequest request) {
        sessions.require(request, false);
        return metadata(kind(resource), row(kind(resource), id));
    }

    public Map<String, Object> create(
            String resource, Map<String, Object> input, HttpServletRequest request) {
        return write(
                () -> {
                    sessions.require(request, true);
                    var kind = kind(resource);
                    fields(input, kind.fields());
                    var values = values(kind, input);
                    unique(kind, values.key(), 0);
                    references(kind, values.reference());
                    int id;
                    if (kind.lecturer())
                        id =
                                db.queryForObject(
                                        "INSERT dbo.LecturerRegistry(FirstName,LastName,Email,DepartmentId,EmailKey,KeySourceHash) OUTPUT inserted.LecturerRegistryId VALUES (?,?,?,?,?,?)",
                                        Integer.class,
                                        values.first(),
                                        values.last(),
                                        values.identity(),
                                        values.reference(),
                                        values.key(),
                                        RegistryKeys.source(values.identity()));
                    else
                        id =
                                db.queryForObject(
                                        "INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,SpecializationId,StudyStartDate,StudyEndDate,DiplomaKey,KeySourceHash) OUTPUT inserted.AlumniRegistryId VALUES (?,?,?,?,?,?,?,?)",
                                        Integer.class,
                                        values.first(),
                                        values.last(),
                                        values.identity(),
                                        values.reference(),
                                        values.start(),
                                        values.end(),
                                        values.key(),
                                        RegistryKeys.source(values.identity()));
                    return metadata(kind, row(kind, id));
                },
                resource);
    }

    public Map<String, Object> update(
            String resource, int id, Map<String, Object> input, HttpServletRequest request) {
        return write(
                () -> {
                    sessions.require(request, true);
                    var kind = kind(resource);
                    var allowed = new HashSet<>(kind.fields());
                    allowed.add("version");
                    fields(input, allowed);
                    var values = values(kind, input);
                    writable(kind, id, version(input.get("version")));
                    unique(kind, values.key(), id);
                    references(kind, values.reference());
                    if (kind.lecturer())
                        db.update(
                                "UPDATE dbo.LecturerRegistry SET FirstName=?,LastName=?,Email=?,DepartmentId=?,EmailKey=?,KeySourceHash=? WHERE LecturerRegistryId=?",
                                values.first(),
                                values.last(),
                                values.identity(),
                                values.reference(),
                                values.key(),
                                RegistryKeys.source(values.identity()),
                                id);
                    else
                        db.update(
                                "UPDATE dbo.AlumniRegistry SET FirstName=?,LastName=?,DiplomaNumber=?,SpecializationId=?,StudyStartDate=?,StudyEndDate=?,DiplomaKey=?,KeySourceHash=? WHERE AlumniRegistryId=?",
                                values.first(),
                                values.last(),
                                values.identity(),
                                values.reference(),
                                values.start(),
                                values.end(),
                                values.key(),
                                RegistryKeys.source(values.identity()),
                                id);
                    return metadata(kind, row(kind, id));
                },
                resource);
    }

    public void delete(
            String resource, int id, Map<String, Object> input, HttpServletRequest request) {
        write(
                () -> {
                    sessions.require(request, true);
                    var kind = kind(resource);
                    fields(input, Set.of("version"));
                    writable(kind, id, version(input.get("version")));
                    db.update("DELETE dbo." + kind.table() + " WHERE " + kind.id() + "=?", id);
                    return null;
                },
                resource);
    }

    private void writable(Kind kind, int id, byte[] version) {
        if (id <= 0) throw missing();
        var current = RegistryLinks.lock(db, kind.lecturer(), id);
        if (current == null) throw missing();
        if (!Secrets.equal(version, (byte[]) current.get("AdminVersion")))
            throw AdminFailure.conflict(
                    "VERSION_CONFLICT",
                    "This record changed. Reload the current version before saving.");
        if (!RegistryLinks.claims(db, kind.lecturer(), id).isEmpty())
            throw AdminFailure.conflict(
                    "RECORD_LINKED",
                    "This registry record is linked to a member and cannot be changed or deleted.");
    }

    private record Values(
            String first,
            String last,
            String identity,
            int reference,
            LocalDate start,
            LocalDate end,
            byte[] key) {}

    private static Values values(Kind kind, Map<String, Object> input) {
        String first = text(input.get("firstName"), "firstName", 100);
        String last = text(input.get("lastName"), "lastName", 100);
        String identity =
                text(
                        input.get(kind.lecturer() ? "email" : "diplomaNumber"),
                        kind.lecturer() ? "email" : "diplomaNumber",
                        kind.lecturer() ? 255 : 100);
        if (kind.lecturer()) {
            try {
                identity = email(identity);
            } catch (IllegalArgumentException invalid) {
                throw AdminFailure.invalid("email", "Enter a valid email address.");
            }
        }
        int reference =
                id(
                        input.get(kind.lecturer() ? "departmentId" : "specializationId"),
                        kind.lecturer() ? "departmentId" : "specializationId");
        LocalDate start =
                kind.lecturer() ? null : date(input.get("studyStartDate"), "studyStartDate");
        LocalDate end = kind.lecturer() ? null : date(input.get("studyEndDate"), "studyEndDate");
        if (start != null && end.isBefore(start))
            throw AdminFailure.invalid(
                    "studyEndDate", "The study end date must be on or after the start date.");
        return new Values(
                first,
                last,
                identity,
                reference,
                start,
                end,
                kind.lecturer() ? RegistryKeys.lecturer(identity) : RegistryKeys.diploma(identity));
    }

    private void references(Kind kind, int reference) {
        String table = kind.lecturer() ? "Departments" : "Specializations";
        String column = kind.lecturer() ? "DepartmentId" : "SpecializationId";
        if (Rows.query(
                        db,
                        "SELECT "
                                + column
                                + " FROM dbo."
                                + table
                                + " WITH(HOLDLOCK) WHERE "
                                + column
                                + "=?",
                        reference)
                .isEmpty())
            throw AdminFailure.invalid(
                    kind.lecturer() ? "departmentId" : "specializationId",
                    "Choose an existing reference value.");
    }

    private void unique(Kind kind, byte[] key, int except) {
        if (!Rows.query(
                        db,
                        "SELECT "
                                + kind.id()
                                + " FROM dbo."
                                + kind.table()
                                + " WITH(UPDLOCK,HOLDLOCK) WHERE "
                                + kind.key()
                                + "=? AND "
                                + kind.id()
                                + "<>?",
                        key,
                        except)
                .isEmpty()) throw duplicate(kind);
    }

    private Map<String, Object> row(Kind kind, int id) {
        if (id <= 0) throw missing();
        var rows =
                Rows.query(
                        db,
                        "SELECT "
                                + projection(kind)
                                + " FROM dbo."
                                + kind.table()
                                + " r WHERE r."
                                + kind.id()
                                + "=?",
                        id);
        if (rows.isEmpty()) throw missing();
        return rows.getFirst();
    }

    private static String projection(Kind kind) {
        return "r."
                + kind.id()
                + ",r.FirstName,r.LastName,r."
                + kind.identity()
                + ",r.AdminVersion,"
                + (kind.lecturer()
                        ? "r.DepartmentId"
                        : "r.SpecializationId,r.StudyStartDate,r.StudyEndDate")
                + ",CASE WHEN EXISTS(SELECT 1 FROM auth.RegistryClaims c WHERE c."
                + kind.id()
                + "=r."
                + kind.id()
                + ") THEN 1 ELSE 0 END AS Linked";
    }

    private static Map<String, Object> metadata(Kind kind, Map<String, Object> row) {
        var output = new LinkedHashMap<String, Object>();
        output.put("id", row.get(kind.id()).toString());
        output.put("firstName", row.get("FirstName"));
        output.put("lastName", row.get("LastName"));
        output.put(kind.lecturer() ? "email" : "diplomaNumber", row.get(kind.identity()));
        String column = kind.lecturer() ? "DepartmentId" : "SpecializationId";
        output.put(
                kind.lecturer() ? "departmentId" : "specializationId",
                row.get(column) == null ? null : row.get(column).toString());
        if (!kind.lecturer()) {
            output.put("studyStartDate", row.get("StudyStartDate").toString());
            output.put("studyEndDate", row.get("StudyEndDate").toString());
        }
        output.put("version", Secrets.encode((byte[]) row.get("AdminVersion")));
        output.put("linked", ((Number) row.get("Linked")).intValue() == 1);
        boolean incomplete =
                RegistryKeys.text((String) row.get("FirstName")).isEmpty()
                        || RegistryKeys.text((String) row.get("LastName")).isEmpty()
                        || row.get(column) == null;
        if (kind.lecturer())
            try {
                email((String) row.get("Email"));
            } catch (IllegalArgumentException invalid) {
                incomplete = true;
            }
        output.put("needsCorrection", incomplete);
        return output;
    }

    private String cursor(String resource, String query, int id) {
        return id
                + "."
                + Secrets.encode(
                        secrets.mac("admin-registry-cursor", resource + "\n" + query + "\n" + id));
    }

    private int cursor(String resource, String query, String cursor) {
        if (cursor == null || cursor.isEmpty()) return 0;
        try {
            if (!cursor.matches("[1-9][0-9]{0,9}\\.[A-Za-z0-9_-]{43}"))
                throw new IllegalArgumentException();
            int id = Integer.parseInt(cursor.substring(0, cursor.indexOf('.')));
            if (!cursor(resource, query, id).equals(cursor)) throw new IllegalArgumentException();
            return id;
        } catch (IllegalArgumentException invalid) {
            throw AdminFailure.invalid("cursor", "Reload the list to restart this search.");
        }
    }

    private static void fields(Map<String, Object> input, Set<String> allowed) {
        if (!input.keySet().equals(allowed))
            throw AdminFailure.invalid("request", "Supply only the required writable fields.");
    }

    private static String text(Object value, String field, int max) {
        if (!(value instanceof String text)
                || text.length() > max
                || RegistryKeys.text(text).isEmpty()
                || text.codePoints()
                        .anyMatch(c -> Character.isISOControl(c) || c >= 0xD800 && c <= 0xDFFF))
            throw AdminFailure.invalid(field, "Enter a value of at most " + max + " characters.");
        return text.strip();
    }

    private static String email(String value) {
        if (value == null
                || value.codePoints()
                        .anyMatch(c -> Character.isWhitespace(c) || Character.isSpaceChar(c)))
            throw new IllegalArgumentException();
        return AdminCommand.email(value);
    }

    private static int id(Object value, String field) {
        try {
            if (!(value instanceof String text) || !text.matches("[1-9][0-9]{0,9}"))
                throw new IllegalArgumentException();
            return Integer.parseInt(text);
        } catch (IllegalArgumentException invalid) {
            throw AdminFailure.invalid(field, "Choose an existing reference value.");
        }
    }

    private static LocalDate date(Object value, String field) {
        try {
            if (!(value instanceof String text) || !text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new IllegalArgumentException();
            LocalDate date = LocalDate.parse(text);
            if (date.getYear() < 1) throw new IllegalArgumentException();
            return date;
        } catch (java.time.DateTimeException | IllegalArgumentException invalid) {
            throw AdminFailure.invalid(field, "Enter a valid full date as YYYY-MM-DD.");
        }
    }

    private static byte[] version(Object value) {
        try {
            if (value instanceof String text) return Secrets.decode(text, 8);
        } catch (AuthFailure invalid) {
            /* Use the field-level error below. */
        }
        throw AdminFailure.invalid("version", "Reload the current version before saving.");
    }

    private <T> T write(Supplier<T> action, String resource) {
        try {
            return tx.execute(status -> action.get());
        } catch (DataAccessException failure) {
            int code =
                    failure.getMostSpecificCause() instanceof java.sql.SQLException sql
                            ? sql.getErrorCode()
                            : 0;
            if (failure instanceof PessimisticLockingFailureException
                    || code == 1205
                    || code == 1222)
                throw AdminFailure.conflict(
                        "REGISTRY_BUSY",
                        "Another operation is changing this record. Reload and retry.");
            if (failure instanceof DuplicateKeyException || code == 2601 || code == 2627)
                throw duplicate(kind(resource));
            if (failure instanceof DataIntegrityViolationException)
                throw AdminFailure.conflict(
                        "REGISTRY_CONFLICT",
                        "The record or its references changed. Reload and retry.");
            throw failure;
        }
    }

    private static AdminFailure duplicate(Kind kind) {
        String field = kind.lecturer() ? "email" : "diplomaNumber";
        return AdminFailure.registryDuplicate(
                field, kind.lecturer() ? "DUPLICATE_EMAIL" : "DUPLICATE_DIPLOMA");
    }

    private static AdminFailure missing() {
        return AdminFailure.registryMissing();
    }
}
