-- Additive encrypted-messenger storage. Legacy dbo chat bodies are not copied or modified.
CREATE SCHEMA auth;
GO
CREATE SCHEMA keyvault;
GO
CREATE SCHEMA messaging;
GO
CREATE TABLE auth.AccountSecurity (
    UserId int NOT NULL CONSTRAINT PK_AccountSecurity PRIMARY KEY REFERENCES dbo.Users(UserId),
    AdmissionStatus varchar(16) NOT NULL CONSTRAINT CK_AdmissionStatus CHECK (AdmissionStatus IN ('PENDING','ADMITTED','DEACTIVATED','DELETED')),
    EmailVerifiedAt datetimeoffset(3) NULL,
    CredentialVersion bigint NOT NULL CONSTRAINT CK_CredentialVersion CHECK (CredentialVersion > 0),
    SchemeVersion int NOT NULL CONSTRAINT CK_AuthScheme CHECK (SchemeVersion = 1),
    ClientSalt binary(16) NOT NULL,
    ClientOpsLimit int NOT NULL CONSTRAINT CK_ClientOps CHECK (ClientOpsLimit BETWEEN 2 AND 4),
    ClientMemoryBytes bigint NOT NULL CONSTRAINT CK_ClientMemory CHECK (ClientMemoryBytes BETWEEN 67108864 AND 268435456),
    LoginVerifier varchar(512) NOT NULL,
    EmailFactorEnabled bit NOT NULL,
    UpdatedAt datetimeoffset(3) NOT NULL CONSTRAINT DF_SecurityUpdated DEFAULT TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00')
);
CREATE TABLE auth.Sessions (
    SessionId uniqueidentifier NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    FamilyId uniqueidentifier NOT NULL,
    CredentialVersion bigint NOT NULL,
    AccessHash binary(32) NOT NULL CONSTRAINT UQ_AccessHash UNIQUE,
    RefreshHash binary(32) NOT NULL CONSTRAINT UQ_RefreshHash UNIQUE,
    AccessExpiresAt datetimeoffset(3) NOT NULL,
    IdleExpiresAt datetimeoffset(3) NOT NULL,
    AbsoluteExpiresAt datetimeoffset(3) NOT NULL,
    RevokedAt datetimeoffset(3) NULL,
    CONSTRAINT CK_SessionExpiry CHECK (IdleExpiresAt <= AbsoluteExpiresAt)
);
CREATE INDEX IX_Sessions_User ON auth.Sessions(UserId, CredentialVersion, RevokedAt);
CREATE TABLE auth.EmailChallenges (
    ChallengeId uniqueidentifier NOT NULL CONSTRAINT PK_EmailChallenges PRIMARY KEY,
    UserId int NULL REFERENCES dbo.Users(UserId), -- null for neutral unknown-account flows
    Purpose varchar(16) NOT NULL CONSTRAINT CK_ChallengePurpose CHECK (Purpose IN ('EMAIL_VERIFY','LOGIN','RECOVERY','EMAIL_CHANGE')),
    CodeMac binary(32) NOT NULL,
    SecretVersion int NOT NULL,
    FailedAttempts tinyint NOT NULL CONSTRAINT CK_ChallengeAttempts CHECK (FailedAttempts <= 5),
    ExpiresAt datetimeoffset(3) NOT NULL,
    ResendAfter datetimeoffset(3) NOT NULL,
    ConsumedAt datetimeoffset(3) NULL
);
CREATE INDEX IX_Challenge_Expiry ON auth.EmailChallenges(ExpiresAt);
CREATE TABLE auth.RateLimits (
    ScopeHash binary(32) NOT NULL,
    Purpose varchar(16) NOT NULL,
    WindowStart datetimeoffset(3) NOT NULL,
    Attempts int NOT NULL CONSTRAINT CK_RateAttempts CHECK (Attempts >= 0),
    CONSTRAINT PK_RateLimits PRIMARY KEY (ScopeHash, Purpose, WindowStart)
);
GO
CREATE TABLE keyvault.Identities (
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    IdentityVersion bigint NOT NULL CONSTRAINT CK_IdentityVersion CHECK (IdentityVersion > 0),
    PublicKey binary(32) NOT NULL,
    CreatedAt datetimeoffset(3) NOT NULL,
    CONSTRAINT PK_Identities PRIMARY KEY (UserId, IdentityVersion)
);
CREATE TABLE keyvault.Vaults (
    UserId int NOT NULL CONSTRAINT PK_Vaults PRIMARY KEY REFERENCES auth.AccountSecurity(UserId),
    VaultKeyVersion bigint NOT NULL CONSTRAINT CK_VaultVersion CHECK (VaultKeyVersion > 0),
    VaultRevision bigint NOT NULL CONSTRAINT CK_VaultRevision CHECK (VaultRevision > 0),
    IdentityVersion bigint NOT NULL,
    VaultPacket varbinary(max) NOT NULL,
    PasswordCopy varbinary(max) NOT NULL,
    ServiceCopy varchar(2048) NOT NULL,
    TransitContext varchar(512) NOT NULL,
    CONSTRAINT FK_VaultIdentity FOREIGN KEY (UserId, IdentityVersion) REFERENCES keyvault.Identities(UserId, IdentityVersion)
);
CREATE TABLE keyvault.Operations (
    OperationId uniqueidentifier NOT NULL CONSTRAINT PK_KeyOperations PRIMARY KEY,
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    Kind varchar(16) NOT NULL CONSTRAINT CK_KeyOperationKind CHECK (Kind IN ('SETUP','PASSWORD_CHANGE','RECOVERY_LOCAL','RECOVERY_SERVICE')),
    State varchar(16) NOT NULL CONSTRAINT CK_KeyOperationState CHECK (State IN ('VERIFIED','PREPARING','WAITING_SERVICE','READY','COMPLETED','CANCELLED','EXPIRED')),
    CredentialVersion bigint NOT NULL,
    VaultKeyVersion bigint NOT NULL,
    VaultRevision bigint NOT NULL,
    IdentityVersion bigint NOT NULL,
    AuthorizationHash binary(32) NULL,
    PackageFingerprint binary(32) NULL,
    PreparedCiphertext varbinary(max) NULL,
    PreparedLoginVerifier varchar(512) NULL,
    CompletionResult varbinary(max) NULL,
    ExpiresAt datetimeoffset(3) NOT NULL,
    CompletedAt datetimeoffset(3) NULL,
    CONSTRAINT CK_ReadyPackage CHECK (State <> 'READY' OR (PackageFingerprint IS NOT NULL AND PreparedCiphertext IS NOT NULL AND PreparedLoginVerifier IS NOT NULL)),
    CONSTRAINT CK_CompletedResult CHECK (State <> 'COMPLETED' OR (PackageFingerprint IS NOT NULL AND CompletionResult IS NOT NULL AND CompletedAt IS NOT NULL))
);
CREATE INDEX IX_KeyOperations_User ON keyvault.Operations(UserId, State);
CREATE INDEX IX_KeyOperations_Expiry ON keyvault.Operations(State, ExpiresAt);
GO
CREATE TABLE messaging.Rooms (
    RoomId uniqueidentifier NOT NULL CONSTRAINT PK_Rooms PRIMARY KEY,
    IsGroup bit NOT NULL,
    Closed bit NOT NULL,
    MembershipVersion bigint NOT NULL CONSTRAINT CK_MembershipVersion CHECK (MembershipVersion > 0),
    LastSequence bigint NOT NULL CONSTRAINT CK_LastSequence CHECK (LastSequence >= 0),
    ActiveKeyVersion bigint NULL,
    LegacyRoomId int NULL REFERENCES dbo.ChatRooms(RoomId),
    CreatedAt datetimeoffset(3) NOT NULL
);
CREATE UNIQUE INDEX UX_LegacyRoom ON messaging.Rooms(LegacyRoomId) WHERE LegacyRoomId IS NOT NULL;
CREATE TABLE messaging.DirectPairs (
    LowerUserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    HigherUserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    RoomId uniqueidentifier NOT NULL CONSTRAINT UQ_DirectRoom UNIQUE REFERENCES messaging.Rooms(RoomId),
    CONSTRAINT PK_DirectPairs PRIMARY KEY (LowerUserId, HigherUserId),
    CONSTRAINT CK_DirectPairOrder CHECK (LowerUserId < HigherUserId)
);
CREATE TABLE messaging.Participants (
    RoomId uniqueidentifier NOT NULL REFERENCES messaging.Rooms(RoomId),
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    JoinedSequence bigint NOT NULL CONSTRAINT CK_JoinedSequence CHECK (JoinedSequence > 0),
    HistoryCutoff bigint NOT NULL CONSTRAINT CK_HistoryCutoff CHECK (HistoryCutoff >= 0),
    LastReadSequence bigint NOT NULL CONSTRAINT CK_LastRead CHECK (LastReadSequence >= 0),
    Hidden bit NOT NULL,
    Muted bit NOT NULL,
    CONSTRAINT PK_Participants PRIMARY KEY (RoomId, UserId)
);
CREATE INDEX IX_Participants_User ON messaging.Participants(UserId, Hidden, RoomId);
CREATE TABLE messaging.Blocks (
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    TargetId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    CONSTRAINT PK_Blocks PRIMARY KEY (UserId, TargetId),
    CONSTRAINT CK_NoSelfBlock CHECK (UserId <> TargetId)
);
CREATE TABLE messaging.RoomKeys (
    RoomId uniqueidentifier NOT NULL REFERENCES messaging.Rooms(RoomId),
    KeyVersion bigint NOT NULL CONSTRAINT CK_RoomKeyVersion CHECK (KeyVersion > 0),
    MembershipVersion bigint NOT NULL,
    RecipientSnapshot varbinary(max) NOT NULL,
    SnapshotFingerprint binary(32) NOT NULL,
    ActivatedAt datetimeoffset(3) NOT NULL,
    CONSTRAINT PK_RoomKeys PRIMARY KEY (RoomId, KeyVersion)
);
ALTER TABLE messaging.Rooms ADD CONSTRAINT FK_ActiveRoomKey FOREIGN KEY (RoomId, ActiveKeyVersion) REFERENCES messaging.RoomKeys(RoomId, KeyVersion);
CREATE TABLE messaging.Envelopes (
    RoomId uniqueidentifier NOT NULL,
    KeyVersion bigint NOT NULL,
    UserId int NOT NULL,
    IdentityVersion bigint NOT NULL,
    SealedPacket varbinary(1024) NOT NULL,
    CONSTRAINT PK_Envelopes PRIMARY KEY (RoomId, KeyVersion, UserId),
    CONSTRAINT FK_EnvelopeEpoch FOREIGN KEY (RoomId, KeyVersion) REFERENCES messaging.RoomKeys(RoomId, KeyVersion),
    CONSTRAINT FK_EnvelopeIdentity FOREIGN KEY (UserId, IdentityVersion) REFERENCES keyvault.Identities(UserId, IdentityVersion)
);
CREATE INDEX IX_Envelopes_User ON messaging.Envelopes(UserId, RoomId, KeyVersion);
CREATE TABLE messaging.Messages (
    RoomId uniqueidentifier NOT NULL,
    Sequence bigint NOT NULL CONSTRAINT CK_MessageSequence CHECK (Sequence > 0),
    MessageId uniqueidentifier NOT NULL CONSTRAINT UQ_MessageId UNIQUE,
    SenderId int NULL REFERENCES auth.AccountSecurity(UserId),
    ClientOperationId uniqueidentifier NOT NULL,
    KeyVersion bigint NOT NULL,
    Ciphertext varbinary(max) NULL,
    SentAt datetimeoffset(3) NOT NULL,
    DeletedAt datetimeoffset(3) NULL,
    CONSTRAINT PK_Messages PRIMARY KEY (RoomId, Sequence),
    CONSTRAINT FK_MessageEpoch FOREIGN KEY (RoomId, KeyVersion) REFERENCES messaging.RoomKeys(RoomId, KeyVersion),
    CONSTRAINT CK_MessageBody CHECK ((DeletedAt IS NULL AND Ciphertext IS NOT NULL AND SenderId IS NOT NULL) OR (DeletedAt IS NOT NULL AND Ciphertext IS NULL))
);
CREATE TABLE messaging.SendOperations (
    RoomId uniqueidentifier NOT NULL,
    SenderId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    ClientOperationId uniqueidentifier NOT NULL,
    PacketFingerprint binary(32) NOT NULL,
    Sequence bigint NOT NULL,
    CONSTRAINT PK_SendOperations PRIMARY KEY (RoomId, SenderId, ClientOperationId),
    CONSTRAINT FK_SendResult FOREIGN KEY (RoomId, Sequence) REFERENCES messaging.Messages(RoomId, Sequence)
);
CREATE TABLE messaging.Attachments (
    AttachmentId uniqueidentifier NOT NULL CONSTRAINT PK_Attachments PRIMARY KEY,
    RoomId uniqueidentifier NOT NULL REFERENCES messaging.Rooms(RoomId),
    OwnerId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    Sequence bigint NULL,
    ObjectKey varchar(255) NOT NULL CONSTRAINT UQ_AttachmentObject UNIQUE,
    CiphertextBytes bigint NOT NULL CONSTRAINT CK_AttachmentSize CHECK (CiphertextBytes BETWEEN 17 AND 5242896),
    CiphertextDigest binary(32) NOT NULL,
    ExpiresAt datetimeoffset(3) NOT NULL,
    CONSTRAINT FK_AttachmentMessage FOREIGN KEY (RoomId, Sequence) REFERENCES messaging.Messages(RoomId, Sequence)
);
CREATE UNIQUE INDEX UX_MessageAttachment ON messaging.Attachments(RoomId, Sequence) WHERE Sequence IS NOT NULL;
CREATE INDEX IX_Attachments_Expiry ON messaging.Attachments(ExpiresAt) WHERE Sequence IS NULL;
GO
