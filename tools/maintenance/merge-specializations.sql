-- Run against the intended PolyLink database, after making a backup.
-- Requires SQL Server 2017+. No fixed IDs or machine-specific settings.
-- Only trailing numeric classification codes such as (061102.00.6) are removed.
-- Similar but different names are deliberately kept separate.
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.Specializations', N'U') IS NULL
        THROW 51000, 'dbo.Specializations is missing. Select the PolyLink database.', 1;

    SELECT SpecializationId AS OldId, SpecializationId AS NewId,
           CONVERT(nvarchar(255), LTRIM(RTRIM(Name))) AS CleanName,
           CONVERT(nvarchar(255), N'') COLLATE Latin1_General_100_BIN2 AS NameKey
    INTO #SpecializationMerge
    FROM dbo.Specializations WITH (TABLOCKX, HOLDLOCK);

    -- Strip only a numeric, dotted suffix in parentheses; preserve other qualifiers.
    UPDATE m SET CleanName = RTRIM(LEFT(CleanName, LEN(CleanName) - p.SuffixLength))
    FROM #SpecializationMerge m
    CROSS APPLY (SELECT CHARINDEX(N'(', REVERSE(CleanName)) AS SuffixLength) p
    CROSS APPLY (SELECT SUBSTRING(CleanName,
        LEN(CleanName) - p.SuffixLength + 2,
        CASE WHEN p.SuffixLength >= 2 THEN p.SuffixLength - 2 ELSE 0 END) AS Code) c
    WHERE RIGHT(CleanName, 1) = N')' AND p.SuffixLength > 2
      AND c.Code COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^0-9.]%'
      AND c.Code LIKE N'%[0-9]%' AND c.Code LIKE N'%.%';

    WHILE EXISTS (SELECT 1 FROM #SpecializationMerge WHERE CleanName LIKE N'%  %')
        UPDATE #SpecializationMerge SET CleanName = REPLACE(CleanName, N'  ', N' ');

    IF EXISTS (SELECT 1 FROM #SpecializationMerge WHERE CleanName = N'')
        THROW 51000, 'An empty specialization name needs manual correction.', 1;

    -- Explicit Armenian case mapping also works with databases whose default
    -- collation does not provide Armenian case folding.
    UPDATE #SpecializationMerge SET NameKey = LOWER(TRANSLATE(CleanName,
        N'ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖ',
        N'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆ'));

    UPDATE m SET NewId = g.NewId
    FROM #SpecializationMerge m
    JOIN (SELECT NameKey, MIN(OldId) AS NewId FROM #SpecializationMerge GROUP BY NameKey) g
      ON g.NameKey = m.NameKey;

    -- Prefer the original spelling of the oldest record; capitalize an Armenian initial.
    UPDATE m SET CleanName = c.CleanName
    FROM #SpecializationMerge m JOIN #SpecializationMerge c ON c.OldId = m.NewId;
    UPDATE #SpecializationMerge SET CleanName = TRANSLATE(LEFT(CleanName, 1),
        N'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆ',
        N'ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖ') + SUBSTRING(CleanName, 2, 255);

    -- Discover every FK rather than assuming the database has a specific schema version.
    IF EXISTS (
        SELECT 1 FROM sys.foreign_key_columns f
        WHERE f.referenced_object_id = OBJECT_ID(N'dbo.Specializations')
          AND (COL_NAME(f.referenced_object_id, f.referenced_column_id) <> N'SpecializationId'
               OR (SELECT COUNT(*) FROM sys.foreign_key_columns x
                   WHERE x.constraint_object_id = f.constraint_object_id) <> 1))
        THROW 51000, 'An unsupported specialization FK needs manual review.', 1;

    DECLARE @Table nvarchar(517), @Column nvarchar(258), @Sql nvarchar(max);
    DECLARE @Transferred bigint = 0, @Changed bigint;
    DECLARE links CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT QUOTENAME(OBJECT_SCHEMA_NAME(f.parent_object_id)) + N'.'
               + QUOTENAME(OBJECT_NAME(f.parent_object_id)), QUOTENAME(c.name)
        FROM sys.foreign_key_columns f JOIN sys.columns c
          ON c.object_id = f.parent_object_id AND c.column_id = f.parent_column_id
        WHERE f.referenced_object_id = OBJECT_ID(N'dbo.Specializations');
    OPEN links;
    FETCH NEXT FROM links INTO @Table, @Column;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Sql = N'UPDATE r WITH (TABLOCKX, HOLDLOCK) SET ' + @Column + N' = m.NewId FROM '
            + @Table + N' r JOIN #SpecializationMerge m ON r.' + @Column
            + N' = m.OldId WHERE m.OldId <> m.NewId; SET @Changed = @@ROWCOUNT;';
        EXEC sys.sp_executesql @Sql, N'@Changed bigint OUTPUT', @Changed OUTPUT;
        SET @Transferred += @Changed;
        FETCH NEXT FROM links INTO @Table, @Column;
    END;
    CLOSE links;
    DEALLOCATE links;

    -- Preserve verification when any merged record is verified.
    UPDATE s SET IsVerified = 1 FROM dbo.Specializations s
    WHERE EXISTS (SELECT 1 FROM dbo.Specializations d JOIN #SpecializationMerge m
                  ON m.OldId = d.SpecializationId
                  WHERE m.NewId = s.SpecializationId AND d.IsVerified = 1);

    DELETE s FROM dbo.Specializations s JOIN #SpecializationMerge m
      ON m.OldId = s.SpecializationId WHERE m.OldId <> m.NewId;
    DECLARE @Removed int = @@ROWCOUNT;
    UPDATE s SET Name = m.CleanName FROM dbo.Specializations s
    JOIN #SpecializationMerge m ON m.OldId = s.SpecializationId
    WHERE s.Name COLLATE Latin1_General_100_BIN2 <> m.CleanName COLLATE Latin1_General_100_BIN2;

    DROP TABLE #SpecializationMerge;
    COMMIT TRANSACTION;
    SELECT @Removed AS RemovedDuplicates, @Transferred AS TransferredReferences,
           (SELECT COUNT(*) FROM dbo.Specializations) AS RemainingSpecializations;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
