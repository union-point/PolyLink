-- Retire import staging, invitation admission and the historical forum review log.
-- Flyway runs this migration transactionally; unexpected dependencies abort it.
DECLARE @invitationForeignKey sysname;
SELECT @invitationForeignKey = fk.name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
WHERE fk.parent_object_id = OBJECT_ID(N'auth.PendingEnrollments')
  AND fk.referenced_object_id = OBJECT_ID(N'auth.Invitations')
  AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = N'InvitationId';

IF @invitationForeignKey IS NULL
    THROW 50001, 'Expected invitation foreign key is missing; review schema before retirement.', 1;

DECLARE @dropForeignKey nvarchar(max) = N'ALTER TABLE auth.PendingEnrollments DROP CONSTRAINT ' + QUOTENAME(@invitationForeignKey);
EXEC sys.sp_executesql @dropForeignKey;
ALTER TABLE auth.PendingEnrollments DROP COLUMN InvitationId;

DROP TABLE auth.Invitations;
DROP TABLE dbo.AlumniRegistry_Import;
DROP TABLE forum.LegacyReview;
