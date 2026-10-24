-- One bounded, normalized avatar per account; retained when enrollment is admitted.
CREATE TABLE auth.ProfileAvatars (
    UserId int NOT NULL PRIMARY KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    PhotoId uniqueidentifier NOT NULL UNIQUE,
    Content varbinary(max) NOT NULL,
    CONSTRAINT CK_ProfileAvatarSize CHECK (DATALENGTH(Content) BETWEEN 1 AND 262144)
);
