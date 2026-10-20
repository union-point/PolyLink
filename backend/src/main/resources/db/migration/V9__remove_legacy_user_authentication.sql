-- Authentication remains exclusively in auth.AccountSecurity.
-- No legacy credentials or factor flags are copied into current security state.
-- Flyway executes this migration transactionally; unexpected dependencies abort it.
DECLARE @twoFactorDefault sysname;
SELECT @twoFactorDefault = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Users') AND c.name = N'TwoFactorEnabled';

IF @twoFactorDefault IS NULL
    THROW 50001, 'Expected legacy two-factor default is missing; review schema before retiring legacy authentication fields.', 1;

DECLARE @dropDefault nvarchar(max) = N'ALTER TABLE dbo.Users DROP CONSTRAINT ' + QUOTENAME(@twoFactorDefault);
EXEC sys.sp_executesql @dropDefault;

ALTER TABLE dbo.Users DROP COLUMN PasswordHash, TwoFactorEnabled;
