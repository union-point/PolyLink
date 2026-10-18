-- Email-bound admission is operator-controlled; no legacy account is implicitly admitted.
CREATE TABLE auth.Invitations (
    InvitationId uniqueidentifier NOT NULL CONSTRAINT PK_Invitations PRIMARY KEY,
    Email nvarchar(255) NOT NULL,
    RoleCode varchar(16) NOT NULL CONSTRAINT CK_InvitationRole CHECK (RoleCode IN ('graduate','lecturer')),
    ExpiresAt datetimeoffset(3) NOT NULL,
    ConsumedUserId int NULL REFERENCES dbo.Users(UserId),
    RevokedAt datetimeoffset(3) NULL
);
CREATE UNIQUE INDEX UX_OpenInvitation ON auth.Invitations(Email) WHERE ConsumedUserId IS NULL AND RevokedAt IS NULL;
CREATE TABLE auth.PendingEnrollments (
    UserId int NOT NULL CONSTRAINT PK_PendingEnrollments PRIMARY KEY REFERENCES auth.AccountSecurity(UserId),
    InvitationId uniqueidentifier NOT NULL REFERENCES auth.Invitations(InvitationId),
    CredentialVersion bigint NOT NULL,
    FirstName nvarchar(100) NOT NULL,
    LastName nvarchar(100) NOT NULL,
    RoleCode varchar(16) NOT NULL CONSTRAINT CK_PendingRole CHECK (RoleCode IN ('graduate','lecturer'))
);
ALTER TABLE auth.EmailChallenges ADD CredentialVersion bigint NOT NULL CONSTRAINT DF_ChallengeCredential DEFAULT 1;
ALTER TABLE auth.EmailChallenges ADD BrowserHash binary(32) NULL;
ALTER TABLE auth.Sessions ADD CsrfHash binary(32) NOT NULL CONSTRAINT DF_SessionCsrf DEFAULT 0x0;
ALTER TABLE auth.Sessions ADD PreviousRefreshHash binary(32) NULL;
ALTER TABLE auth.Sessions ADD ReplayUntil datetimeoffset(3) NULL;
ALTER TABLE auth.Sessions ADD ReplayPacket varbinary(max) NULL;
GO
CREATE UNIQUE INDEX UX_PreviousRefresh ON auth.Sessions(PreviousRefreshHash) WHERE PreviousRefreshHash IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE Name=N'graduate') INSERT dbo.Roles(Name) VALUES (N'graduate');
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE Name=N'lecturer') INSERT dbo.Roles(Name) VALUES (N'lecturer');
IF NOT EXISTS (SELECT 1 FROM dbo.Languages WHERE Code=N'en') INSERT dbo.Languages(Code,Name) VALUES (N'en',N'English');
GO
