-- Registry admission replaces invitations. No registry identities or synthetic data are seeded.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER TABLE dbo.LecturerRegistry ADD FirstName nvarchar(100) NULL, LastName nvarchar(100) NULL;
ALTER TABLE auth.AccountSecurity ADD GrandfatheredAdmission bit NOT NULL CONSTRAINT DF_GrandfatheredAdmission DEFAULT 0;
UPDATE auth.AccountSecurity SET GrandfatheredAdmission=1
WHERE AdmissionStatus='ADMITTED' OR (AdmissionStatus='DEACTIVATED' AND EmailVerifiedAt IS NOT NULL);
UPDATE auth.Invitations SET RevokedAt=SYSDATETIMEOFFSET() WHERE ConsumedUserId IS NULL AND RevokedAt IS NULL;
ALTER TABLE auth.PendingEnrollments ALTER COLUMN InvitationId uniqueidentifier NULL;
ALTER TABLE auth.PendingEnrollments ADD
    Revision bigint NOT NULL CONSTRAINT DF_EnrollmentRevision DEFAULT 1,
    SavedAt datetimeoffset(3) NOT NULL CONSTRAINT DF_EnrollmentSaved DEFAULT SYSDATETIMEOFFSET(),
    DiplomaNumber nvarchar(100) NULL,
    SpecializationId int NULL REFERENCES dbo.Specializations(SpecializationId),
    StartYear int NULL,
    EndYear int NULL,
    DepartmentId int NULL REFERENCES dbo.Departments(DepartmentId),
    ProfessionId int NULL REFERENCES dbo.Professions(ProfessionId),
    Biography nvarchar(2000) NULL,
    ProfileComplete bit NOT NULL CONSTRAINT DF_EnrollmentComplete DEFAULT 0;
ALTER TABLE auth.PendingEnrollments ADD CONSTRAINT CK_EnrollmentYears CHECK
    ((StartYear IS NULL AND EndYear IS NULL) OR (StartYear BETWEEN 1900 AND 2200 AND EndYear BETWEEN StartYear AND 2200));
ALTER TABLE auth.EmailChallenges ADD EnrollmentRevision bigint NULL;
-- Pre-rollout email codes cannot be used to admit accounts.
UPDATE auth.EmailChallenges SET ConsumedAt=SYSDATETIMEOFFSET() WHERE Purpose='EMAIL_VERIFY' AND ConsumedAt IS NULL;
CREATE TABLE auth.EnrollmentSessions (
    TokenHash binary(32) NOT NULL PRIMARY KEY,
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    CredentialVersion bigint NOT NULL,
    CsrfHash binary(32) NOT NULL,
    IdleExpiresAt datetimeoffset(3) NOT NULL,
    AbsoluteExpiresAt datetimeoffset(3) NOT NULL,
    RevokedAt datetimeoffset(3) NULL,
    CompletedChallengeId uniqueidentifier NULL
);
CREATE INDEX IX_EnrollmentSessionUser ON auth.EnrollmentSessions(UserId);
CREATE TABLE auth.RegistryClaims (
    UserId int NOT NULL PRIMARY KEY REFERENCES auth.AccountSecurity(UserId),
    AlumniRegistryId int NULL REFERENCES dbo.AlumniRegistry(AlumniRegistryId),
    LecturerRegistryId int NULL REFERENCES dbo.LecturerRegistry(LecturerRegistryId),
    VerifiedAt datetimeoffset(3) NOT NULL,
    ProfileRevision bigint NOT NULL,
    CONSTRAINT CK_RegistryClaimRole CHECK
        ((AlumniRegistryId IS NOT NULL AND LecturerRegistryId IS NULL) OR (AlumniRegistryId IS NULL AND LecturerRegistryId IS NOT NULL))
);
CREATE UNIQUE INDEX UX_ClaimAlumni ON auth.RegistryClaims(AlumniRegistryId) WHERE AlumniRegistryId IS NOT NULL;
CREATE UNIQUE INDEX UX_ClaimLecturer ON auth.RegistryClaims(LecturerRegistryId) WHERE LecturerRegistryId IS NOT NULL;
CREATE TABLE auth.RegistryClaimAudit (
    AuditId bigint IDENTITY PRIMARY KEY,
    UserId int NOT NULL,
    AlumniRegistryId int NULL,
    LecturerRegistryId int NULL,
    Action varchar(16) NOT NULL,
    Actor nvarchar(200) NOT NULL,
    RecordedAt datetimeoffset(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO
