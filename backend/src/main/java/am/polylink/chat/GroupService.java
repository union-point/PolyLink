package am.polylink.chat;

import static am.polylink.chat.ChatDtos.*;

import am.polylink.auth.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** Group transitions share the exact account/room locks used by send and identity activation. */
@Service
@IdentityEnabled
public class GroupService {
    private final ChatService chat;

    public GroupService(ChatService chat) {
        this.chat = chat;
    }

    private AuthFailure conflict() {
        return new AuthFailure(
                409, "REVISION_CONFLICT", "Group state changed. Retry with a fresh snapshot.");
    }

    private AuthFailure forbidden() {
        return new AuthFailure(403, "FORBIDDEN", "This group action is unavailable.");
    }

    private Map<String, Object> metadata(UUID room) {
        var rows = Rows.query(chat.db, "SELECT * FROM messaging.Groups WHERE RoomId=?", room);
        if (rows.isEmpty()) throw forbidden();
        return rows.getFirst();
    }

    private void owner(int caller, Map<String, Object> group) {
        if (!Objects.equals(group.get("OwnerId"), caller)) throw forbidden();
    }

    private void configured(Collection<Integer> ids) {
        if (ids.isEmpty() || ids.size() > 100) throw AuthFailure.invalid();
        for (int id : ids) {
            var a = chat.accounts.get(id);
            a.requireAdmitted();
            if (a.identity() < 1 || a.vaultKey() < 1 || a.vaultRevision() < 1)
                throw new AuthFailure(
                        409,
                        "RECIPIENT_UNCONFIGURED",
                        "A participant has not completed encrypted account setup.");
        }
    }

    private Snapshot proposed(
            UUID room, Map<String, Object> row, Collection<Integer> ids, long membership) {
        configured(ids);
        var recipients = new ArrayList<Recipient>();
        for (int id : new TreeSet<>(ids)) {
            var a = chat.accounts.get(id);
            var key =
                    Rows.query(
                                    chat.db,
                                    "SELECT PublicKey FROM keyvault.Identities WHERE UserId=? AND IdentityVersion=?",
                                    id,
                                    a.identity())
                            .getFirst();
            recipients.add(
                    new Recipient(
                            "" + id,
                            "" + a.identity(),
                            Secrets.encode((byte[]) key.get("PublicKey"))));
        }
        String active = Objects.toString(row.get("ActiveKeyVersion"), "0");
        return new Snapshot(
                room.toString(),
                new Versions("" + membership, active),
                recipients,
                active.equals("0") ? "missing" : "stale");
    }

    public Snapshot prepare(int caller, UUID existing, GroupPrepare input) {
        UUID room = uuid(input.roomId());
        if (existing != null && !existing.equals(room)) throw AuthFailure.invalid();
        var ids = new TreeSet<Integer>();
        input.userIds().forEach(id -> ids.add(user(id)));
        return chat.transaction(
                () -> {
                    if (existing == null) {
                        ids.add(caller);
                        if (ids.size() < 2) throw AuthFailure.invalid();
                        for (int id : ids) chat.accounts.lock(id);
                        if (!Rows.query(
                                        chat.db,
                                        "SELECT RoomId FROM messaging.Rooms WHERE RoomId=?",
                                        room)
                                .isEmpty()) throw conflict();
                        return proposed(room, Map.of(), ids, 1);
                    }
                    var row = chat.locked(caller, room, ids);
                    owner(caller, metadata(room));
                    if (Boolean.TRUE.equals(row.get("Closed"))) throw forbidden();
                    var current = chat.members(room);
                    if (ids.size() != 1 || current.contains(ids.first()))
                        throw AuthFailure.invalid();
                    ids.addAll(current);
                    return proposed(
                            room,
                            row,
                            ids,
                            Math.addExact(((Number) row.get("MembershipVersion")).longValue(), 1));
                });
    }

    private byte[] fingerprint(String action, UUID room, Object input) {
        return Secrets.digest(chat.json.writeValueAsBytes(List.of(action, room.toString(), input)));
    }

    private Map<String, Object> replay(int caller, String operation, byte[] fingerprint) {
        var rows =
                Rows.query(
                        chat.db,
                        "SELECT Fingerprint,Result FROM messaging.GroupOperations WHERE UserId=? AND OperationId=?",
                        caller,
                        uuid(operation));
        if (rows.isEmpty()) return null;
        if (!Secrets.equal(fingerprint, (byte[]) rows.getFirst().get("Fingerprint")))
            throw new AuthFailure(
                    409, "OPERATION_PAYLOAD_CONFLICT", "This operation ID has different content.");
        // Only minimal transition receipts are retained: no history, participants, or envelopes.
        return chat.json.readValue((byte[]) rows.getFirst().get("Result"), Map.class);
    }

    private Map<String, Object> save(int caller, String operation, byte[] fingerprint, UUID room) {
        var row =
                Rows.query(chat.db, "SELECT * FROM messaging.Rooms WHERE RoomId=?", room)
                        .getFirst();
        var group = metadata(room);
        Map<String, Object> result =
                Map.of(
                        "roomId",
                        room.toString(),
                        "membershipVersion",
                        row.get("MembershipVersion").toString(),
                        "metadataVersion",
                        group.get("MetadataVersion").toString(),
                        "closed",
                        row.get("Closed"));
        chat.db.update(
                "INSERT messaging.GroupOperations VALUES (?,?,?,?,?,?)",
                caller,
                uuid(operation),
                room,
                fingerprint,
                chat.json.writeValueAsBytes(result),
                row.get("MembershipVersion"));
        return result;
    }

    private void join(UUID room, int id, long membership, long sequence) {
        var rows =
                Rows.query(
                        chat.db,
                        "SELECT UserId FROM messaging.Participants WHERE RoomId=? AND UserId=?",
                        room,
                        id);
        if (rows.isEmpty())
            chat.db.update(
                    "INSERT messaging.Participants VALUES (?,?,?,?,?,0,0)",
                    room,
                    id,
                    sequence,
                    sequence - 1,
                    sequence - 1);
        else
            chat.db.update(
                    "UPDATE messaging.Participants SET JoinedSequence=?,HistoryCutoff=?,LastReadSequence=?,Hidden=0,Muted=0 WHERE RoomId=? AND UserId=?",
                    sequence,
                    sequence - 1,
                    sequence - 1,
                    room,
                    id);
        chat.db.update(
                "INSERT messaging.MembershipIntervals(RoomId,UserId,JoinedMembership,JoinedSequence) VALUES (?,?,?,?)",
                room,
                id,
                membership,
                sequence);
    }

    public Map<String, Object> create(int caller, GroupCreate input) {
        UUID room = uuid(input.roomId());
        var activation = input.activation();
        var ids = new TreeSet<Integer>();
        if (activation.expected().recipients() == null) throw AuthFailure.invalid();
        activation.expected().recipients().forEach(r -> ids.add(user(r.userId())));
        if (ids.size() < 2 || !ids.contains(caller)) throw AuthFailure.invalid();
        byte[] fingerprint = fingerprint("create", room, input);
        return chat.transaction(
                () -> {
                    for (int id : ids) chat.accounts.lock(id);
                    chat.accounts.get(caller).requireAdmitted();
                    var replay = replay(caller, input.operationId(), fingerprint);
                    if (replay != null) return replay;
                    configured(ids);
                    if (!Rows.query(
                                    chat.db,
                                    "SELECT RoomId FROM messaging.Rooms WITH(UPDLOCK,HOLDLOCK) WHERE RoomId=?",
                                    room)
                            .isEmpty()) throw conflict();
                    chat.db.update(
                            "INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (?,1,0,1,0,?)",
                            room,
                            chat.now());
                    chat.db.update(
                            "INSERT messaging.Groups VALUES (?,?,?,1)",
                            room,
                            groupName(input.name()),
                            caller);
                    for (int id : ids) join(room, id, 1, 1);
                    chat.activate(caller, room, activation);
                    return save(caller, input.operationId(), fingerprint, room);
                });
    }

    public Map<String, Object> participants(int caller, UUID room) {
        return chat.transaction(
                () -> {
                    var row = chat.locked(caller, room);
                    metadata(room);
                    return chat.summary(caller, room, row);
                });
    }

    public Map<String, Object> change(
            int caller, UUID room, String action, String target, GroupChange input) {
        int selected =
                target == null
                        ? input.userId() == null ? caller : user(input.userId())
                        : user(target);
        byte[] fingerprint = fingerprint(action + ":" + selected, room, input);
        return chat.transaction(
                () -> {
                    // Include retained participants so a removed caller can retrieve only its
                    // minimal receipt.
                    var ids = new TreeSet<>(chat.allMembers(room));
                    ids.add(caller);
                    ids.add(selected);
                    for (int id : ids) chat.accounts.lock(id);
                    chat.accounts.get(caller).requireAdmitted();
                    var receipt = replay(caller, input.operationId(), fingerprint);
                    if (receipt != null) return receipt;
                    var row = chat.locked(caller, room, List.of(selected));
                    var group = metadata(room);
                    if (Boolean.TRUE.equals(row.get("Closed"))) throw forbidden();
                    if (!row.get("MembershipVersion").toString().equals(input.expectedMembership())
                            || !group.get("MetadataVersion")
                                    .toString()
                                    .equals(input.expectedMetadata())) throw conflict();
                    if (!action.equals("leave")) owner(caller, group);
                    var members = chat.members(room);
                    switch (action) {
                        case "rename" -> {
                            if (input.userId() != null || input.activation() != null)
                                throw AuthFailure.invalid();
                            chat.db.update(
                                    "UPDATE messaging.Groups SET Name=?,MetadataVersion=MetadataVersion+1 WHERE RoomId=?",
                                    groupName(input.name()),
                                    room);
                        }
                        case "owner" -> {
                            if (input.userId() == null
                                    || input.name() != null
                                    || input.activation() != null
                                    || !members.contains(selected)) throw AuthFailure.invalid();
                            chat.accounts.get(selected).requireAdmitted();
                            chat.db.update(
                                    "UPDATE messaging.Groups SET OwnerId=?,MetadataVersion=MetadataVersion+1 WHERE RoomId=?",
                                    selected,
                                    room);
                        }
                        case "add" -> {
                            if (input.userId() == null
                                    || input.name() != null
                                    || input.activation() == null
                                    || members.contains(selected)) throw AuthFailure.invalid();
                            var future = new TreeSet<>(members);
                            future.add(selected);
                            configured(future);
                            long next = Math.addExact(counter(input.expectedMembership()), 1);
                            var expected = proposed(room, row, future, next);
                            if (!expected.equals(input.activation().expected())) throw conflict();
                            join(
                                    room,
                                    selected,
                                    next,
                                    Math.addExact(
                                            ((Number) row.get("LastSequence")).longValue(), 1));
                            chat.db.update(
                                    "UPDATE messaging.Rooms SET MembershipVersion=? WHERE RoomId=?",
                                    next,
                                    room);
                            chat.activate(caller, room, input.activation());
                        }
                        case "remove", "leave" -> {
                            if (input.name() != null
                                    || input.activation() != null
                                    || action.equals("leave") && input.userId() != null
                                    || !members.contains(selected)
                                    || action.equals("remove") && selected == caller)
                                throw AuthFailure.invalid();
                            if (Objects.equals(group.get("OwnerId"), selected)
                                    && members.size() > 1)
                                throw new AuthFailure(
                                        409,
                                        "OWNER_TRANSFER_REQUIRED",
                                        "Transfer ownership before leaving.");
                            depart(room, selected, row);
                        }
                        default -> throw AuthFailure.invalid();
                    }
                    return save(caller, input.operationId(), fingerprint, room);
                });
    }

    /** Operator-only import of reviewed legacy membership. Never imports plaintext bodies. */
    public UUID importLegacy(int legacy, int owner, String name) {
        groupName(name);
        return chat.transaction(
                () -> {
                    var ids =
                            chat.db.queryForList(
                                    "SELECT UserId FROM dbo.ChatParticipants WHERE RoomId=? ORDER BY UserId",
                                    Integer.class,
                                    legacy);
                    if (ids.size() < 2 || !ids.contains(owner)) throw AuthFailure.invalid();
                    for (int id : ids) chat.accounts.lock(id);
                    configured(ids);
                    var source =
                            Rows.query(
                                    chat.db,
                                    "SELECT IsGroup FROM dbo.ChatRooms WITH(UPDLOCK,HOLDLOCK) WHERE RoomId=?",
                                    legacy);
                    if (source.isEmpty() || !Boolean.TRUE.equals(source.getFirst().get("IsGroup")))
                        throw AuthFailure.invalid();
                    if (!ids.equals(
                            chat.db.queryForList(
                                    "SELECT UserId FROM dbo.ChatParticipants WHERE RoomId=? ORDER BY UserId",
                                    Integer.class,
                                    legacy))) throw conflict();
                    var existing =
                            Rows.query(
                                    chat.db,
                                    "SELECT RoomId FROM messaging.Rooms WHERE LegacyRoomId=?",
                                    legacy);
                    if (!existing.isEmpty())
                        return UUID.fromString(existing.getFirst().get("RoomId").toString());
                    UUID room = UUID.randomUUID();
                    chat.db.update(
                            "INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,LegacyRoomId,CreatedAt) VALUES (?,1,0,1,0,?,?)",
                            room,
                            legacy,
                            chat.now());
                    chat.db.update("INSERT messaging.Groups VALUES (?,?,?,1)", room, name, owner);
                    for (int id : ids) join(room, id, 1, 1);
                    return room;
                });
    }

    /** Caller already holds affected accounts and room locks. No crypto is needed to revoke. */
    void depart(UUID room, int user, Map<String, Object> row) {
        long next = Math.addExact(((Number) row.get("MembershipVersion")).longValue(), 1);
        // Fixed-group fixtures/imports created after V7 may not yet have an interval.
        chat.db.update(
                "INSERT messaging.MembershipIntervals(RoomId,UserId,JoinedMembership,JoinedSequence) SELECT RoomId,UserId,1,JoinedSequence FROM messaging.Participants p WHERE RoomId=? AND UserId=? AND NOT EXISTS(SELECT 1 FROM messaging.MembershipIntervals i WHERE i.RoomId=p.RoomId AND i.UserId=p.UserId)",
                room,
                user);
        chat.db.update(
                "UPDATE messaging.MembershipIntervals SET LeftMembership=?,LeftSequence=? WHERE RoomId=? AND UserId=? AND LeftMembership IS NULL",
                next,
                row.get("LastSequence"),
                room,
                user);
        chat.db.update(
                "UPDATE messaging.Rooms SET MembershipVersion=?,Closed=CASE WHEN ?=0 THEN 1 ELSE Closed END WHERE RoomId=?",
                next,
                chat.members(room).size(),
                room);
        chat.db.update(
                "UPDATE messaging.Participants SET Hidden=1 WHERE RoomId=? AND UserId=?",
                room,
                user);
    }
}
