-- Synthetic selector values and identities for an empty disposable database only.
INSERT dbo.Institutes(Name) VALUES (N'Տեղեկատվական տեխնոլոգիաների ինստիտուտ'), (N'Ճարտարագիտական ինստիտուտ');
INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ծրագրային ճարտարագիտություն',1), (N'Համակարգչային գիտություն',1);
INSERT dbo.Departments(Name) VALUES (N'Ծրագրային համակարգերի ամբիոն'), (N'Համակարգչային տեխնիկայի ամբիոն');
INSERT dbo.Professions(Name) VALUES (N'Դասախոս'), (N'Դոցենտ');
INSERT dbo.Degrees(Name) VALUES (N'Բակալավր'), (N'Մագիստրոս');
INSERT dbo.Spheres(Code,Name) VALUES ('it',N'Տեղեկատվական տեխնոլոգիաներ'), ('engineering',N'Ճարտարագիտություն'), ('education',N'Կրթություն');
INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId)
SELECT N'Անի',N'Փորձնական',N'TEST-ALUMNI-001','2018-09-01','2022-06-30',SpecializationId FROM dbo.Specializations WHERE Name=N'Ծրագրային ճարտարագիտություն';
INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId)
SELECT N'Արամ',N'Փորձնական',N'TEST-ALUMNI-002','2019-09-01','2023-06-30',SpecializationId FROM dbo.Specializations WHERE Name=N'Համակարգչային գիտություն';
INSERT dbo.LecturerRegistry(FirstName,LastName,Email,DepartmentId)
SELECT N'Մարի',N'Փորձնական',N'test-lecturer-001@polytechnic.am',DepartmentId FROM dbo.Departments WHERE Name=N'Ծրագրային համակարգերի ամբիոն';
INSERT dbo.LecturerRegistry(FirstName,LastName,Email,DepartmentId)
SELECT N'Հայկ',N'Փորձնական',N'test-lecturer-002@polytechnic.am',DepartmentId FROM dbo.Departments WHERE Name=N'Համակարգչային տեխնիկայի ամբիոն';
