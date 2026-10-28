package am.polylink.auth;

import jakarta.servlet.http.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class EnrollmentService {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private final Secrets secrets;
    private final PasswordEncoder encoder;
    private final Challenges challenges;
    private final RateLimiter limits;
    private final Clock clock;
    private final EnrollmentSessions sessions;
    private final String dummyVerifier;

    public EnrollmentService(
            JdbcTemplate db,
            Accounts accounts,
            TransactionTemplate tx,
            Secrets secrets,
            PasswordEncoder encoder,
            Challenges challenges,
            RateLimiter limits,
            Clock clock,
            EnrollmentSessions sessions) {
        this.db = db;
        this.accounts = accounts;
        this.tx = tx;
        this.secrets = secrets;
        this.encoder = encoder;
        this.challenges = challenges;
        this.limits = limits;
        this.clock = clock;
        this.sessions = sessions;
        this.dummyVerifier = encoder.encode(secrets.token());
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    public AuthDtos.Derivation parameters(String email, String ip) {
        limits.consume("PARAM_IP", ip, 100, 60);
        String normalized = Accounts.email(email);
        return accounts.find(normalized)
                .map(
                        a ->
                                new AuthDtos.Derivation(
                                        "PLK1", Secrets.encode(a.salt()), a.ops(), a.memory()))
                .orElseGet(
                        () ->
                                new AuthDtos.Derivation(
                                        "PLK1",
                                        Secrets.encode(
                                                Arrays.copyOf(
                                                        secrets.mac("dummy-salt", normalized), 16)),
                                        2,
                                        67108864));
    }

    public Map<String, Object> register(
            AuthDtos.Registration request, String ip, HttpServletResponse response) {
        String email = EnrollmentRules.universityEmail(request.email());
        limits.consume("REGISTER_IP", ip, 20, 3600);
        limits.consume("REGISTER_EMAIL", email, 5, 3600);
        Secrets.decode(request.loginSecret(), 32);
        byte[] salt = Secrets.decode(request.derivation().salt(), 16);
        String verifier = encoder.encode(request.loginSecret());
        // Retention cleanup happens in its own committed transaction before checking occupancy.
        expireEmail(email);
        Integer user =
                tx.execute(
                        status -> {
                            var users =
                                    db.queryForList(
                                            "SELECT UserId FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE Email=?",
                                            Integer.class,
                                            email);
                            if (!users.isEmpty()) return null;
                            int role =
                                    db.queryForObject(
                                            "SELECT RoleId FROM dbo.Roles WHERE Name=?",
                                            Integer.class,
                                            request.role());
                            int language =
                                    db.queryForObject(
                                            "SELECT Id FROM dbo.Languages WHERE Code=N'hy'",
                                            Integer.class);
                            int id =
                                    db.queryForObject(
                                            "INSERT dbo.Users(FirstName,LastName,Email,RoleId,LanguageId) OUTPUT inserted.UserId VALUES (?,?,?,?,?)",
                                            Integer.class,
                                            request.firstName().strip(),
                                            request.lastName().strip(),
                                            email,
                                            role,
                                            language);
                            db.update("INSERT dbo.UserNotificationSettings(UserId) VALUES (?)", id);
                            db.update(
                                    "INSERT auth.AccountSecurity(UserId,AdmissionStatus,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled) VALUES (?,'PENDING',1,1,?,?,?,?,0)",
                                    id,
                                    salt,
                                    request.derivation().opsLimit(),
                                    request.derivation().memoryBytes(),
                                    verifier);
                            db.update(
                                    "INSERT auth.PendingEnrollments(UserId,CredentialVersion,FirstName,LastName,RoleCode,SavedAt) VALUES (?,1,?,?,?,?)",
                                    id,
                                    request.firstName().strip(),
                                    request.lastName().strip(),
                                    request.role(),
                                    now());
                            return id;
                        });
        // Occupied-address responses have the same shape. Possession of this opaque cookie proves
        // nothing until it resolves to an enrollment session; credentials are never overwritten.
        if (user != null) sessions.issue(user, 1, response);
        else {
            Sessions.cookie(response, EnrollmentSessions.COOKIE, secrets.token(), true, 86400);
            Sessions.cookie(response, EnrollmentSessions.CSRF, secrets.token(), false, 86400);
        }
        return Map.of("status", "enrollment", "next", "profile_info.html");
    }

    public Accounts.Account password(AuthDtos.Login request, String ip) {
        String email = Accounts.email(request.email());
        limits.consume("LOGIN_ACCOUNT", email, 10, 900);
        limits.consume("LOGIN_IP", ip, 50, 900);
        Secrets.decode(request.loginSecret(), 32);
        expireEmail(email);
        var account = accounts.find(email);
        boolean valid =
                encoder.matches(
                        request.loginSecret(),
                        account.map(Accounts.Account::verifier).orElse(dummyVerifier));
        if (!valid || account.isEmpty()) throw AuthFailure.denied();
        if (!account.get().admission().equals("PENDING")) account.get().requireAdmitted();
        return account.get();
    }

    private Map<String, Object> pending(int user) {
        var rows = Rows.query(db, "SELECT * FROM auth.PendingEnrollments WHERE UserId=?", user);
        if (rows.isEmpty()) throw AuthFailure.denied();
        return rows.getFirst();
    }

    private long revision(Map<String, Object> row) {
        return ((Number) row.get("Revision")).longValue();
    }

    private void expect(Map<String, Object> row, long revision) {
        if (revision(row) != revision) throw AuthFailure.conflict();
    }

    private Map<String, Object> state(EnrollmentSessions.Caller caller) {
        if (caller.account().admission().equals("ADMITTED"))
            return Map.of("status", "admitted", "email", caller.account().email());
        var row = pending(caller.account().id());
        var profile = new LinkedHashMap<String, Object>();
        for (String key :
                List.of(
                        "FirstName",
                        "LastName",
                        "RoleCode",
                        "InstituteId",
                        "DiplomaNumber",
                        "SpecializationId",
                        "StartYear",
                        "EndYear",
                        "DepartmentId",
                        "ProfessionId",
                        "Biography")) {
            String field =
                    key.equals("RoleCode")
                            ? "role"
                            : Character.toLowerCase(key.charAt(0)) + key.substring(1);
            profile.put(field, row.get(key));
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("status", "enrollment");
        result.put("email", caller.account().email());
        result.put("revision", revision(row));
        result.put("profile", profile);
        result.put(
                "avatar",
                Objects.toString(
                        db.queryForObject(
                                "SELECT ProfilePhotoUrl FROM dbo.Users WHERE UserId=?",
                                String.class,
                                caller.account().id()),
                        ""));
        result.put(
                "expiresAt",
                ((OffsetDateTime) row.get("SavedAt")).plusDays(7).toInstant().toString());
        var codes =
                Rows.query(
                        db,
                        "SELECT TOP(1) ChallengeId,ExpiresAt,ResendAfter FROM auth.EmailChallenges WHERE UserId=? AND Purpose='EMAIL_VERIFY' AND EnrollmentRevision=? AND BrowserHash=? AND ConsumedAt IS NULL AND ExpiresAt>? ORDER BY ExpiresAt DESC",
                        caller.account().id(),
                        revision(row),
                        Secrets.hash(caller.token()),
                        now());
        if (!codes.isEmpty()) {
            var code = codes.getFirst();
            result.put(
                    "challenge",
                    Map.of(
                            "challengeId",
                            code.get("ChallengeId").toString(),
                            "expiresAt",
                            ((OffsetDateTime) code.get("ExpiresAt")).toInstant().toString(),
                            "resendAfter",
                            ((OffsetDateTime) code.get("ResendAfter")).toInstant().toString()));
        }
        return result;
    }

    public Map<String, Object> state(HttpServletRequest request) {
        return tx.execute(status -> state(sessions.require(request, true)));
    }

    public Map<String, Object> options(HttpServletRequest request) {
        return tx.execute(
                status -> {
                    sessions.require(request, false);
                    return Map.of(
                            "specializations", options("Specializations", "SpecializationId"),
                            "institutes", options("Institutes", "InstituteId"),
                            "departments", options("Departments", "DepartmentId"),
                            "professions", options("Professions", "ProfessionId"));
                });
    }

    private List<Map<String, Object>> options(String table, String id) {
        return Rows.query(
                db,
                "SELECT TOP(1000) "
                        + id
                        + " AS id,Name AS name FROM dbo."
                        + table
                        + " ORDER BY "
                        + id);
    }

    private void reference(String table, String id, Integer value) {
        if (value == null
                || db.queryForObject(
                                "SELECT COUNT(*) FROM dbo." + table + " WHERE " + id + "=?",
                                Integer.class,
                                value)
                        != 1) throw AuthFailure.invalid();
    }

    public Map<String, Object> save(EnrollmentDtos.Profile input, HttpServletRequest request) {
        int user = tx.execute(status -> sessions.require(request, false).account().id());
        limits.consume("PROFILE_SAVE", "" + user, 30, 900);
        // Validate field structure/references, not eligibility, so mismatches remain editable.
        return tx.execute(
                status -> {
                    var caller = sessions.require(request, false);
                    int id = caller.account().id();

                    expect(pending(id), input.revision());
                    reference("Institutes", "InstituteId", input.instituteId());
                    if (EnrollmentRules.text(input.firstName()).isEmpty()
                            || EnrollmentRules.text(input.lastName()).isEmpty())
                        throw AuthFailure.invalid();
                    boolean graduate = input.role().equals("graduate");
                    if (graduate) {
                        reference("Specializations", "SpecializationId", input.specializationId());
                        if (EnrollmentRules.text(input.diplomaNumber()).isEmpty()
                                || input.startYear() == null
                                || input.endYear() == null
                                || input.startYear() > input.endYear()) throw AuthFailure.invalid();
                    } else {
                        reference("Departments", "DepartmentId", input.departmentId());
                        reference("Professions", "ProfessionId", input.professionId());
                    }
                    db.update(
                            "UPDATE auth.PendingEnrollments SET FirstName=?,LastName=?,RoleCode=?,InstituteId=?,DiplomaNumber=?,SpecializationId=?,StartYear=?,EndYear=?,DepartmentId=?,ProfessionId=?,Biography=?,Revision=Revision+1,SavedAt=?,ProfileComplete=1 WHERE UserId=?",
                            input.firstName().strip(),
                            input.lastName().strip(),
                            input.role(),
                            input.instituteId(),
                            graduate ? input.diplomaNumber().strip() : null,
                            graduate ? input.specializationId() : null,
                            graduate ? input.startYear() : null,
                            graduate ? input.endYear() : null,
                            graduate ? null : input.departmentId(),
                            graduate ? null : input.professionId(),
                            input.biography(),
                            now(),
                            id);
                    db.update(
                            "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND Purpose='EMAIL_VERIFY' AND ConsumedAt IS NULL",
                            now(),
                            id);
                    return state(caller);
                });
    }

    /**
     * A bounded registry lookup followed by JVM normalization avoids collation-based near matches.
     */
    private int match(Accounts.Account account, Map<String, Object> profile) {
        if (!Boolean.TRUE.equals(profile.get("ProfileComplete"))) throw mismatch();
        reference("Institutes", "InstituteId", (Integer) profile.get("InstituteId"));
        EnrollmentRules.universityEmail(account.email());
        boolean graduate = "graduate".equals(profile.get("RoleCode"));
        List<Map<String, Object>> rows =
                graduate
                        ? Rows.query(
                                db,
                                "SELECT TOP(1001) * FROM dbo.AlumniRegistry WITH(UPDLOCK,HOLDLOCK) WHERE SpecializationId=? AND YEAR(StudyStartDate)=? AND YEAR(StudyEndDate)=?",
                                profile.get("SpecializationId"),
                                profile.get("StartYear"),
                                profile.get("EndYear"))
                        : Rows.query(
                                db,
                                "SELECT TOP(2) * FROM dbo.LecturerRegistry WITH(UPDLOCK,HOLDLOCK) WHERE Email=?",
                                account.email());
        if (graduate) {
            if (rows.size() > 1000) throw mismatch();
            rows =
                    rows.stream()
                            .filter(
                                    r ->
                                            EnrollmentRules.text((String) r.get("DiplomaNumber"))
                                                    .equals(
                                                            EnrollmentRules.text(
                                                                    (String)
                                                                            profile.get(
                                                                                    "DiplomaNumber"))))
                            .toList();
        }
        if (rows.size() != 1) throw mismatch();
        var row = rows.getFirst();
        for (String key : List.of("FirstName", "LastName"))
            if (EnrollmentRules.text(row.get(key) == null ? null : row.get(key).toString())
                            .isEmpty()
                    || !EnrollmentRules.text((String) profile.get(key))
                            .equals(EnrollmentRules.text((String) row.get(key)))) throw mismatch();
        String column = graduate ? "AlumniRegistryId" : "LecturerRegistryId";
        if (graduate) {
            if (!EnrollmentRules.text((String) profile.get("DiplomaNumber"))
                            .equals(EnrollmentRules.text((String) row.get("DiplomaNumber")))
                    || !Objects.equals(profile.get("SpecializationId"), row.get("SpecializationId"))
                    || ((java.sql.Date) row.get("StudyStartDate")).toLocalDate().getYear()
                            != ((Number) profile.get("StartYear")).intValue()
                    || ((java.sql.Date) row.get("StudyEndDate")).toLocalDate().getYear()
                            != ((Number) profile.get("EndYear")).intValue()) throw mismatch();
        } else if (!account.email().equals(Accounts.email((String) row.get("Email")))
                || row.get("DepartmentId") == null
                || !row.get("DepartmentId").equals(profile.get("DepartmentId"))) throw mismatch();
        int registry = ((Number) row.get(column)).intValue();
        if (!Rows.query(
                        db,
                        "SELECT UserId FROM auth.RegistryClaims WITH(UPDLOCK,HOLDLOCK) WHERE "
                                + column
                                + "=?",
                        registry)
                .isEmpty()) throw mismatch();
        return registry;
    }

    private static AuthFailure mismatch() {
        return new AuthFailure(
                400,
                "REGISTRY_MISMATCH",
                "The selected registry could not verify these details. Review your profile or contact the university.");
    }

    public Map<String, Object> submit(long revision, HttpServletRequest request) {
        // All retries, including mismatches, consume limits outside the admitting transaction.
        limits.consume("SUBMIT_IP", request.getRemoteAddr(), 30, 1800);
        String email = tx.execute(status -> sessions.require(request, false).account().email());
        limits.issue(email, request.getRemoteAddr());
        var created =
                tx.execute(
                        status -> {
                            var caller = sessions.require(request, false);
                            var account = caller.account();

                            var profile = pending(account.id());
                            expect(profile, revision);
                            var recent =
                                    Rows.query(
                                            db,
                                            "SELECT TOP(1) ResendAfter FROM auth.EmailChallenges WHERE UserId=? AND Purpose='EMAIL_VERIFY' ORDER BY ResendAfter DESC",
                                            account.id());
                            if (!recent.isEmpty()
                                    && ((OffsetDateTime) recent.getFirst().get("ResendAfter"))
                                            .isAfter(now()))
                                throw new AuthFailure(
                                        429,
                                        "RATE_LIMITED",
                                        "Please wait before requesting another code.");
                            match(account, profile);
                            db.update(
                                    "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND Purpose='EMAIL_VERIFY' AND ConsumedAt IS NULL",
                                    now(),
                                    account.id());
                            var code =
                                    challenges.create(
                                            account.id(),
                                            "EMAIL_VERIFY",
                                            account.credential(),
                                            account.email(),
                                            caller.token());
                            db.update(
                                    "UPDATE auth.EmailChallenges SET EnrollmentRevision=? WHERE ChallengeId=?",
                                    revision,
                                    code.id());
                            return code;
                        });
        challenges.deliver(created);
        return created.response();
    }

    public Map<String, Object> resend(UUID challenge, HttpServletRequest request) {
        long revision =
                tx.execute(
                        status -> {
                            var caller = sessions.require(request, false);
                            var profile = pending(caller.account().id());
                            if (Rows.query(
                                            db,
                                            "SELECT ChallengeId FROM auth.EmailChallenges WHERE ChallengeId=? AND UserId=? AND EnrollmentRevision=? AND BrowserHash=? AND ConsumedAt IS NULL",
                                            challenge,
                                            caller.account().id(),
                                            revision(profile),
                                            Secrets.hash(caller.token()))
                                    .isEmpty()) throw AuthFailure.denied();
                            return revision(profile);
                        });
        return submit(revision, request);
    }

    public Map<String, Object> verifyEmail(AuthDtos.CodeProof proof, HttpServletRequest request) {
        limits.consume("VERIFY_IP", request.getRemoteAddr(), 50, 1800);
        int user = tx.execute(status -> sessions.require(request, true).account().id());
        limits.consume("VERIFY_ACCOUNT", "" + user, 10, 1800);
        var result =
                tx.execute(
                        status -> {
                            var caller = sessions.require(request, true);
                            var account = caller.account();
                            boolean retry = account.admission().equals("ADMITTED");
                            var profile = retry ? null : pending(account.id());
                            if (retry
                                    && !proof.challengeId()
                                            .toString()
                                            .equalsIgnoreCase(
                                                    Objects.toString(
                                                            caller.session()
                                                                    .get("CompletedChallengeId"))))
                                throw AuthFailure.denied();
                            // False results commit failed-attempt counters but never change
                            // admission.
                            if (!challenges.checkEnrollment(
                                    proof,
                                    caller.token(),
                                    account,
                                    profile == null ? null : revision(profile),
                                    retry)) return null;
                            if (retry)
                                return Map.<String, Object>of(
                                        "status", "admitted", "email", account.email());
                            int registry = match(account, profile);
                            boolean graduate = "graduate".equals(profile.get("RoleCode"));
                            db.update(
                                    "INSERT auth.RegistryClaims(UserId,AlumniRegistryId,LecturerRegistryId,VerifiedAt,ProfileRevision) VALUES (?,?,?,?,?)",
                                    account.id(),
                                    graduate ? registry : null,
                                    graduate ? null : registry,
                                    now(),
                                    revision(profile));
                            db.update(
                                    "INSERT auth.RegistryClaimAudit(UserId,AlumniRegistryId,LecturerRegistryId,Action,Actor) VALUES (?,?,?,'ADMIT','enrollment')",
                                    account.id(),
                                    graduate ? registry : null,
                                    graduate ? null : registry);
                            int role =
                                    db.queryForObject(
                                            "SELECT RoleId FROM dbo.Roles WHERE Name=?",
                                            Integer.class,
                                            profile.get("RoleCode"));
                            String job =
                                    graduate
                                            ? db.queryForObject(
                                                    "SELECT Name FROM dbo.Specializations WHERE SpecializationId=?",
                                                    String.class,
                                                    profile.get("SpecializationId"))
                                            : db.queryForObject(
                                                    "SELECT Name FROM dbo.Professions WHERE ProfessionId=?",
                                                    String.class,
                                                    profile.get("ProfessionId"));
                            db.update(
                                    "UPDATE dbo.Users SET FirstName=?,LastName=?,RoleId=?,Specialization=?,About=? WHERE UserId=?",
                                    profile.get("FirstName"),
                                    profile.get("LastName"),
                                    role,
                                    job.substring(0, Math.min(job.length(), 150)),
                                    profile.get("Biography"),
                                    account.id());
                            int university =
                                    db.queryForObject(
                                            "SELECT UniversityId FROM dbo.Universities WHERE Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան'",
                                            Integer.class);
                            if (graduate)
                                db.update(
                                        "INSERT dbo.Education(UserId,UniversityId,InstituteId,StartDate,EndDate,SpecializationId) SELECT ?,?,?,StudyStartDate,StudyEndDate,SpecializationId FROM dbo.AlumniRegistry WHERE AlumniRegistryId=?",
                                        account.id(),
                                        university,
                                        profile.get("InstituteId"),
                                        registry);
                            else {
                                db.update(
                                        "INSERT dbo.Education(UserId,UniversityId,InstituteId) VALUES (?,?,?)",
                                        account.id(),
                                        university,
                                        profile.get("InstituteId"));
                                db.update(
                                        "INSERT dbo.Lecturers(UserId,DepartmentId,ProfessionId) VALUES (?,?,?)",
                                        account.id(),
                                        profile.get("DepartmentId"),
                                        profile.get("ProfessionId"));
                            }
                            db.update(
                                    "UPDATE auth.AccountSecurity SET AdmissionStatus='ADMITTED',EmailVerifiedAt=?,UpdatedAt=? WHERE UserId=?",
                                    now(),
                                    now(),
                                    account.id());
                            db.update(
                                    "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND Purpose='EMAIL_VERIFY' AND ConsumedAt IS NULL",
                                    now(),
                                    account.id());
                            db.update(
                                    "UPDATE auth.EnrollmentSessions SET CompletedChallengeId=? WHERE TokenHash=?",
                                    proof.challengeId(),
                                    Secrets.hash(caller.token()));
                            db.update(
                                    "DELETE auth.PendingEnrollments WHERE UserId=?", account.id());
                            return Map.<String, Object>of(
                                    "status", "admitted", "email", account.email());
                        });
        if (result == null) throw AuthFailure.denied();
        return result;
    }

    public Map<String, Object> resetPassword(
            EnrollmentDtos.Password input, HttpServletRequest request) {
        Secrets.decode(input.loginSecret(), 32);
        byte[] salt = Secrets.decode(input.derivation().salt(), 16);
        String verifier = encoder.encode(input.loginSecret());
        return tx.execute(
                status -> {
                    var caller = sessions.require(request, false);
                    int user = caller.account().id();
                    db.update(
                            "UPDATE auth.AccountSecurity SET CredentialVersion=CredentialVersion+1,ClientSalt=?,ClientOpsLimit=?,ClientMemoryBytes=?,LoginVerifier=?,UpdatedAt=? WHERE UserId=?",
                            salt,
                            input.derivation().opsLimit(),
                            input.derivation().memoryBytes(),
                            verifier,
                            now(),
                            user);
                    db.update(
                            "UPDATE auth.PendingEnrollments SET CredentialVersion=CredentialVersion+1,Revision=Revision+1 WHERE UserId=?",
                            user);
                    db.update(
                            "UPDATE auth.EnrollmentSessions SET RevokedAt=? WHERE UserId=? AND TokenHash<>?",
                            now(),
                            user,
                            Secrets.hash(caller.token()));
                    db.update(
                            "UPDATE auth.EnrollmentSessions SET CredentialVersion=CredentialVersion+1 WHERE TokenHash=?",
                            Secrets.hash(caller.token()));
                    db.update(
                            "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND ConsumedAt IS NULL",
                            now(),
                            user);
                    return Map.of("status", "enrollment");
                });
    }

    public void expireEmail(String email) {
        accounts.find(email)
                .filter(a -> a.admission().equals("PENDING"))
                .ifPresent(a -> expire(a.id()));
    }

    public void expire(int user) {
        tx.executeWithoutResult(
                status -> {
                    var account = accounts.lock(user);
                    if (!account.admission().equals("PENDING")) return;
                    var rows =
                            Rows.query(
                                    db,
                                    "SELECT SavedAt FROM auth.PendingEnrollments WITH(UPDLOCK,HOLDLOCK) WHERE UserId=?",
                                    user);
                    if (rows.isEmpty()
                            || ((OffsetDateTime) rows.getFirst().get("SavedAt"))
                                    .plusDays(7)
                                    .isAfter(now())) return;
                    // Never delete cryptographic state, even if an unexpected historical pending
                    // row has it.
                    if (db.queryForObject(
                                    "SELECT (SELECT COUNT(*) FROM keyvault.Identities WHERE UserId=?)+(SELECT COUNT(*) FROM keyvault.Operations WHERE UserId=?)+(SELECT COUNT(*) FROM auth.RegistryClaims WHERE UserId=?)",
                                    Integer.class,
                                    user,
                                    user,
                                    user)
                            != 0) return;
                    db.update("DELETE auth.EnrollmentSessions WHERE UserId=?", user);
                    db.update("DELETE auth.EmailChallenges WHERE UserId=?", user);
                    db.update(
                            "DELETE t FROM auth.AccessTokens t JOIN auth.Sessions s ON s.SessionId=t.SessionId WHERE s.UserId=?",
                            user);
                    db.update("DELETE auth.Sessions WHERE UserId=?", user);
                    db.update("DELETE auth.PendingEnrollments WHERE UserId=?", user);
                    db.update("DELETE auth.AccountSecurity WHERE UserId=?", user);
                    db.update("DELETE dbo.UserNotificationSettings WHERE UserId=?", user);
                    db.update(
                            "UPDATE dbo.Users SET FirstName=N'Expired',LastName=N'enrollment',Email=?,About=NULL,Specialization=NULL,IsProfilePublic=0 WHERE UserId=?",
                            "expired-" + user + "@deleted.invalid",
                            user);
                });
    }
}
