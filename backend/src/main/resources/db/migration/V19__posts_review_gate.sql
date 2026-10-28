IF EXISTS(SELECT 1 FROM dbo.Posts WHERE CreatedAtUtc IS NULL)
 OR EXISTS(SELECT 1 FROM dbo.PostComments WHERE CreatedAtUtc IS NULL)
 THROW 51000,'Posts legacy review required: stop at V18 and run PostsMaintenanceCommand inspect/dry-run/apply with reviewed timestamps and source timezones.',1;
GO
ALTER TABLE dbo.Posts ALTER COLUMN CreatedAtUtc datetimeoffset(7) NOT NULL;
ALTER TABLE dbo.PostComments ALTER COLUMN CreatedAtUtc datetimeoffset(7) NOT NULL;
CREATE INDEX IX_Posts_Date ON dbo.Posts(CreatedAtUtc DESC,PostId DESC);
CREATE INDEX IX_Posts_TypeSphereDate ON dbo.Posts(PostTypeId,SphereId,CreatedAtUtc DESC,PostId DESC);
CREATE INDEX IX_PostComments_PostDate ON dbo.PostComments(PostId,CreatedAtUtc,CommentId);
GO
