SET NOCOUNT ON;
SELECT
 JSON_QUERY((SELECT s.name AS [schema],t.name,
   JSON_QUERY((SELECT c.name,ty.name AS [type],c.max_length AS maxLength,c.precision,c.scale,c.is_nullable AS nullable,
     c.collation_name AS collation,CONVERT(nvarchar(40),ic.seed_value) AS identitySeed,
     CONVERT(nvarchar(40),ic.increment_value) AS identityIncrement,
     dc.name AS defaultName,dc.definition AS defaultDefinition,cc.definition AS computedDefinition
     FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id
     LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id
     LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
     LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
     WHERE c.object_id=t.object_id ORDER BY c.column_id FOR JSON PATH)) AS columns,
   JSON_QUERY((SELECT i.name,i.type_desc AS [type],i.is_unique AS [unique],i.is_primary_key AS primaryKey,
     i.is_unique_constraint AS uniqueConstraint,i.filter_definition AS filterDefinition,
     JSON_QUERY((SELECT c.name,ix.is_descending_key AS descendingKey,ix.is_included_column AS included
       FROM sys.index_columns ix JOIN sys.columns c ON c.object_id=ix.object_id AND c.column_id=ix.column_id
       WHERE ix.object_id=i.object_id AND ix.index_id=i.index_id ORDER BY ix.index_column_id FOR JSON PATH)) AS columns
     FROM sys.indexes i WHERE i.object_id=t.object_id AND i.index_id>0 ORDER BY i.name FOR JSON PATH)) AS indexes,
   JSON_QUERY((SELECT f.name,OBJECT_SCHEMA_NAME(f.referenced_object_id) AS targetSchema,
     OBJECT_NAME(f.referenced_object_id) AS targetTable,f.delete_referential_action_desc AS onDelete,
     f.update_referential_action_desc AS onUpdate,f.is_disabled AS disabled,f.is_not_trusted AS untrusted,
     JSON_QUERY((SELECT COL_NAME(fc.parent_object_id,fc.parent_column_id) AS source,
       COL_NAME(fc.referenced_object_id,fc.referenced_column_id) AS target
       FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id=f.object_id
       ORDER BY fc.constraint_column_id FOR JSON PATH)) AS columns
     FROM sys.foreign_keys f WHERE f.parent_object_id=t.object_id ORDER BY f.name FOR JSON PATH)) AS foreignKeys,
   JSON_QUERY((SELECT ck.name,ck.definition,ck.is_disabled AS disabled,ck.is_not_trusted AS untrusted
     FROM sys.check_constraints ck WHERE ck.parent_object_id=t.object_id ORDER BY ck.name FOR JSON PATH)) AS checks
 FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
 WHERE t.is_ms_shipped=0 AND t.name<>N'flyway_schema_history' AND s.name=N'dbo'
 ORDER BY s.name,t.name FOR JSON PATH)) AS tables,
 JSON_QUERY((SELECT s.name AS [schema],o.name,o.type_desc AS [type]
 FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
 WHERE o.is_ms_shipped=0 AND o.type IN ('V','P','TR','FN','IF','TF','SO')
 ORDER BY s.name,o.name FOR JSON PATH)) AS otherObjects
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
