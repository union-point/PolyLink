IF NOT EXISTS(SELECT 1 FROM dbo.Languages WHERE Code=N'hy') INSERT dbo.Languages(Code,Name) VALUES (N'hy',N'Armenian');
GO
CREATE TABLE auth.ExportGrants (
 GrantHash binary(32) NOT NULL PRIMARY KEY, UserId int NOT NULL REFERENCES dbo.Users(UserId),
 FamilyId uniqueidentifier NOT NULL, CredentialVersion bigint NOT NULL, ExpiresAt datetimeoffset(3) NOT NULL
);
GO
