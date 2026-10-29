-- Retire unsupported types without deleting their historical posts/comments.
UPDATE p SET PostTypeId=NULL
FROM dbo.Posts p JOIN dbo.PostTypes t ON t.PostTypeId=p.PostTypeId
WHERE t.Code IS NULL OR t.Code NOT IN ('job','internship','training');
DELETE dbo.PostTypes WHERE Code IS NULL OR Code NOT IN ('job','internship','training');

-- Preserve IDs and existing codes. Known historical labels receive semantic codes;
-- unrecognized labels receive a stable local code instead of an invented translation.
UPDATE s SET Code=v.Code
FROM dbo.Spheres s JOIN (VALUES
 (N'Adventure','adventure'),(N'Agriculture','agriculture'),(N'Art','art'),
 (N'Artisan','artisan'),(N'Business','business'),(N'Cinema','cinema'),
 (N'Cuisine','cuisine'),(N'Ecology','ecology'),(N'Education','education'),
 (N'Engineering','engineering'),(N'Finance','finance'),(N'Health','health'),
 (N'IT','it'),(N'Lifestyle','lifestyle'),(N'Literature','literature'),
 (N'Music','music'),(N'Photography','photography'),(N'Productivity','productivity'),
 (N'Psychology','psychology'),(N'Science','science'),(N'Sports','sports'),
 (N'Technology','technology'),(N'Tourism','tourism'),(N'Այլ','other')
) v(Name,Code) ON v.Name=s.Name
WHERE s.Code IS NULL;
UPDATE dbo.Spheres SET Code='sphere-'+CONVERT(varchar(10),SphereId) WHERE Code IS NULL;

DROP INDEX UX_PostTypes_Code ON dbo.PostTypes;
DROP INDEX UX_Spheres_Code ON dbo.Spheres;
ALTER TABLE dbo.PostTypes ALTER COLUMN Code varchar(16) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL;
ALTER TABLE dbo.Spheres ALTER COLUMN Code varchar(32) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL;
CREATE UNIQUE INDEX UX_PostTypes_Code ON dbo.PostTypes(Code);
CREATE UNIQUE INDEX UX_Spheres_Code ON dbo.Spheres(Code);
