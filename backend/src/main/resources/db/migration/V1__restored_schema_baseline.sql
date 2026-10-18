-- V1: exact structural baseline of the restored May 2026 schema, inspected 2026-10-18.
-- No users, credentials, registry records or legacy message bodies are seeded.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE TABLE [dbo].[AlumniRegistry] (
    [AlumniRegistryId] int IDENTITY(1,1) NOT NULL,
    [FirstName] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [LastName] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [DiplomaNumber] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [StudyStartDate] date NOT NULL,
    [StudyEndDate] date NOT NULL,
    [SpecializationId] int NULL,
    [ImportedAt] datetime2(7) NOT NULL CONSTRAINT [DF_AlumniRegistry_ImportedAt] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__AlumniRe__CB45359FCBE5811A] PRIMARY KEY CLUSTERED ([AlumniRegistryId] ASC),
    CONSTRAINT [UQ_AlumniRegistry_DiplomaNumber] UNIQUE NONCLUSTERED ([DiplomaNumber] ASC),
    CONSTRAINT [CK_AlumniRegistry_Dates] CHECK ([StudyStartDate]<=[StudyEndDate])
);
GO

CREATE TABLE [dbo].[AlumniRegistry_Import] (
    [FullName] nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [Gender] nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [StudyStartRaw] nvarchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [StudyEndRaw] nvarchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [DiplomaRaw] nvarchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [SpecializationRaw] nvarchar(300) COLLATE SQL_Latin1_General_CP1_CI_AS NULL
);
GO

CREATE TABLE [dbo].[Certificates] (
    [CertificateId] int IDENTITY(1,1) NOT NULL,
    [UserId] int NOT NULL,
    [CertificateName] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [Organization] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [IssueDate] date NULL,
    [Url] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    CONSTRAINT [PK__Certific__BBF8A7C12853AEBF] PRIMARY KEY CLUSTERED ([CertificateId] ASC)
);
GO

CREATE TABLE [dbo].[ChatMessages] (
    [MessageId] int IDENTITY(1,1) NOT NULL,
    [RoomId] int NOT NULL,
    [SenderId] int NOT NULL,
    [EncryptedContent] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [SentAt] datetime2(7) NULL CONSTRAINT [DF__ChatMessa__SentA__236943A5] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__ChatMess__C87C0C9CD2C2E1B8] PRIMARY KEY CLUSTERED ([MessageId] ASC)
);
GO

CREATE TABLE [dbo].[ChatParticipants] (
    [RoomId] int NOT NULL,
    [UserId] int NOT NULL,
    [JoinedAt] datetime2(7) NULL CONSTRAINT [DF__ChatParti__Joine__1EA48E88] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__ChatPart__E3FEB5FD9952A14F] PRIMARY KEY CLUSTERED ([RoomId] ASC, [UserId] ASC)
);
GO

CREATE TABLE [dbo].[ChatRooms] (
    [RoomId] int IDENTITY(1,1) NOT NULL,
    [IsGroup] bit NOT NULL CONSTRAINT [DF__ChatRooms__IsGro__1AD3FDA4] DEFAULT ((0)),
    [CreatedAt] datetime2(7) NULL CONSTRAINT [DF__ChatRooms__Creat__1BC821DD] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__ChatRoom__328639390B615CC7] PRIMARY KEY CLUSTERED ([RoomId] ASC)
);
GO

CREATE TABLE [dbo].[Degrees] (
    [DegreeId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Degrees__4D94AD2E47E22F30] PRIMARY KEY CLUSTERED ([DegreeId] ASC),
    CONSTRAINT [UQ_Degrees_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Departments] (
    [DepartmentId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Departme__B2079BEDDA4AD932] PRIMARY KEY CLUSTERED ([DepartmentId] ASC),
    CONSTRAINT [UQ_Departments_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Education] (
    [EducationId] int IDENTITY(1,1) NOT NULL,
    [UserId] int NOT NULL,
    [StartDate] date NULL,
    [EndDate] date NULL,
    [UniversityId] int NOT NULL,
    [SpecializationId] int NULL,
    [DegreeId] int NOT NULL,
    [InstituteId] int NULL,
    CONSTRAINT [PK__Educatio__4BBE3805F1E9B642] PRIMARY KEY CLUSTERED ([EducationId] ASC)
);
GO

CREATE TABLE [dbo].[ForumReplies] (
    [ReplyId] int IDENTITY(1,1) NOT NULL,
    [TopicId] int NOT NULL,
    [UserId] int NOT NULL,
    [Content] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [CreatedAt] datetime2(7) NOT NULL CONSTRAINT [DF__ForumRepl__Creat__114A936A] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__ForumRep__C25E460998D67EA3] PRIMARY KEY CLUSTERED ([ReplyId] ASC)
);
GO

CREATE TABLE [dbo].[ForumReplyLikes] (
    [UserId] int NOT NULL,
    [ReplyId] int NOT NULL,
    [CreatedAt] datetime2(7) NULL CONSTRAINT [DF__ForumRepl__Creat__160F4887] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__ForumRep__9BAD282CC7E565DB] PRIMARY KEY CLUSTERED ([UserId] ASC, [ReplyId] ASC)
);
GO

CREATE TABLE [dbo].[ForumTopics] (
    [TopicId] int IDENTITY(1,1) NOT NULL,
    [UserId] int NOT NULL,
    [Title] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [Content] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [CreatedAt] datetime2(7) NOT NULL CONSTRAINT [DF__ForumTopi__Creat__0D7A0286] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__ForumTop__022E0F5DFDAE7BBF] PRIMARY KEY CLUSTERED ([TopicId] ASC)
);
GO

CREATE TABLE [dbo].[Institutes] (
    [InstituteId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Institut__09EC0DBBEAC385F5] PRIMARY KEY CLUSTERED ([InstituteId] ASC),
    CONSTRAINT [UQ_Institutes_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Languages] (
    [Id] int IDENTITY(1,1) NOT NULL,
    [Code] nvarchar(5) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [Name] nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Language__3214EC07AC568FD3] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [UQ__Language__A25C5AA7BD1AC338] UNIQUE NONCLUSTERED ([Code] ASC)
);
GO

CREATE TABLE [dbo].[LecturerRegistry] (
    [LecturerRegistryId] int IDENTITY(1,1) NOT NULL,
    [Email] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [DepartmentId] int NULL,
    [ImportedAt] datetime2(7) NOT NULL CONSTRAINT [DF_LecturerRegistry_ImportedAt] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__Lecturer__E802F7D0CAA35963] PRIMARY KEY CLUSTERED ([LecturerRegistryId] ASC),
    CONSTRAINT [UQ_LecturerRegistry_Email] UNIQUE NONCLUSTERED ([Email] ASC)
);
GO

CREATE TABLE [dbo].[Lecturers] (
    [LecturerId] int IDENTITY(1,1) NOT NULL,
    [UserId] int NOT NULL,
    [DepartmentId] int NOT NULL,
    [ProfessionId] int NOT NULL,
    CONSTRAINT [PK__Lecturer__5A78B93DDF9FE059] PRIMARY KEY CLUSTERED ([LecturerId] ASC),
    CONSTRAINT [UQ__Lecturer__1788CC4D9064FB2B] UNIQUE NONCLUSTERED ([UserId] ASC)
);
GO

CREATE TABLE [dbo].[PostComments] (
    [CommentId] int IDENTITY(1,1) NOT NULL,
    [PostId] int NOT NULL,
    [UserId] int NOT NULL,
    [Content] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [CreatedAt] datetime2(7) NOT NULL CONSTRAINT [DF__PostComme__Creat__08B54D69] DEFAULT (sysdatetime()),
    CONSTRAINT [PK__PostComm__C3B4DFCA3CDF2F57] PRIMARY KEY CLUSTERED ([CommentId] ASC)
);
GO

CREATE TABLE [dbo].[Posts] (
    [PostId] int IDENTITY(1,1) NOT NULL,
    [UserId] int NOT NULL,
    [Title] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [Content] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [CreatedAt] datetime2(7) NOT NULL CONSTRAINT [DF__Posts__CreatedAt__04E4BC85] DEFAULT (sysdatetime()),
    [SphereId] int NULL,
    [PostTypeId] int NULL,
    CONSTRAINT [PK__Posts__AA12601828DF3586] PRIMARY KEY CLUSTERED ([PostId] ASC)
);
GO

CREATE TABLE [dbo].[PostTypes] (
    [PostTypeId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__PostType__AB2125F0B444D574] PRIMARY KEY CLUSTERED ([PostTypeId] ASC),
    CONSTRAINT [UQ_PostTypes_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Professions] (
    [ProfessionId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(150) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Professi__3F309E3F654B7F57] PRIMARY KEY CLUSTERED ([ProfessionId] ASC),
    CONSTRAINT [UQ_Professions_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Roles] (
    [RoleId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Roles__8AFACE1AFE8CB7D9] PRIMARY KEY CLUSTERED ([RoleId] ASC),
    CONSTRAINT [UQ__Roles__737584F6F83F2B1D] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Specializations] (
    [SpecializationId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [IsVerified] bit NOT NULL CONSTRAINT [DF__Specializ__IsVer__7A3223E8] DEFAULT ((0)),
    CONSTRAINT [PK__Speciali__5809D86FCA86D622] PRIMARY KEY CLUSTERED ([SpecializationId] ASC),
    CONSTRAINT [UQ_Specializations_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Spheres] (
    [SphereId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(150) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    CONSTRAINT [PK__Spheres__AC9A4C75EB66E712] PRIMARY KEY CLUSTERED ([SphereId] ASC),
    CONSTRAINT [UQ_Spheres_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[Universities] (
    [UniversityId] int IDENTITY(1,1) NOT NULL,
    [Name] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [IsVerified] bit NOT NULL CONSTRAINT [DF__Universit__IsVer__76619304] DEFAULT ((0)),
    [LogoUrl] nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    CONSTRAINT [PK__Universi__9F19E1BCDABAA02F] PRIMARY KEY CLUSTERED ([UniversityId] ASC),
    CONSTRAINT [UQ_Universities_Name] UNIQUE NONCLUSTERED ([Name] ASC)
);
GO

CREATE TABLE [dbo].[UserNotificationSettings] (
    [UserId] int NOT NULL,
    [NewListingNotifications] bit NULL CONSTRAINT [DF__UserNotif__NewLi__282DF8C2] DEFAULT ((1)),
    [ForumReplyNotifications] bit NULL CONSTRAINT [DF__UserNotif__Forum__29221CFB] DEFAULT ((1)),
    [DirectMessageNotifications] bit NULL CONSTRAINT [DF__UserNotif__Direc__2A164134] DEFAULT ((1)),
    [EmailEnabled] bit NULL CONSTRAINT [DF__UserNotif__Email__2B0A656D] DEFAULT ((1)),
    CONSTRAINT [PK__UserNoti__1788CC4C95CE4307] PRIMARY KEY CLUSTERED ([UserId] ASC)
);
GO

CREATE TABLE [dbo].[Users] (
    [UserId] int IDENTITY(1,1) NOT NULL,
    [FirstName] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [LastName] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [Specialization] nvarchar(150) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [About] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [Email] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [PasswordHash] nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [ProfilePhotoUrl] nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [CoverPhotoUrl] nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [IsProfilePublic] bit NOT NULL CONSTRAINT [DF__Users__IsProfile__76969D2E] DEFAULT ((1)),
    [TwoFactorEnabled] bit NOT NULL CONSTRAINT [DF__Users__TwoFactor__787EE5A0] DEFAULT ((0)),
    [CreatedAt] datetime2(7) NOT NULL CONSTRAINT [DF__Users__CreatedAt__797309D9] DEFAULT (sysdatetime()),
    [RoleId] int NOT NULL,
    [LanguageId] int NOT NULL,
    CONSTRAINT [PK__Users__1788CC4C8B4AD504] PRIMARY KEY CLUSTERED ([UserId] ASC),
    CONSTRAINT [UQ__Users__A9D10534CE9CC4D7] UNIQUE NONCLUSTERED ([Email] ASC)
);
GO

CREATE TABLE [dbo].[WorkExperience] (
    [WorkExperienceId] int IDENTITY(1,1) NOT NULL,
    [UserId] int NOT NULL,
    [CompanyName] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    [Position] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [StartDate] date NULL,
    [EndDate] date NULL,
    [Description] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    CONSTRAINT [PK__WorkExpe__55A2B88967D087C6] PRIMARY KEY CLUSTERED ([WorkExperienceId] ASC)
);
GO

ALTER TABLE [dbo].[AlumniRegistry] ADD CONSTRAINT [FK_AlumniRegistry_Specialization] FOREIGN KEY ([SpecializationId])
    REFERENCES [dbo].[Specializations] ([SpecializationId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Certificates] ADD CONSTRAINT [FK__Certifica__UserI__7F2BE32F] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ChatMessages] ADD CONSTRAINT [FK__ChatMessa__RoomI__245D67DE] FOREIGN KEY ([RoomId])
    REFERENCES [dbo].[ChatRooms] ([RoomId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ChatMessages] ADD CONSTRAINT [FK__ChatMessa__Sende__25518C17] FOREIGN KEY ([SenderId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ChatParticipants] ADD CONSTRAINT [FK__ChatParti__RoomI__1F98B2C1] FOREIGN KEY ([RoomId])
    REFERENCES [dbo].[ChatRooms] ([RoomId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ChatParticipants] ADD CONSTRAINT [FK__ChatParti__UserI__208CD6FA] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Education] ADD CONSTRAINT [FK__Education__UserI__7C4F7684] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Education] ADD CONSTRAINT [FK_Education_Degree] FOREIGN KEY ([DegreeId])
    REFERENCES [dbo].[Degrees] ([DegreeId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Education] ADD CONSTRAINT [FK_Education_Institute] FOREIGN KEY ([InstituteId])
    REFERENCES [dbo].[Institutes] ([InstituteId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Education] ADD CONSTRAINT [FK_Education_Specialization] FOREIGN KEY ([SpecializationId])
    REFERENCES [dbo].[Specializations] ([SpecializationId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Education] ADD CONSTRAINT [FK_Education_University] FOREIGN KEY ([UniversityId])
    REFERENCES [dbo].[Universities] ([UniversityId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ForumReplies] ADD CONSTRAINT [FK__ForumRepl__Topic__123EB7A3] FOREIGN KEY ([TopicId])
    REFERENCES [dbo].[ForumTopics] ([TopicId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ForumReplies] ADD CONSTRAINT [FK__ForumRepl__UserI__1332DBDC] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ForumReplyLikes] ADD CONSTRAINT [FK__ForumRepl__Reply__17F790F9] FOREIGN KEY ([ReplyId])
    REFERENCES [dbo].[ForumReplies] ([ReplyId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ForumReplyLikes] ADD CONSTRAINT [FK__ForumRepl__UserI__17036CC0] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[ForumTopics] ADD CONSTRAINT [FK__ForumTopi__UserI__0E6E26BF] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[LecturerRegistry] ADD CONSTRAINT [FK_LecturerRegistry_Department] FOREIGN KEY ([DepartmentId])
    REFERENCES [dbo].[Departments] ([DepartmentId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Lecturers] ADD CONSTRAINT [FK__Lecturers__UserI__503BEA1C] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Lecturers] ADD CONSTRAINT [FK_Lecturers_Department] FOREIGN KEY ([DepartmentId])
    REFERENCES [dbo].[Departments] ([DepartmentId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Lecturers] ADD CONSTRAINT [FK_Lecturers_Profession] FOREIGN KEY ([ProfessionId])
    REFERENCES [dbo].[Professions] ([ProfessionId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[PostComments] ADD CONSTRAINT [FK__PostComme__PostI__09A971A2] FOREIGN KEY ([PostId])
    REFERENCES [dbo].[Posts] ([PostId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[PostComments] ADD CONSTRAINT [FK__PostComme__UserI__0A9D95DB] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Posts] ADD CONSTRAINT [FK__Posts__UserId__05D8E0BE] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Posts] ADD CONSTRAINT [FK_Posts_PostType] FOREIGN KEY ([PostTypeId])
    REFERENCES [dbo].[PostTypes] ([PostTypeId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Posts] ADD CONSTRAINT [FK_Posts_Sphere] FOREIGN KEY ([SphereId])
    REFERENCES [dbo].[Spheres] ([SphereId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[UserNotificationSettings] ADD CONSTRAINT [FK__UserNotif__UserI__2BFE89A6] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Users] ADD CONSTRAINT [FK_Users_Languages] FOREIGN KEY ([LanguageId])
    REFERENCES [dbo].[Languages] ([Id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[Users] ADD CONSTRAINT [FK_Users_Roles] FOREIGN KEY ([RoleId])
    REFERENCES [dbo].[Roles] ([RoleId])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

ALTER TABLE [dbo].[WorkExperience] ADD CONSTRAINT [FK__WorkExper__UserI__02084FDA] FOREIGN KEY ([UserId])
    REFERENCES [dbo].[Users] ([UserId])
    ON DELETE CASCADE ON UPDATE NO ACTION;
GO
