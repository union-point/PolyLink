ALTER TABLE dbo.Users ADD ShowEmail bit NOT NULL CONSTRAINT DF_Users_ShowEmail DEFAULT (0);
GO
INSERT dbo.Languages(Code,Name) SELECT N'ru',N'Russian' WHERE NOT EXISTS(SELECT 1 FROM dbo.Languages WHERE Code=N'ru');
UPDATE dbo.UserNotificationSettings SET NewListingNotifications=COALESCE(NewListingNotifications,1),ForumReplyNotifications=COALESCE(ForumReplyNotifications,1),DirectMessageNotifications=COALESCE(DirectMessageNotifications,1),EmailEnabled=COALESCE(EmailEnabled,1);
INSERT dbo.UserNotificationSettings(UserId) SELECT UserId FROM dbo.Users u WHERE NOT EXISTS(SELECT 1 FROM dbo.UserNotificationSettings n WHERE n.UserId=u.UserId);
ALTER TABLE dbo.UserNotificationSettings ALTER COLUMN NewListingNotifications bit NOT NULL;
ALTER TABLE dbo.UserNotificationSettings ALTER COLUMN ForumReplyNotifications bit NOT NULL;
ALTER TABLE dbo.UserNotificationSettings ALTER COLUMN DirectMessageNotifications bit NOT NULL;
ALTER TABLE dbo.UserNotificationSettings ALTER COLUMN EmailEnabled bit NOT NULL;
GO
CREATE TABLE auth.EmailChanges (
 UserId int NOT NULL PRIMARY KEY REFERENCES dbo.Users(UserId), RequestId uniqueidentifier NOT NULL,
 FamilyId uniqueidentifier NOT NULL, CredentialVersion bigint NOT NULL, OldEmail nvarchar(255) NOT NULL, NewEmail nvarchar(255) NOT NULL,
 EmailFactor bit NOT NULL, Stage varchar(3) NOT NULL, CodeMac varbinary(32) NOT NULL,
 Attempts int NOT NULL, ExpiresAt datetimeoffset(3) NOT NULL, ResendAfter datetimeoffset(3) NOT NULL
);
CREATE TABLE auth.SecurityMailOutbox (
 Id uniqueidentifier NOT NULL PRIMARY KEY, Email nvarchar(255) NOT NULL, CreatedAt datetimeoffset(3) NOT NULL,
 DeliveredAt datetimeoffset(3) NULL, RetryAt datetimeoffset(3) NOT NULL
);
GO
CREATE TABLE auth.ActivityNotifications (
 Id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY, UserId int NOT NULL REFERENCES dbo.Users(UserId),
 Kind varchar(16) NOT NULL CHECK(Kind IN ('DIRECT_MESSAGE','ANNOUNCEMENT','FORUM_REPLY')),
 EventKey nvarchar(150) NOT NULL, ActorId int NOT NULL, RoomId uniqueidentifier NULL, Sequence bigint NULL,
 CreatedAt datetimeoffset(3) NOT NULL, EmailDone bit NOT NULL DEFAULT(0), RetryAt datetimeoffset(3) NOT NULL,
 CONSTRAINT UQ_ActivityEvent UNIQUE(UserId,Kind,EventKey)
);
GO
