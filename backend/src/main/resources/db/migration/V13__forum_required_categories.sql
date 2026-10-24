IF EXISTS(SELECT 1 FROM dbo.ForumTopics WHERE CategoryId IS NULL OR CreatedAtUtc IS NULL)
 OR EXISTS(SELECT 1 FROM dbo.ForumReplies WHERE CreatedAtUtc IS NULL)
 THROW 51000,'Forum legacy review required: stop at V12 and run ForumMaintenanceCommand inspect/dry-run/apply with reviewed categories and timezone.',1;
GO
DROP INDEX IX_ForumTopics_CategoryDate ON dbo.ForumTopics;
DROP INDEX IX_ForumTopics_Date ON dbo.ForumTopics;
DROP INDEX IX_ForumReplies_TopicDate ON dbo.ForumReplies;
ALTER TABLE dbo.ForumTopics DROP CONSTRAINT FK_ForumTopics_Category;
ALTER TABLE dbo.ForumTopics ALTER COLUMN CategoryId int NOT NULL;
ALTER TABLE dbo.ForumTopics ALTER COLUMN CreatedAtUtc datetimeoffset(7) NOT NULL;
ALTER TABLE dbo.ForumReplies ALTER COLUMN CreatedAtUtc datetimeoffset(7) NOT NULL;
GO
ALTER TABLE dbo.ForumTopics ADD CONSTRAINT FK_ForumTopics_Category FOREIGN KEY(CategoryId) REFERENCES dbo.ForumCategories(CategoryId);
CREATE INDEX IX_ForumTopics_CategoryDate ON dbo.ForumTopics(CategoryId,CreatedAtUtc DESC,TopicId DESC);
CREATE INDEX IX_ForumTopics_Date ON dbo.ForumTopics(CreatedAtUtc DESC,TopicId DESC);
CREATE INDEX IX_ForumReplies_TopicDate ON dbo.ForumReplies(TopicId,CreatedAtUtc DESC,ReplyId DESC);
GO
