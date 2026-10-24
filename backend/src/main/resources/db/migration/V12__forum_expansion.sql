CREATE SCHEMA forum;
GO
CREATE TABLE dbo.ForumCategories (
 CategoryId int IDENTITY(1,1) NOT NULL CONSTRAINT PK_ForumCategories PRIMARY KEY,
 Code varchar(32) NOT NULL CONSTRAINT UQ_ForumCategories_Code UNIQUE,
 Name nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL
);
INSERT dbo.ForumCategories(Code,Name) VALUES
 ('informatics',N'Ինֆորմատիկա և ծրագրավորում'),
 ('mechanics',N'Մեքենաշինություն և ռոբոտաշինություն'),
 ('electronics',N'Էլեկտրոնիկա և հեռահաղորդակցություն'),
 ('civil',N'Շինարարություն և ճարտարապետություն'),
 ('energy',N'Էներգետիկա և կայուն զարգացում'),
 ('management',N'Տեխնիկական կառավարում և տնտեսագիտություն');
ALTER TABLE dbo.ForumTopics ADD CategoryId int NULL,
 ContentVersion bigint NOT NULL CONSTRAINT DF_ForumTopics_Version DEFAULT(1),
 CreatedAtUtc datetimeoffset(7) NULL CONSTRAINT DF_ForumTopics_Utc DEFAULT(SYSUTCDATETIME()),
 UpdatedAtUtc datetimeoffset(7) NULL;
ALTER TABLE dbo.ForumTopics ADD CONSTRAINT FK_ForumTopics_Category FOREIGN KEY(CategoryId) REFERENCES dbo.ForumCategories(CategoryId);
ALTER TABLE dbo.ForumReplies ADD
 ContentVersion bigint NOT NULL CONSTRAINT DF_ForumReplies_Version DEFAULT(1),
 CreatedAtUtc datetimeoffset(7) NULL CONSTRAINT DF_ForumReplies_Utc DEFAULT(SYSUTCDATETIME()),
 UpdatedAtUtc datetimeoffset(7) NULL;
CREATE INDEX IX_ForumTopics_CategoryDate ON dbo.ForumTopics(CategoryId,CreatedAtUtc DESC,TopicId DESC);
CREATE INDEX IX_ForumTopics_Date ON dbo.ForumTopics(CreatedAtUtc DESC,TopicId DESC);
CREATE INDEX IX_ForumReplies_TopicDate ON dbo.ForumReplies(TopicId,CreatedAtUtc DESC,ReplyId DESC);
CREATE INDEX IX_ForumReplyLikes_Reply ON dbo.ForumReplyLikes(ReplyId);
GO
CREATE TABLE forum.CreateRequests (
 UserId int NOT NULL REFERENCES dbo.Users(UserId), Operation varchar(16) NOT NULL,
 RequestId uniqueidentifier NOT NULL, Fingerprint char(64) NOT NULL, ResourceId int NOT NULL,
 CreatedAt datetimeoffset(7) NOT NULL,
 CONSTRAINT PK_ForumCreateRequests PRIMARY KEY(UserId,Operation,RequestId)
);
CREATE INDEX IX_ForumCreateRequests_Expiry ON forum.CreateRequests(CreatedAt);
CREATE TABLE forum.LegacyReview (
 Kind varchar(8) NOT NULL, RecordId int NOT NULL, OriginalCreatedAt datetime2(7) NOT NULL,
 SourceTimezone nvarchar(100) NOT NULL, Operator nvarchar(100) NOT NULL, ReviewedAt datetimeoffset(7) NOT NULL,
 CONSTRAINT PK_ForumLegacyReview PRIMARY KEY(Kind,RecordId)
);
CREATE TABLE forum.Takedowns (
 Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_ForumTakedowns PRIMARY KEY,
 TopicId int NOT NULL, Operator nvarchar(100) NOT NULL, Reason nvarchar(1000) NOT NULL,
 RemovedAt datetimeoffset(7) NOT NULL, ReplyCount int NOT NULL
);
ALTER TABLE auth.ActivityNotifications ADD TopicId int NULL, ReplyId int NULL;
CREATE INDEX IX_ActivityNotifications_Forum ON auth.ActivityNotifications(TopicId,ReplyId) WHERE Kind='FORUM_REPLY';
GO
