package am.polylink.chat;

import am.polylink.auth.*;
import java.util.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@IdentityEnabled
public class AccountLifecycle {
    public record Request(String expectedCredential, String loginSecret) {
        public Request {
            if (ChatDtos.counter(expectedCredential) < 1) throw AuthFailure.invalid();
            Secrets.decode(loginSecret, 32);
        }

        @Override
        public String toString() {
            return "LifecycleRequest[redacted]";
        }
    }

    private final ChatService chat;
    private final GroupService groups;
    private final PasswordEncoder encoder;

    public AccountLifecycle(ChatService chat, GroupService groups, PasswordEncoder encoder) {
        this.chat = chat;
        this.groups = groups;
        this.encoder = encoder;
    }

    private List<UUID> rooms(int user) {
        return chat
                .db
                .queryForList(
                        "SELECT RoomId FROM messaging.Participants WHERE UserId=?",
                        String.class,
                        user)
                .stream()
                .map(UUID::fromString)
                .sorted(Comparator.comparing(UUID::toString))
                .toList();
    }

    public void apply(Sessions.Principal principal, Request input, boolean delete) {
        int caller = principal.account().id();
        var base = chat.accounts.get(caller);
        if (base.credential() != ChatDtos.counter(input.expectedCredential())
                || !encoder.matches(input.loginSecret(), base.verifier()))
            throw AuthFailure.denied();
        transition(caller, base.credential(), delete, false);
    }

    /**
     * Operator-only replay before exposing a restored database. Idempotent, with no login bypass
     * route.
     */
    public void replayDeletion(int caller) {
        // A supported backup can predate registration or security enrollment.
        if (chat.db.queryForObject(
                        "SELECT COUNT(*) FROM dbo.Users WHERE UserId=?", Integer.class, caller)
                == 0) return;
        if (chat.db.queryForObject(
                        "SELECT COUNT(*) FROM auth.AccountSecurity WHERE UserId=?",
                        Integer.class,
                        caller)
                == 0)
            chat.db.update(
                    "INSERT auth.AccountSecurity(UserId,AdmissionStatus,CredentialVersion,SchemeVersion,ClientSalt,ClientOpsLimit,ClientMemoryBytes,LoginVerifier,EmailFactorEnabled) VALUES (?,'DELETED',1,1,0x00,2,67108864,'DELETED',0)",
                    caller);
        transition(caller, 0, true, true);
    }

    private void transition(int caller, long credential, boolean delete, boolean restoring) {
        chat.transaction(
                () -> {
                    var roomIds = rooms(caller);
                    var people = new TreeSet<Integer>();
                    people.add(caller);
                    var snapshots = new HashMap<UUID, List<Integer>>();
                    for (var room : roomIds) {
                        var members = chat.allMembers(room);
                        snapshots.put(room, members);
                        people.addAll(members);
                    }
                    for (int id : people) chat.accounts.lock(id);
                    var account = chat.accounts.get(caller);
                    if (restoring
                            && account.admission().equals("DELETED")
                            && !Rows.query(
                                            chat.db,
                                            "SELECT UserId FROM auth.AccountDeletions WHERE UserId=?",
                                            caller)
                                    .isEmpty()) return null;
                    if (!restoring) {
                        account.requireAdmitted();
                        if (account.credential() != credential) throw AuthFailure.conflict();
                    }
                    if (!roomIds.equals(rooms(caller))) throw AuthFailure.conflict();
                    var locked = new LinkedHashMap<UUID, Map<String, Object>>();
                    for (var room : roomIds) {
                        var row =
                                Rows.query(
                                                chat.db,
                                                "SELECT * FROM messaging.Rooms WITH(UPDLOCK,HOLDLOCK) WHERE RoomId=?",
                                                room)
                                        .getFirst();
                        if (!snapshots.get(room).equals(chat.allMembers(room)))
                            throw AuthFailure.conflict();
                        locked.put(room, row);
                    }
                    chat.db.update("DELETE auth.EmailChanges WHERE UserId=?", caller);
                    chat.db.update("DELETE auth.ExportGrants WHERE UserId=?", caller);
                    chat.db.update(
                            "DELETE auth.ActivityNotifications WHERE UserId=? OR ActorId=?",
                            caller,
                            caller);
                    if (delete) {
                        chat.db.update(
                                "INSERT auth.RegistryClaimAudit(UserId,AlumniRegistryId,LecturerRegistryId,Action,Actor) SELECT UserId,AlumniRegistryId,LecturerRegistryId,'RELEASE',? FROM auth.RegistryClaims WHERE UserId=?",
                                restoring ? "deletion-replay" : "account-deletion",
                                caller);
                        chat.db.update("DELETE auth.RegistryClaims WHERE UserId=?", caller);
                        chat.db.update("DELETE auth.EnrollmentSessions WHERE UserId=?", caller);
                        chat.db.update(
                                "IF OBJECT_ID(N'forum.CreateRequests') IS NOT NULL DELETE forum.CreateRequests WHERE UserId=?",
                                caller);
                        for (String table :
                                java.util.List.of(
                                        "Education",
                                        "Certificates",
                                        "WorkExperience",
                                        "Lecturers",
                                        "ForumReplyLikes",
                                        "UserNotificationSettings"))
                            chat.db.update("DELETE dbo." + table + " WHERE UserId=?", caller);
                        for (var entry : locked.entrySet()) {
                            var room = entry.getKey();
                            var row = entry.getValue();
                            if (!Boolean.TRUE.equals(row.get("IsGroup"))) {
                                chat.db.update(
                                        "UPDATE messaging.Rooms SET Closed=1 WHERE RoomId=?", room);
                                continue;
                            }
                            if (chat.members(room).contains(caller))
                                groups.depart(room, caller, row);
                            var metadata =
                                    Rows.query(
                                            chat.db,
                                            "SELECT * FROM messaging.Groups WHERE RoomId=?",
                                            room);
                            if (!metadata.isEmpty()
                                    && Objects.equals(metadata.getFirst().get("OwnerId"), caller)) {
                                var successor =
                                        chat.members(room).stream()
                                                .filter(
                                                        id -> {
                                                            var a = chat.accounts.get(id);
                                                            return a.admission().equals("ADMITTED")
                                                                    && a.verified();
                                                        })
                                                .min(Integer::compareTo)
                                                .orElse(null);
                                chat.db.update(
                                        "UPDATE messaging.Groups SET OwnerId=?,MetadataVersion=MetadataVersion+1 WHERE RoomId=?",
                                        successor,
                                        room);
                                if (successor == null)
                                    chat.db.update(
                                            "UPDATE messaging.Rooms SET Closed=1 WHERE RoomId=?",
                                            room);
                            }
                        }
                        chat.db.update(
                                "DELETE b FROM messaging.AttachmentBodies b JOIN messaging.Attachments a ON a.AttachmentId=b.AttachmentId WHERE a.OwnerId=?",
                                caller);
                        chat.db.update(
                                "UPDATE messaging.Attachments SET ExpiresAt=? WHERE OwnerId=? AND Sequence IS NULL",
                                chat.now().minusSeconds(1),
                                caller);
                        chat.db.update(
                                "UPDATE messaging.Messages SET Ciphertext=NULL,SenderId=NULL,DeletedAt=? WHERE SenderId=?",
                                chat.now(),
                                caller);
                        chat.db.update(
                                "UPDATE auth.AccountSecurity SET LoginVerifier='DELETED',EmailVerifiedAt=NULL,EmailFactorEnabled=0 WHERE UserId=?",
                                caller);
                        chat.db.update(
                                "UPDATE auth.Invitations SET Email=?,RevokedAt=? WHERE ConsumedUserId=? OR Email=?",
                                "deleted-" + caller + "@deleted.invalid",
                                chat.now(),
                                caller,
                                account.email());
                        chat.db.update("DELETE auth.EmailChallenges WHERE UserId=?", caller);
                        chat.db.update("DELETE keyvault.Vaults WHERE UserId=?", caller);
                        chat.db.update(
                                "DELETE a FROM auth.RecoveryAuthorizations a JOIN keyvault.Operations o ON o.OperationId=a.OperationId WHERE o.UserId=?",
                                caller);
                        chat.db.update("DELETE keyvault.Operations WHERE UserId=?", caller);
                        chat.db.update("DELETE auth.PendingEnrollments WHERE UserId=?", caller);
                        chat.db.update(
                                "DELETE messaging.Blocks WHERE UserId=? OR TargetId=?",
                                caller,
                                caller);
                        chat.db.update(
                                "UPDATE dbo.Users SET FirstName=N'Deleted',LastName=N'account',Email=?,ProfilePhotoUrl=NULL,CoverPhotoUrl=NULL,About=NULL,Specialization=NULL,IsProfilePublic=0 WHERE UserId=?",
                                "deleted-" + caller + "@deleted.invalid",
                                caller);
                        chat.db.update(
                                "INSERT auth.AccountDeletions VALUES (?,?)", caller, chat.now());
                    }
                    chat.db.update(
                            "UPDATE auth.AccountSecurity SET AdmissionStatus=?,CredentialVersion=CredentialVersion+CASE WHEN ?=1 THEN 1 ELSE 0 END,UpdatedAt=? WHERE UserId=?",
                            delete ? "DELETED" : "DEACTIVATED",
                            delete,
                            chat.now(),
                            caller);
                    chat.db.update(
                            "UPDATE auth.Sessions SET RevokedAt=?,ReplayPacket=NULL WHERE UserId=?",
                            chat.now(),
                            caller);
                    chat.db.update(
                            "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE UserId=? AND ConsumedAt IS NULL",
                            chat.now(),
                            caller);
                    if (!delete)
                        chat.db.update(
                                "UPDATE keyvault.Operations SET State='CANCELLED',PreparedCiphertext=NULL,PreparedLoginVerifier=NULL WHERE UserId=? AND State NOT IN ('COMPLETED','EXPIRED','CANCELLED')",
                                caller);
                    return null;
                });
    }
}
