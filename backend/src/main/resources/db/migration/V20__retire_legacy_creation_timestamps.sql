-- V13 and V19 already require reviewed canonical UTC timestamps.
-- Retire only the obsolete source columns and the completed posts review journal.
DECLARE @dropDefaults nvarchar(max) = N'';
SELECT @dropDefaults = @dropDefaults + N'ALTER TABLE dbo.' + QUOTENAME(t.name)
    + N' DROP CONSTRAINT ' + QUOTENAME(d.name) + N';'
FROM sys.default_constraints d
JOIN sys.tables t ON t.object_id = d.parent_object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = d.parent_column_id
WHERE s.name = N'dbo' AND t.name IN (N'Posts', N'PostComments', N'ForumTopics', N'ForumReplies')
    AND c.name = N'CreatedAt';
EXEC sys.sp_executesql @dropDefaults;

ALTER TABLE dbo.Posts DROP COLUMN CreatedAt;
ALTER TABLE dbo.PostComments DROP COLUMN CreatedAt;
ALTER TABLE dbo.ForumTopics DROP COLUMN CreatedAt;
ALTER TABLE dbo.ForumReplies DROP COLUMN CreatedAt;
DROP TABLE auth.PostsLegacyReview;
