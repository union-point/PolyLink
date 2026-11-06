-- Database-maintained versions also detect edits made by offline maintenance writers.
-- No existing IDs, names, codes, verification flags or dependencies are changed.
ALTER TABLE dbo.Universities ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.Institutes ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.Departments ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.Specializations ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.Professions ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.Degrees ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.PostTypes ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.Spheres ADD AdminVersion rowversion NOT NULL;
ALTER TABLE dbo.ForumCategories ADD AdminVersion rowversion NOT NULL;
