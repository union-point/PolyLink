-- Staged: retain original timestamps and nullable historical metadata verbatim.
ALTER TABLE dbo.PostTypes ADD Code varchar(16) COLLATE SQL_Latin1_General_CP1_CI_AS NULL;
GO
-- Explicit mapping of canonical Armenian labels only. Unknown historical types stay unmapped.
UPDATE dbo.PostTypes SET Code=CASE Name WHEN N'Աշխատանք' THEN 'job' WHEN N'Պրակտիկա' THEN 'internship' WHEN N'Դասընթաց' THEN 'training' END;
INSERT dbo.PostTypes(Code,Name)
SELECT v.Code,v.Name FROM (VALUES ('job',N'Աշխատանք'),('internship',N'Պրակտիկա'),('training',N'Դասընթաց')) v(Code,Name)
WHERE NOT EXISTS(SELECT 1 FROM dbo.PostTypes t WHERE t.Code=v.Code);
CREATE UNIQUE INDEX UX_PostTypes_Code ON dbo.PostTypes(Code) WHERE Code IS NOT NULL;
ALTER TABLE dbo.Spheres ADD Code varchar(32) COLLATE SQL_Latin1_General_CP1_CI_AS NULL;
GO
UPDATE dbo.Spheres SET Code='other' WHERE Name=N'Այլ';
IF NOT EXISTS(SELECT 1 FROM dbo.Spheres WHERE Code='other') INSERT dbo.Spheres(Code,Name) VALUES ('other',N'Այլ');
CREATE UNIQUE INDEX UX_Spheres_Code ON dbo.Spheres(Code) WHERE Code IS NOT NULL;
ALTER TABLE dbo.Posts ADD CreatedAtUtc datetimeoffset(7) NULL, UpdatedAtUtc datetimeoffset(7) NULL;
ALTER TABLE dbo.PostComments ADD CreatedAtUtc datetimeoffset(7) NULL, UpdatedAtUtc datetimeoffset(7) NULL;
ALTER TABLE dbo.PostComments DROP CONSTRAINT FK__PostComme__PostI__09A971A2;
ALTER TABLE dbo.PostComments ADD CONSTRAINT FK__PostComme__PostI__09A971A2 FOREIGN KEY(PostId) REFERENCES dbo.Posts(PostId);
ALTER TABLE dbo.UserNotificationSettings ADD PostCommentNotifications bit NOT NULL CONSTRAINT DF_Notification_PostComment DEFAULT(1);
ALTER TABLE auth.ActivityNotifications ADD PostId int NULL, CommentId int NULL;
GO
-- The original kind constraint is system-named. Inspect dependencies and replace only that check.
DECLARE @constraint sysname;
SELECT @constraint=c.name FROM sys.check_constraints c
WHERE c.parent_object_id=OBJECT_ID(N'auth.ActivityNotifications') AND c.definition LIKE '%DIRECT_MESSAGE%' AND c.definition LIKE '%ANNOUNCEMENT%' AND c.definition LIKE '%FORUM_REPLY%';
IF @constraint IS NULL THROW 51000,'Expected notification kind constraint missing; inspect schema before upgrade.',1;
DECLARE @sql nvarchar(max)=N'ALTER TABLE auth.ActivityNotifications DROP CONSTRAINT '+QUOTENAME(@constraint);
EXEC(@sql);
ALTER TABLE auth.ActivityNotifications ADD CONSTRAINT CK_ActivityNotifications_Kind CHECK(Kind IN ('DIRECT_MESSAGE','ANNOUNCEMENT','FORUM_REPLY','POST_COMMENT'));
CREATE INDEX IX_ActivityNotifications_Post ON auth.ActivityNotifications(PostId,CommentId) WHERE Kind='POST_COMMENT';
CREATE UNIQUE INDEX UX_ActivityNotifications_Comment ON auth.ActivityNotifications(UserId,CommentId) WHERE Kind='POST_COMMENT';
CREATE INDEX IX_ActivityNotifications_History ON auth.ActivityNotifications(UserId,Id DESC);
CREATE TABLE auth.PostsLegacyReview (
 Kind varchar(8) NOT NULL, RecordId int NOT NULL, OriginalCreatedAt datetime2(7) NOT NULL,
 SourceTimezone nvarchar(100) NOT NULL, Operator nvarchar(100) NOT NULL, ReviewedAt datetimeoffset(7) NOT NULL,
 CONSTRAINT PK_PostsLegacyReview PRIMARY KEY(Kind,RecordId)
);
GO
