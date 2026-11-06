-- Separate admin identities do not create members, education, claims or key vaults.
CREATE SCHEMA admin;
GO
CREATE TABLE admin.Admins (
    AdminId int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Admins PRIMARY KEY,
    Email nvarchar(255) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT UQ_Admins_Email UNIQUE,
    FirstName nvarchar(100) NOT NULL,
    LastName nvarchar(100) NOT NULL,
    ClientSalt binary(16) NOT NULL,
    ClientOpsLimit int NOT NULL,
    ClientMemoryBytes bigint NOT NULL,
    LoginVerifier varchar(512) NOT NULL,
    EmailVerifiedAt datetimeoffset(3) NOT NULL,
    Enabled bit NOT NULL CONSTRAINT DF_Admins_Enabled DEFAULT(1),
    SessionVersion bigint NOT NULL CONSTRAINT DF_Admins_Version DEFAULT(1),
    CONSTRAINT CK_Admins_Derivation CHECK (ClientOpsLimit BETWEEN 2 AND 4 AND ClientMemoryBytes BETWEEN 67108864 AND 268435456),
    CONSTRAINT CK_Admins_Version CHECK (SessionVersion>0)
);
CREATE TABLE admin.Invitations (
    InvitationId uniqueidentifier NOT NULL CONSTRAINT PK_AdminInvitations PRIMARY KEY,
    TokenHash binary(32) NOT NULL CONSTRAINT UQ_AdminInvitations_Token UNIQUE,
    Email nvarchar(255) COLLATE Latin1_General_100_BIN2 NOT NULL,
    CreatedAt datetimeoffset(3) NOT NULL,
    ExpiresAt datetimeoffset(3) NOT NULL,
    ConsumedAdminId int NULL CONSTRAINT FK_AdminInvitations_Admin REFERENCES admin.Admins(AdminId),
    ConsumedAt datetimeoffset(3) NULL,
    CONSTRAINT CK_AdminInvitation_Expiry CHECK (ExpiresAt=DATEADD(hour,24,CreatedAt)),
    CONSTRAINT CK_AdminInvitation_Consumed CHECK ((ConsumedAt IS NULL AND ConsumedAdminId IS NULL) OR (ConsumedAt IS NOT NULL AND ConsumedAdminId IS NOT NULL))
);
CREATE INDEX IX_AdminInvitations_Expiry ON admin.Invitations(ExpiresAt);
CREATE TABLE admin.Challenges (
    ChallengeId uniqueidentifier NOT NULL CONSTRAINT PK_AdminChallenges PRIMARY KEY,
    Purpose varchar(8) NOT NULL,
    InvitationId uniqueidentifier NULL CONSTRAINT FK_AdminChallenges_Invitation REFERENCES admin.Invitations(InvitationId),
    AdminId int NULL CONSTRAINT FK_AdminChallenges_Admin REFERENCES admin.Admins(AdminId),
    SessionVersion bigint NULL,
    BrowserHash binary(32) NOT NULL,
    CsrfHash binary(32) NOT NULL,
    CodeMac binary(32) NOT NULL,
    FailedAttempts int NOT NULL CONSTRAINT DF_AdminChallenge_Attempts DEFAULT(0),
    ExpiresAt datetimeoffset(3) NOT NULL,
    ResendAfter datetimeoffset(3) NOT NULL,
    ConsumedAt datetimeoffset(3) NULL,
    CompletedAdminId int NULL CONSTRAINT FK_AdminChallenges_CompletedAdmin REFERENCES admin.Admins(AdminId),
    FirstName nvarchar(100) NULL,
    LastName nvarchar(100) NULL,
    ClientSalt binary(16) NULL,
    ClientOpsLimit int NULL,
    ClientMemoryBytes bigint NULL,
    LoginVerifier varchar(512) NULL,
    CONSTRAINT CK_AdminChallenge_Attempts CHECK (FailedAttempts BETWEEN 0 AND 5),
    CONSTRAINT CK_AdminChallenge_Purpose CHECK (
      (Purpose='LOGIN' AND AdminId IS NOT NULL AND SessionVersion IS NOT NULL AND InvitationId IS NULL)
      OR (Purpose='REGISTER' AND InvitationId IS NOT NULL AND AdminId IS NULL AND SessionVersion IS NULL
          AND FirstName IS NOT NULL AND LastName IS NOT NULL AND ClientSalt IS NOT NULL
          AND ClientOpsLimit IS NOT NULL AND ClientMemoryBytes IS NOT NULL AND LoginVerifier IS NOT NULL)),
    CONSTRAINT CK_AdminChallenge_Derivation CHECK (ClientOpsLimit BETWEEN 2 AND 4 AND ClientMemoryBytes BETWEEN 67108864 AND 268435456)
);
CREATE INDEX IX_AdminChallenges_Admin ON admin.Challenges(AdminId);
CREATE INDEX IX_AdminChallenges_Invitation ON admin.Challenges(InvitationId);
CREATE INDEX IX_AdminChallenges_Expiry ON admin.Challenges(ExpiresAt);
CREATE TABLE admin.Sessions (
    TokenHash binary(32) NOT NULL CONSTRAINT PK_AdminSessions PRIMARY KEY,
    AdminId int NOT NULL CONSTRAINT FK_AdminSessions_Admin REFERENCES admin.Admins(AdminId),
    SessionVersion bigint NOT NULL,
    CsrfHash binary(32) NOT NULL,
    IdleExpiresAt datetimeoffset(3) NOT NULL,
    AbsoluteExpiresAt datetimeoffset(3) NOT NULL,
    RevokedAt datetimeoffset(3) NULL
);
CREATE INDEX IX_AdminSessions_Admin ON admin.Sessions(AdminId);
CREATE INDEX IX_AdminSessions_Expiry ON admin.Sessions(AbsoluteExpiresAt);
CREATE TABLE admin.SystemReferences (
    Resource varchar(32) NOT NULL,
    ReferenceId int NOT NULL,
    SystemCode varchar(64) NOT NULL CONSTRAINT UQ_AdminSystemReference_Code UNIQUE,
    CONSTRAINT PK_AdminSystemReferences PRIMARY KEY(Resource,ReferenceId),
    CONSTRAINT CK_AdminSystemReference_Resource CHECK (Resource IN ('universities','post-types','post-spheres'))
);
GO
IF (SELECT COUNT(*) FROM dbo.Universities WHERE Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան')<>1
    THROW 50230,'Review the main Polytechnic identity before installing admin management.',1;
INSERT admin.SystemReferences(Resource,ReferenceId,SystemCode)
SELECT 'universities',UniversityId,'polytechnic' FROM dbo.Universities
WHERE Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան';
INSERT admin.SystemReferences(Resource,ReferenceId,SystemCode)
SELECT 'post-types',PostTypeId,'post-type-'+Code FROM dbo.PostTypes WHERE Code IN ('job','internship','training');
INSERT admin.SystemReferences(Resource,ReferenceId,SystemCode)
SELECT 'post-spheres',SphereId,'post-sphere-other' FROM dbo.Spheres WHERE Code='other';
IF (SELECT COUNT(*) FROM admin.SystemReferences)<>5
    THROW 50231,'Review required post reference codes before installing admin management.',1;
