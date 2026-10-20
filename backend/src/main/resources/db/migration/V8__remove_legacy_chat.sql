-- Permanently retire plaintext fixture histories and legacy group membership.
-- Existing encrypted messaging rooms, memberships, keys and messages are retained.
-- Flyway executes this migration transactionally; unexpected dependencies abort it.
DECLARE @legacyRoomForeignKey sysname;
SELECT @legacyRoomForeignKey = fk.name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
WHERE fk.parent_object_id = OBJECT_ID(N'messaging.Rooms')
  AND fk.referenced_object_id = OBJECT_ID(N'dbo.ChatRooms')
  AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = N'LegacyRoomId';

IF @legacyRoomForeignKey IS NULL
    THROW 50001, 'Expected legacy room foreign key is missing; review schema before retiring legacy chat.', 1;

DECLARE @dropForeignKey nvarchar(max) = N'ALTER TABLE messaging.Rooms DROP CONSTRAINT ' + QUOTENAME(@legacyRoomForeignKey);
EXEC sys.sp_executesql @dropForeignKey;

DROP INDEX UX_LegacyRoom ON messaging.Rooms;
ALTER TABLE messaging.Rooms DROP COLUMN LegacyRoomId;

DROP TABLE dbo.ChatMessages;
DROP TABLE dbo.ChatParticipants;
DROP TABLE dbo.ChatRooms;
