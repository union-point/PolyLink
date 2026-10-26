package am.polylink.search;

import am.polylink.auth.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
@IdentityEnabled
public class SearchService {
    private final JdbcTemplate db;
    private final Secrets secrets;
    private static final String FIRST = "u.FirstName COLLATE SQL_Latin1_General_CP1_CI_AS";
    private static final String LAST = "u.LastName COLLATE SQL_Latin1_General_CP1_CI_AS";
    private static final String FROM =
            " FROM dbo.Users u JOIN auth.AccountSecurity a ON a.UserId=u.UserId JOIN dbo.Roles r ON r.RoleId=u.RoleId LEFT JOIN auth.PendingEnrollments p ON p.UserId=u.UserId ";
    private static final String ELIGIBLE =
            "a.AdmissionStatus='ADMITTED' AND a.EmailVerifiedAt IS NOT NULL AND LOWER(COALESCE(p.RoleCode,r.Name)) IN ('graduate','lecturer')";

    public SearchService(JdbcTemplate db, Secrets secrets) {
        this.db = db;
        this.secrets = secrets;
    }

    public record Filters(
            String q, Integer specializationId, Integer instituteId, Integer year, int limit) {
        public Filters {
            if (q == null
                    || q.length() > 100
                    || limit < 1
                    || limit > 100
                    || specializationId != null && specializationId < 1
                    || instituteId != null && instituteId < 1
                    || year != null && (year < 1 || year > 9999)) throw AuthFailure.invalid();
            q = q.strip();
        }

        String scope() {
            return Secrets.encode(
                    Secrets.hash(
                            q
                                    + ":"
                                    + specializationId
                                    + ":"
                                    + instituteId
                                    + ":"
                                    + year
                                    + ":"
                                    + limit
                                    + ":names-v1"));
        }

        String education(List<Object> args) {
            String sql = "";
            if (specializationId != null) {
                sql += " AND e.SpecializationId=?";
                args.add(specializationId);
            }
            if (instituteId != null) {
                sql += " AND e.InstituteId=?";
                args.add(instituteId);
            }
            if (year != null) {
                sql +=
                        year == 9999
                                ? " AND e.EndDate>=? AND e.EndDate<=?"
                                : " AND e.EndDate>=? AND e.EndDate<?";
                args.add(java.sql.Date.valueOf(LocalDate.of(year, 1, 1)));
                args.add(
                        java.sql.Date.valueOf(
                                year == 9999
                                        ? LocalDate.of(9999, 12, 31)
                                        : LocalDate.of(year + 1, 1, 1)));
            }
            return sql;
        }
    }

    private String part(String value) {
        return Secrets.encode(value.getBytes(StandardCharsets.UTF_8));
    }

    private String unpart(String value) {
        return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
    }

    public Map<String, Object> page(int caller, Filters filters, String cursor) {
        var args = new ArrayList<Object>();
        args.add(filters.limit() + 1);
        args.add(
                "%"
                        + filters.q()
                                .replace("!", "!!")
                                .replace("%", "!%")
                                .replace("_", "!_")
                                .replace("[", "![")
                        + "%");
        String where = " AND (u.FirstName+' '+u.LastName LIKE ? ESCAPE '!')";
        String education = filters.education(args);
        if (!education.isEmpty())
            where +=
                    " AND EXISTS (SELECT 1 FROM dbo.Education e WHERE e.UserId=u.UserId"
                            + education
                            + ")";
        if (cursor != null) {
            try {
                if (cursor.length() > 2000) throw new IllegalArgumentException();
                var pieces = cursor.split("\\.", -1);
                if (pieces.length != 2) throw new IllegalArgumentException();
                String payload = unpart(pieces[0]);
                if (!Secrets.equal(
                        secrets.mac("search-cursor", payload), Secrets.decode(pieces[1], 32)))
                    throw new IllegalArgumentException();
                var fields = payload.split("\n", -1);
                if (fields.length != 5
                        || !fields[0].equals(filters.scope())
                        || !fields[1].equals("" + caller)) throw new IllegalArgumentException();
                String first = unpart(fields[2]), last = unpart(fields[3]);
                int id = Integer.parseInt(fields[4]);
                if (id < 1 || first.length() > 100 || last.length() > 100)
                    throw new IllegalArgumentException();
                where +=
                        " AND ("
                                + FIRST
                                + ">? OR ("
                                + FIRST
                                + "=? AND ("
                                + LAST
                                + ">? OR ("
                                + LAST
                                + "=? AND u.UserId>?))))";
                Collections.addAll(args, first, first, last, last, id);
            } catch (RuntimeException ex) {
                throw AuthFailure.invalid();
            }
        }
        var rows =
                Rows.query(
                        db,
                        "SELECT TOP (?) u.UserId,u.FirstName,u.LastName,u.Specialization,u.IsProfilePublic,LOWER(COALESCE(p.RoleCode,r.Name)) AS RoleCode"
                                + FROM
                                + " WHERE "
                                + ELIGIBLE
                                + where
                                + " ORDER BY "
                                + FIRST
                                + ","
                                + LAST
                                + ",u.UserId",
                        args.toArray());
        boolean more = rows.size() > filters.limit();
        if (more) rows = new ArrayList<>(rows.subList(0, filters.limit()));
        var items = new ArrayList<Map<String, Object>>();
        var byId = new HashMap<String, Map<String, Object>>();
        for (var row : rows) {
            var item = new LinkedHashMap<String, Object>();
            String id = row.get("UserId").toString();
            item.put("id", id);
            item.put("firstName", row.get("FirstName"));
            item.put("lastName", row.get("LastName"));
            item.put("role", row.get("RoleCode"));
            item.put("onboardingComplete", true);
            item.put("jobTitle", Objects.toString(row.get("Specialization"), ""));
            item.put(
                    "canOpenProfile",
                    Integer.toString(caller).equals(id)
                            || Boolean.TRUE.equals(row.get("IsProfilePublic")));
            item.put("matchedEducation", new ArrayList<Map<String, Object>>());
            items.add(item);
            byId.put(id, item);
        }
        if (!rows.isEmpty()) {
            var ea = new ArrayList<Object>();
            rows.forEach(row -> ea.add(row.get("UserId")));
            String conditions = filters.education(ea);
            String ids = String.join(",", Collections.nCopies(rows.size(), "?"));
            var educations =
                    Rows.query(
                            db,
                            "SELECT e.UserId,e.EducationId,un.Name AS Institution,d.Name AS Degree,i.Name AS Institute,s.Name AS Specialization,e.StartDate,e.EndDate FROM dbo.Education e LEFT JOIN dbo.Universities un ON un.UniversityId=e.UniversityId LEFT JOIN dbo.Degrees d ON d.DegreeId=e.DegreeId LEFT JOIN dbo.Institutes i ON i.InstituteId=e.InstituteId LEFT JOIN dbo.Specializations s ON s.SpecializationId=e.SpecializationId WHERE e.UserId IN ("
                                    + ids
                                    + ")"
                                    + conditions
                                    + " ORDER BY e.EndDate DESC,e.EducationId",
                            ea.toArray());
            for (var row : educations) {
                var entry = new LinkedHashMap<String, Object>();
                entry.put("id", row.get("EducationId").toString());
                for (String key :
                        List.of(
                                "Institution",
                                "Degree",
                                "Institute",
                                "Specialization",
                                "StartDate",
                                "EndDate"))
                    entry.put(
                            Character.toLowerCase(key.charAt(0)) + key.substring(1),
                            row.get(key) == null ? null : row.get(key).toString());
                @SuppressWarnings("unchecked")
                var records =
                        (List<Map<String, Object>>)
                                byId.get(row.get("UserId").toString()).get("matchedEducation");
                records.add(entry);
            }
        }
        String next = null;
        if (more) {
            var row = rows.getLast();
            String payload =
                    filters.scope()
                            + "\n"
                            + caller
                            + "\n"
                            + part(row.get("FirstName").toString())
                            + "\n"
                            + part(row.get("LastName").toString())
                            + "\n"
                            + row.get("UserId");
            next = part(payload) + "." + Secrets.encode(secrets.mac("search-cursor", payload));
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("items", items);
        result.put("hasMore", more);
        result.put("nextCursor", next);
        return result;
    }

    public Map<String, Object> filters() {
        return Map.of(
                "specializations",
                options("Specializations", "SpecializationId"),
                "institutes",
                options("Institutes", "InstituteId"),
                "years",
                db.queryForList(
                        "SELECT DISTINCT YEAR(e.EndDate)"
                                + FROM
                                + " JOIN dbo.Education e ON e.UserId=u.UserId WHERE "
                                + ELIGIBLE
                                + " AND e.EndDate IS NOT NULL ORDER BY 1 DESC",
                        Integer.class));
    }

    private List<Map<String, Object>> options(String table, String id) {
        return Rows.query(
                db,
                "SELECT " + id + " AS id,Name AS label FROM dbo." + table + " ORDER BY Name," + id);
    }
}
