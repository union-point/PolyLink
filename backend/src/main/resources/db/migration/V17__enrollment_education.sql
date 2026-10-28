-- Enrollment collects an institute and uses NPUA as the default university.
-- The academic degree is not collected; keep it unknown rather than guessing.
ALTER TABLE auth.PendingEnrollments ADD InstituteId int NULL
    REFERENCES dbo.Institutes(InstituteId);
ALTER TABLE dbo.Education ALTER COLUMN DegreeId int NULL;

IF NOT EXISTS (SELECT 1 FROM dbo.Universities WHERE Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան')
    INSERT dbo.Universities(Name) VALUES (N'Հայաստանի ազգային պոլիտեխնիկական համալսարան');

-- Restore education omitted by earlier registry enrollment. Keep existing
-- records, including richer records for the same verified course of study.
INSERT dbo.Education(UserId,StartDate,EndDate,SpecializationId,UniversityId)
SELECT c.UserId,r.StudyStartDate,r.StudyEndDate,r.SpecializationId,u.UniversityId
FROM auth.RegistryClaims c
JOIN auth.AccountSecurity a ON a.UserId=c.UserId
JOIN dbo.AlumniRegistry r ON r.AlumniRegistryId=c.AlumniRegistryId
JOIN dbo.Universities u ON u.Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան'
WHERE a.AdmissionStatus IN ('ADMITTED','DEACTIVATED')
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Education e
      WHERE e.UserId=c.UserId
        AND e.StartDate=r.StudyStartDate AND e.EndDate=r.StudyEndDate
        AND (e.SpecializationId=r.SpecializationId
             OR (e.SpecializationId IS NULL AND r.SpecializationId IS NULL))
  );
