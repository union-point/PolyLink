package am.polylink.profile;

import am.polylink.auth.*;
import java.sql.Date;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class ProfileService {
    private final Accounts accounts;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;

    public ProfileService(Accounts accounts, JdbcTemplate db, TransactionTemplate tx) {
        this.accounts = accounts;
        this.db = db;
        this.tx = tx;
    }

    static AuthFailure missing() {
        return new AuthFailure(404, "NOT_FOUND", "The profile record is unavailable.");
    }

    public Map<String, Object> get(int viewer, int user) {
        var rows =
                Rows.query(
                        db,
                        "SELECT u.FirstName,u.LastName,u.Email,u.ShowEmail,u.IsProfilePublic,u.Specialization,u.About,u.ProfilePhotoUrl,u.CoverPhotoUrl,r.Name AS RoleName FROM dbo.Users u JOIN dbo.Roles r ON r.RoleId=u.RoleId JOIN auth.AccountSecurity a ON a.UserId=u.UserId WHERE u.UserId=? AND a.AdmissionStatus='ADMITTED' AND a.EmailVerifiedAt IS NOT NULL",
                        user);
        if (rows.isEmpty()
                || (viewer != user && !Boolean.TRUE.equals(rows.getFirst().get("IsProfilePublic"))))
            throw missing();
        var r = rows.getFirst();
        var out = new LinkedHashMap<String, Object>();
        out.put("id", "" + user);
        out.put("firstName", r.get("FirstName"));
        out.put("lastName", r.get("LastName"));
        out.put("role", r.get("RoleName").toString().toLowerCase(Locale.ROOT));
        out.put("onboardingComplete", true);
        out.put("canOpenProfile", true);
        if (viewer == user || Boolean.TRUE.equals(r.get("ShowEmail")))
            out.put("email", r.get("Email"));
        out.put("jobTitle", Objects.toString(r.get("Specialization"), ""));
        out.put("description", Objects.toString(r.get("About"), ""));
        out.put("avatar", Objects.toString(r.get("ProfilePhotoUrl"), ""));
        out.put("cover", Objects.toString(r.get("CoverPhotoUrl"), ""));
        out.put("education", education(user));
        out.put("licenses", certificates(user));
        return out;
    }

    public Map<String, Object> update(int user, Map<String, Object> input) {
        ProfileValues.fields(input, "jobTitle", "description");
        if (!input.keySet().containsAll(Set.of("jobTitle", "description")))
            throw AuthFailure.invalid();
        String title = ProfileValues.text(input.get("jobTitle"), 150, false),
                bio = ProfileValues.text(input.get("description"), 2000, false);
        return tx.execute(
                s -> {
                    accounts.lock(user).requireAdmitted();
                    db.update(
                            "UPDATE dbo.Users SET Specialization=?,About=? WHERE UserId=?",
                            title,
                            bio,
                            user);
                    return get(user, user);
                });
    }

    public Map<String, Object> options() {
        var out = new LinkedHashMap<String, Object>();
        for (var entry :
                Map.of(
                                "universities",
                                "Universities:UniversityId",
                                "degrees",
                                "Degrees:DegreeId",
                                "institutes",
                                "Institutes:InstituteId",
                                "specializations",
                                "Specializations:SpecializationId")
                        .entrySet()) {
            String[] names = entry.getValue().split(":");
            out.put(
                    entry.getKey(),
                    Rows.query(
                            db,
                            "SELECT CONVERT(varchar(10),"
                                    + names[1]
                                    + ") AS id,Name AS name FROM dbo."
                                    + names[0]
                                    + " ORDER BY Name,"
                                    + names[1]));
        }
        return out;
    }

    private void reference(String table, String column, Integer id) {
        if (id != null
                && db.queryForObject(
                                "SELECT COUNT(*) FROM dbo." + table + " WHERE " + column + "=?",
                                Integer.class,
                                id)
                        != 1) throw AuthFailure.invalid();
    }

    public List<Map<String, Object>> education(int user) {
        var rows =
                Rows.query(
                        db,
                        "SELECT e.*,u.Name AS institution,u.LogoUrl AS logo,d.Name AS degree,i.Name AS institute,s.Name AS specialization FROM dbo.Education e JOIN dbo.Universities u ON u.UniversityId=e.UniversityId LEFT JOIN dbo.Degrees d ON d.DegreeId=e.DegreeId LEFT JOIN dbo.Institutes i ON i.InstituteId=e.InstituteId LEFT JOIN dbo.Specializations s ON s.SpecializationId=e.SpecializationId WHERE e.UserId=? ORDER BY e.EducationId",
                        user);
        var result = new ArrayList<Map<String, Object>>();
        for (var row : rows) {
            var out = new LinkedHashMap<String, Object>();
            out.put("id", row.get("EducationId").toString());
            for (String field : List.of("University", "Degree", "Institute", "Specialization"))
                out.put(
                        Character.toLowerCase(field.charAt(0)) + field.substring(1) + "Id",
                        row.get(field + "Id") == null ? null : row.get(field + "Id").toString());
            for (String field :
                    List.of("institution", "logo", "degree", "institute", "specialization"))
                out.put(field, Objects.toString(row.get(field), ""));
            for (String field : List.of("Start", "End")) {
                var date = (Date) row.get(field + "Date");
                var precision = (String) row.get(field + "Precision");
                out.put(
                        field.toLowerCase() + "Date",
                        new ProfileValues.Period(
                                        date == null ? null : date.toLocalDate(), precision)
                                .value());
                out.put(field.toLowerCase() + "Precision", precision);
            }
            out.put("isOngoing", row.get("IsOngoing"));
            result.add(out);
        }
        return result;
    }

    public Map<String, Object> saveEducation(int user, Integer id, Map<String, Object> input) {
        ProfileValues.fields(
                input,
                "universityId",
                "degreeId",
                "instituteId",
                "specializationId",
                "startDate",
                "endDate",
                "isOngoing");
        return tx.execute(
                s -> {
                    accounts.lock(user).requireAdmitted();
                    Map<String, Object> old = null;
                    if (id != null) {
                        var rows =
                                Rows.query(
                                        db,
                                        "SELECT * FROM dbo.Education WITH(UPDLOCK) WHERE EducationId=? AND UserId=?",
                                        id,
                                        user);
                        if (rows.isEmpty()) throw missing();
                        old = rows.getFirst();
                    }
                    Integer university = ProfileValues.id(input.get("universityId"), true),
                            degree = ProfileValues.id(input.get("degreeId"), false),
                            institute = ProfileValues.id(input.get("instituteId"), false),
                            specialization = ProfileValues.id(input.get("specializationId"), false);
                    reference("Universities", "UniversityId", university);
                    reference("Degrees", "DegreeId", degree);
                    reference("Institutes", "InstituteId", institute);
                    reference("Specializations", "SpecializationId", specialization);
                    var start = educationDate(input.get("startDate"), old, "Start");
                    var end = educationDate(input.get("endDate"), old, "End");
                    if (!(input.get("isOngoing") instanceof Boolean ongoing))
                        throw AuthFailure.invalid();
                    ProfileValues.range(start, end, ongoing);
                    Integer saved = id;
                    if (id == null)
                        saved =
                                db.queryForObject(
                                        "INSERT dbo.Education(UserId,UniversityId,DegreeId,InstituteId,SpecializationId,StartDate,EndDate,StartPrecision,EndPrecision,IsOngoing) OUTPUT INSERTED.EducationId VALUES (?,?,?,?,?,?,?,?,?,?)",
                                        Integer.class,
                                        user,
                                        university,
                                        degree,
                                        institute,
                                        specialization,
                                        start.date(),
                                        end.date(),
                                        start.precision(),
                                        end.precision(),
                                        ongoing);
                    else
                        db.update(
                                "UPDATE dbo.Education SET UniversityId=?,DegreeId=?,InstituteId=?,SpecializationId=?,StartDate=?,EndDate=?,StartPrecision=?,EndPrecision=?,IsOngoing=? WHERE EducationId=? AND UserId=?",
                                university,
                                degree,
                                institute,
                                specialization,
                                start.date(),
                                end.date(),
                                start.precision(),
                                end.precision(),
                                ongoing,
                                id,
                                user);
                    String key = "" + saved;
                    return education(user).stream()
                            .filter(r -> r.get("id").equals(key))
                            .findFirst()
                            .orElseThrow(ProfileService::missing);
                });
    }

    private ProfileValues.Period educationDate(
            Object value, Map<String, Object> old, String field) {
        // Day-level input is only a pass-through of an unchanged historical date.
        if (old != null
                && old.get(field + "Date") != null
                && old.get(field + "Date").toString().equals(value)
                && "DAY".equals(old.get(field + "Precision")))
            return new ProfileValues.Period(((Date) old.get(field + "Date")).toLocalDate(), "DAY");
        return ProfileValues.period(value, false);
    }

    public List<Map<String, Object>> certificates(int user) {
        return Rows.query(
                db,
                "SELECT CONVERT(varchar(10),CertificateId) AS id,CertificateName AS name,Organization AS organization,LEFT(CONVERT(varchar(10),IssueDate,23),7) AS issueDate,Url AS credentialUrl FROM dbo.Certificates WHERE UserId=? ORDER BY CertificateId",
                user);
    }

    public Map<String, Object> saveCertificate(int user, Integer id, Map<String, Object> input) {
        ProfileValues.fields(input, "name", "organization", "issueDate", "credentialUrl");
        String name = ProfileValues.text(input.get("name"), 255, true),
                org = ProfileValues.text(input.get("organization"), 255, true),
                url = ProfileValues.url(input.get("credentialUrl"));
        var date = ProfileValues.period(input.get("issueDate"), false);
        if (date.date() != null && !"MONTH".equals(date.precision())) throw AuthFailure.invalid();
        return tx.execute(
                s -> {
                    accounts.lock(user).requireAdmitted();
                    Integer saved = id;
                    if (id == null)
                        saved =
                                db.queryForObject(
                                        "INSERT dbo.Certificates(UserId,CertificateName,Organization,IssueDate,Url) OUTPUT INSERTED.CertificateId VALUES (?,?,?,?,?)",
                                        Integer.class,
                                        user,
                                        name,
                                        org,
                                        date.date(),
                                        url);
                    else if (db.update(
                                    "UPDATE dbo.Certificates SET CertificateName=?,Organization=?,IssueDate=?,Url=? WHERE CertificateId=? AND UserId=?",
                                    name,
                                    org,
                                    date.date(),
                                    url,
                                    id,
                                    user)
                            != 1) throw missing();
                    String key = "" + saved;
                    return certificates(user).stream()
                            .filter(r -> r.get("id").equals(key))
                            .findFirst()
                            .orElseThrow(ProfileService::missing);
                });
    }

    public void delete(int user, int id, boolean education) {
        String table = education ? "Education" : "Certificates",
                key = education ? "EducationId" : "CertificateId";
        tx.executeWithoutResult(
                s -> {
                    accounts.lock(user).requireAdmitted();
                    if (db.update(
                                    "DELETE dbo." + table + " WHERE " + key + "=? AND UserId=?",
                                    id,
                                    user)
                            != 1) throw missing();
                });
    }
}
