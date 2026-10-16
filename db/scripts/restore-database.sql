USE [master];
GO

-- Refuse to overwrite an existing database. This script restores backup set 1
-- from db/backups/polylink-2026523-16-23-23.bak, whose logical files were inspected.
IF DB_ID(N'polylink') IS NOT NULL
    THROW 50001, 'Database polylink already exists. Restore stopped without overwriting it.', 1;

RESTORE VERIFYONLY
    FROM DISK = N'/var/opt/mssql/backup/polylink-2026523-16-23-23.bak'
    WITH FILE = 1;

RESTORE DATABASE [polylink]
    FROM DISK = N'/var/opt/mssql/backup/polylink-2026523-16-23-23.bak'
    WITH FILE = 1,
         MOVE N'polylink' TO N'/var/opt/mssql/data/polylink.mdf',
         MOVE N'polylink_log' TO N'/var/opt/mssql/data/polylink_log.ldf',
         RECOVERY,
         STATS = 10;
GO

DBCC CHECKDB ([polylink]) WITH NO_INFOMSGS;
GO

SELECT name, state_desc, compatibility_level
FROM sys.databases
WHERE name = N'polylink';
GO
