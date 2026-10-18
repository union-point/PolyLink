-- Additive to M5: retain participant personal state and every message/key reference.
CREATE TABLE messaging.Groups (
    RoomId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES messaging.Rooms(RoomId),
    Name nvarchar(100) NOT NULL,
    OwnerId int NULL REFERENCES auth.AccountSecurity(UserId),
    MetadataVersion bigint NOT NULL CHECK (MetadataVersion > 0)
);
CREATE TABLE messaging.MembershipIntervals (
    RoomId uniqueidentifier NOT NULL,
    UserId int NOT NULL,
    JoinedMembership bigint NOT NULL,
    JoinedSequence bigint NOT NULL CHECK (JoinedSequence > 0),
    LeftMembership bigint NULL,
    LeftSequence bigint NULL,
    PRIMARY KEY (RoomId,UserId,JoinedMembership),
    FOREIGN KEY (RoomId,UserId) REFERENCES messaging.Participants(RoomId,UserId),
    CHECK ((LeftMembership IS NULL AND LeftSequence IS NULL) OR
           (LeftMembership > JoinedMembership AND LeftSequence >= JoinedSequence-1))
);
CREATE UNIQUE INDEX UX_CurrentMembership ON messaging.MembershipIntervals(RoomId,UserId) WHERE LeftMembership IS NULL;
CREATE TABLE messaging.GroupOperations (
    UserId int NOT NULL REFERENCES auth.AccountSecurity(UserId),
    OperationId uniqueidentifier NOT NULL,
    RoomId uniqueidentifier NOT NULL REFERENCES messaging.Rooms(RoomId),
    Fingerprint binary(32) NOT NULL,
    Result varbinary(max) NOT NULL,
    MembershipVersion bigint NOT NULL,
    PRIMARY KEY (UserId,OperationId)
);
CREATE TABLE auth.AccountDeletions (
    UserId int NOT NULL PRIMARY KEY REFERENCES auth.AccountSecurity(UserId),
    DeletedAt datetimeoffset(3) NOT NULL
);
GO
-- Existing encrypted fixed groups retain history and personal settings. Deterministic
-- ownership is assigned only to admitted, verified members. An ownerless group closes.
INSERT messaging.Groups(RoomId,Name,OwnerId,MetadataVersion)
SELECT r.RoomId,N'Group',MIN(CASE WHEN a.AdmissionStatus='ADMITTED' AND a.EmailVerifiedAt IS NOT NULL THEN p.UserId END),1
FROM messaging.Rooms r LEFT JOIN messaging.Participants p ON p.RoomId=r.RoomId
LEFT JOIN auth.AccountSecurity a ON a.UserId=p.UserId WHERE r.IsGroup=1 GROUP BY r.RoomId;
UPDATE r SET Closed=1 FROM messaging.Rooms r JOIN messaging.Groups g ON g.RoomId=r.RoomId WHERE g.OwnerId IS NULL;
INSERT messaging.MembershipIntervals(RoomId,UserId,JoinedMembership,JoinedSequence)
SELECT p.RoomId,p.UserId,1,p.JoinedSequence FROM messaging.Participants p JOIN messaging.Rooms r ON r.RoomId=p.RoomId WHERE r.IsGroup=1;
-- dbo.ChatMessages remain quarantined legacy plaintext; never copy them into PLK1.
GO
