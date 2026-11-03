-- Additive: retain SQL bytes until the explicit, verified retirement operation.
ALTER TABLE messaging.Attachments ADD
 StorageState varchar(16) NOT NULL CONSTRAINT DF_AttachmentStorageState DEFAULT 'LEGACY',
 LeaseToken uniqueidentifier NULL, LeaseUntil datetimeoffset(3) NULL,
 RetryAt datetimeoffset(3) NULL, Attempts int NOT NULL CONSTRAINT DF_AttachmentAttempts DEFAULT 0,
 VerifiedAt datetimeoffset(3) NULL,
 CONSTRAINT CK_AttachmentStorageState CHECK(StorageState IN ('LEGACY','UPLOADING','READY','DELETE_PENDING','DELETED'));
CREATE INDEX IX_AttachmentStorageWork ON messaging.Attachments(StorageState,RetryAt);
GO
DECLARE @pk sysname=(SELECT name FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('auth.ProfileAvatars') AND type='PK');
EXEC('ALTER TABLE auth.ProfileAvatars DROP CONSTRAINT '+QUOTENAME(@pk));
ALTER TABLE auth.ProfileAvatars ADD CONSTRAINT PK_ProfileAvatars PRIMARY KEY(PhotoId);
ALTER TABLE auth.ProfileAvatars ALTER COLUMN Content varbinary(max) NULL;
ALTER TABLE auth.ProfileAvatars ADD
 ObjectKey varchar(255) NULL, ContentBytes bigint NULL, ContentDigest binary(32) NULL,
 IsCurrent bit NOT NULL CONSTRAINT DF_AvatarCurrent DEFAULT 1,
 ExpectedPhotoId uniqueidentifier NULL,
 StorageState varchar(16) NOT NULL CONSTRAINT DF_AvatarStorageState DEFAULT 'LEGACY',
 CreatedAt datetimeoffset(3) NOT NULL CONSTRAINT DF_AvatarCreated DEFAULT SYSDATETIMEOFFSET(),
 LeaseToken uniqueidentifier NULL, LeaseUntil datetimeoffset(3) NULL,
 RetryAt datetimeoffset(3) NULL, Attempts int NOT NULL CONSTRAINT DF_AvatarAttempts DEFAULT 0,
 VerifiedAt datetimeoffset(3) NULL,
 CONSTRAINT CK_AvatarStorageState CHECK(StorageState IN ('LEGACY','UPLOADING','READY','DELETE_PENDING','DELETED')),
 CONSTRAINT CK_AvatarCurrentState CHECK(IsCurrent=0 OR StorageState IN ('LEGACY','READY'));
CREATE UNIQUE INDEX UX_ProfileAvatarCurrent ON auth.ProfileAvatars(UserId) WHERE IsCurrent=1;
CREATE UNIQUE INDEX UX_ProfileAvatarObject ON auth.ProfileAvatars(ObjectKey) WHERE ObjectKey IS NOT NULL;
CREATE INDEX IX_AvatarStorageWork ON auth.ProfileAvatars(StorageState,RetryAt);
GO
-- Only canonical avatars owned by this application are rewritten; external images are retained.
UPDATE u SET ProfilePhotoUrl='/auth/avatars/'+LOWER(CONVERT(varchar(36),p.PhotoId))
 FROM dbo.Users u JOIN auth.ProfileAvatars p ON p.UserId=u.UserId AND p.IsCurrent=1;
