-- Preserve exact historical dates; new writes explicitly record year/month precision.
ALTER TABLE dbo.Education ADD
    StartPrecision varchar(5) NULL,
    EndPrecision varchar(5) NULL,
    IsOngoing bit NOT NULL CONSTRAINT DF_Education_IsOngoing DEFAULT (0);
GO
UPDATE dbo.Education SET StartPrecision=CASE WHEN StartDate IS NULL THEN NULL ELSE 'DAY' END,
    EndPrecision=CASE WHEN EndDate IS NULL THEN NULL ELSE 'DAY' END;
GO
ALTER TABLE dbo.Education ADD CONSTRAINT CK_Education_Precision CHECK (
    ((StartDate IS NULL AND StartPrecision IS NULL) OR
     (StartDate IS NOT NULL AND StartPrecision IS NOT NULL AND StartPrecision IN ('YEAR','MONTH','DAY')))
    AND ((EndDate IS NULL AND EndPrecision IS NULL) OR
     (EndDate IS NOT NULL AND EndPrecision IS NOT NULL AND EndPrecision IN ('YEAR','MONTH','DAY')))
    AND (IsOngoing=0 OR EndDate IS NULL));
CREATE TABLE auth.ProfileCovers (
    UserId int NOT NULL PRIMARY KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    PhotoId uniqueidentifier NOT NULL UNIQUE,
    Content varbinary(max) NOT NULL,
    CONSTRAINT CK_ProfileCoverSize CHECK (DATALENGTH(Content) BETWEEN 1 AND 5242880)
);
