package am.polylink.chat;

import static am.polylink.chat.ChatDtos.*;

import am.polylink.auth.*;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
@IdentityEnabled
public class ChatService {
    final JdbcTemplate db;
    final Accounts accounts;
    final TransactionTemplate tx;
    final JsonMapper json;
    final Clock clock;

    public ChatService(
            JdbcTemplate db,
            Accounts accounts,
            TransactionTemplate tx,
            JsonMapper json,
            Clock clock) {
        this.db = db;
        this.accounts = accounts;
        this.tx = tx;
        this.json = json;
        this.clock = clock;
    }

    OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private static AuthFailure missing() {
        return new AuthFailure(404, "NOT_FOUND", "The conversation is unavailable.");
    }

    private static AuthFailure conflict(String code) {
        return new AuthFailure(409, code, "Conversation state changed. Reload and retry.");
    }

    // SQL Server victims retry the entire transaction, never an individual statement.
    <T> T transaction(Supplier<T> work) {
        for (int attempt = 0; ; attempt++) {
            try {
                return tx.execute(status -> work.get());
            } catch (org.springframework.dao.PessimisticLockingFailureException e) {
                if (attempt == 2) throw e;
            }
        }
    }

    List<Integer> members(UUID room) {
        return db.queryForList(
                "SELECT p.UserId FROM messaging.Participants p WHERE RoomId=? AND (NOT EXISTS(SELECT 1 FROM messaging.MembershipIntervals i WHERE i.RoomId=p.RoomId AND i.UserId=p.UserId) OR EXISTS(SELECT 1 FROM messaging.MembershipIntervals i WHERE i.RoomId=p.RoomId AND i.UserId=p.UserId AND i.LeftMembership IS NULL)) ORDER BY p.UserId",
                Integer.class,
                room);
    }

    Map<String, Object> locked(int caller, UUID room) {
        return locked(caller, room, List.of());
    }

    Map<String, Object> locked(int caller, UUID room, Collection<Integer> extra) {
        var ids = allMembers(room);
        var affected = new TreeSet<>(ids);
        affected.addAll(extra);
        affected.add(caller);
        for (int id : affected) accounts.lock(id);
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM messaging.Rooms WITH(UPDLOCK,HOLDLOCK) WHERE RoomId=?",
                        room);
        if (rows.isEmpty()) throw missing();
        if (!ids.equals(allMembers(room))) throw conflict("REVISION_CONFLICT");
        if (!members(room).contains(caller)) throw missing();
        accounts.get(caller).requireAdmitted();
        return rows.getFirst();
    }

    List<Integer> allMembers(UUID room) {
        return db.queryForList(
                "SELECT UserId FROM messaging.Participants WHERE RoomId=? ORDER BY UserId",
                Integer.class,
                room);
    }

    public Map<String, Object> direct(int caller, String target) {
        int peer = user(target);
        if (caller == peer) throw AuthFailure.invalid();
        return transaction(
                () -> {
                    for (int id : new TreeSet<>(List.of(caller, peer))) {
                        try {
                            accounts.lock(id).requireAdmitted();
                        } catch (AuthFailure e) {
                            throw missing();
                        }
                    }
                    if (db.queryForObject(
                                    "SELECT COUNT(*) FROM messaging.Blocks WHERE UserId=? AND TargetId=?",
                                    Integer.class,
                                    caller,
                                    peer)
                            > 0)
                        throw new AuthFailure(
                                403,
                                "DIRECT_BLOCKED_BY_YOU",
                                "Դուք արգելափակել եք այս օգտատիրոջը։ Կապ հաստատելու համար ապաարգելափակեք նրան։");
                    if (blocked(caller, peer))
                        throw new AuthFailure(
                                403,
                                "DIRECT_UNAVAILABLE",
                                "Այս օգտատիրոջ հետ հաղորդակցությունն անհասանելի է։");
                    int lower = Math.min(caller, peer), higher = Math.max(caller, peer);
                    var existing =
                            Rows.query(
                                    db,
                                    "SELECT RoomId FROM messaging.DirectPairs WHERE LowerUserId=? AND HigherUserId=?",
                                    lower,
                                    higher);
                    UUID room;
                    if (existing.isEmpty()) {
                        room = UUID.randomUUID();
                        db.update(
                                "INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (?,0,0,1,0,?)",
                                room,
                                now());
                        db.update(
                                "INSERT messaging.DirectPairs VALUES (?,?,?)", lower, higher, room);
                        for (int id : List.of(lower, higher))
                            db.update(
                                    "INSERT messaging.Participants VALUES (?,?,1,0,0,0,0)",
                                    room,
                                    id);
                    } else room = UUID.fromString(existing.getFirst().get("RoomId").toString());
                    var row = locked(caller, room);
                    db.update(
                            "UPDATE messaging.Participants SET Hidden=0 WHERE RoomId=? AND UserId=?",
                            room,
                            caller);
                    return summary(caller, room, row);
                });
    }

    private boolean blocked(int a, int b) {
        return db.queryForObject(
                        "SELECT COUNT(*) FROM messaging.Blocks WHERE (UserId=? AND TargetId=?) OR (UserId=? AND TargetId=?)",
                        Integer.class,
                        a,
                        b,
                        b,
                        a)
                > 0;
    }

    private List<RecipientVersion> versions(Snapshot snapshot) {
        return snapshot.recipients().stream()
                .map(r -> new RecipientVersion(r.userId(), r.identityVersion()))
                .toList();
    }

    Snapshot snapshot(UUID room, Map<String, Object> row) {
        var recipients = new ArrayList<Recipient>();
        boolean configured = true;
        for (int id : members(room)) {
            var a = accounts.get(id);
            String key = null;
            if (a.identity() > 0 && a.vaultKey() > 0 && a.vaultRevision() > 0)
                key =
                        Secrets.encode(
                                (byte[])
                                        Rows.query(
                                                        db,
                                                        "SELECT PublicKey FROM keyvault.Identities WHERE UserId=? AND IdentityVersion=?",
                                                        id,
                                                        a.identity())
                                                .getFirst()
                                                .get("PublicKey"));
            else configured = false;
            recipients.add(new Recipient("" + id, "" + a.identity(), key));
        }
        String active = Objects.toString(row.get("ActiveKeyVersion"), "0"),
                membership = row.get("MembershipVersion").toString();
        String state = configured ? "missing" : "recipient_unconfigured";
        var result =
                new Snapshot(room.toString(), new Versions(membership, active), recipients, state);
        if (configured && !active.equals("0")) {
            var epoch =
                    Rows.query(
                                    db,
                                    "SELECT MembershipVersion,SnapshotFingerprint FROM messaging.RoomKeys WHERE RoomId=? AND KeyVersion=?",
                                    room,
                                    Long.parseLong(active))
                            .getFirst();
            state =
                    membership.equals(epoch.get("MembershipVersion").toString())
                                    && Secrets.equal(
                                            (byte[]) epoch.get("SnapshotFingerprint"),
                                            Secrets.digest(
                                                    json.writeValueAsBytes(versions(result))))
                            ? "ready"
                            : "stale";
        }
        return new Snapshot(room.toString(), result.versions(), List.copyOf(recipients), state);
    }

    public Map<String, Object> keys(int caller, UUID room) {
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    var envelopes = new ArrayList<Object>();
                    for (var e :
                            Rows.query(
                                    db,
                                    "SELECT e.*,k.MembershipVersion FROM messaging.Envelopes e JOIN messaging.RoomKeys k ON k.RoomId=e.RoomId AND k.KeyVersion=e.KeyVersion WHERE e.RoomId=? AND e.UserId=? AND NOT EXISTS(SELECT 1 FROM messaging.MembershipIntervals i WHERE i.RoomId=e.RoomId AND i.UserId=e.UserId AND i.LeftMembership IS NULL AND i.JoinedMembership>k.MembershipVersion) AND (e.KeyVersion=? OR EXISTS(SELECT 1 FROM messaging.Messages m JOIN messaging.Participants p ON p.RoomId=m.RoomId AND p.UserId=? WHERE m.RoomId=e.RoomId AND m.KeyVersion=e.KeyVersion AND m.Sequence>=p.JoinedSequence AND m.Sequence>p.HistoryCutoff))",
                                    room,
                                    caller,
                                    row.get("ActiveKeyVersion"),
                                    caller))
                        envelopes.add(
                                Map.of(
                                        "keyVersion",
                                        e.get("KeyVersion").toString(),
                                        "membershipVersion",
                                        e.get("MembershipVersion").toString(),
                                        "envelope",
                                        new Envelope(
                                                "" + caller,
                                                e.get("IdentityVersion").toString(),
                                                Secrets.encode((byte[]) e.get("SealedPacket")))));
                    return Map.of("snapshot", snapshot(room, row), "envelopes", envelopes);
                });
    }

    private void sendable(UUID room, Map<String, Object> row) {
        if (Boolean.TRUE.equals(row.get("Closed")))
            throw new AuthFailure(403, "FORBIDDEN", "The conversation is closed.");
        var ids = members(room);
        for (int id : ids) {
            var account = accounts.get(id);
            if (!account.verified() || !account.admission().equals("ADMITTED"))
                throw new AuthFailure(403, "FORBIDDEN", "A participant is unavailable.");
        }
        if (!Boolean.TRUE.equals(row.get("IsGroup")) && blocked(ids.get(0), ids.get(1)))
            throw new AuthFailure(403, "FORBIDDEN", "This action is unavailable.");
    }

    public Snapshot activate(int caller, UUID room, Activation input) {
        if (input == null || input.expected() == null || input.envelopes() == null)
            throw AuthFailure.invalid();
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    sendable(room, row);
                    var current = snapshot(room, row);
                    if (!current.equals(input.expected())) throw conflict("REVISION_CONFLICT");
                    if (current.keyState().equals("recipient_unconfigured"))
                        throw conflict("ROOM_KEY_PENDING");
                    if (current.keyState().equals("ready")) throw conflict("REVISION_CONFLICT");
                    long next = Math.addExact(counter(current.versions().roomKey()), 1);
                    if (counter(input.newKeyVersion()) != next
                            || input.envelopes().size() != current.recipients().size())
                        throw AuthFailure.invalid();
                    var sorted =
                            input.envelopes().stream()
                                    .sorted(Comparator.comparingInt(e -> user(e.userId())))
                                    .toList();
                    for (int i = 0; i < sorted.size(); i++) {
                        var envelope = sorted.get(i);
                        var recipient = current.recipients().get(i);
                        if (!envelope.userId().equals(recipient.userId())
                                || !envelope.identityVersion().equals(recipient.identityVersion()))
                            throw AuthFailure.invalid();
                        binary(envelope.sealedPacket(), 49, 1024);
                    }
                    byte[] recipientBytes = json.writeValueAsBytes(versions(current));
                    db.update(
                            "INSERT messaging.RoomKeys VALUES (?,?,?,?,?,?)",
                            room,
                            next,
                            counter(current.versions().membership()),
                            recipientBytes,
                            Secrets.digest(recipientBytes),
                            now());
                    for (var e : sorted)
                        db.update(
                                "INSERT messaging.Envelopes VALUES (?,?,?,?,?)",
                                room,
                                next,
                                user(e.userId()),
                                counter(e.identityVersion()),
                                binary(e.sealedPacket(), 49, 1024));
                    db.update(
                            "UPDATE messaging.Rooms SET ActiveKeyVersion=? WHERE RoomId=?",
                            next,
                            room);
                    row.put("ActiveKeyVersion", next);
                    return snapshot(room, row);
                });
    }

    public Map<String, Object> send(int caller, UUID room, Send input) {
        if (input == null
                || input.packet() == null
                || input.expected() == null
                || input.recipientVersions() == null) throw AuthFailure.invalid();
        UUID operation = uuid(input.operationId());
        input.packet().validate();
        counter(input.expected().membership());
        counter(input.expected().roomKey());
        var recipients =
                input.recipientVersions().stream()
                        .sorted(Comparator.comparingInt(r -> user(r.userId())))
                        .toList();
        for (var r : recipients) counter(r.identityVersion());
        byte[] fingerprint =
                Secrets.digest(
                        json.writeValueAsBytes(
                                Arrays.asList(
                                        "PLK1",
                                        "send",
                                        room.toString(),
                                        "" + caller,
                                        operation.toString(),
                                        input.expected().membership(),
                                        input.expected().roomKey(),
                                        recipients.stream()
                                                .map(r -> List.of(r.userId(), r.identityVersion()))
                                                .toList(),
                                        input.packet().nonce(),
                                        input.packet().ciphertext(),
                                        input.attachmentId())));
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    var replay =
                            Rows.query(
                                    db,
                                    "SELECT * FROM messaging.SendOperations WHERE RoomId=? AND SenderId=? AND ClientOperationId=?",
                                    room,
                                    caller,
                                    operation);
                    if (!replay.isEmpty()) {
                        if (!Secrets.equal(
                                fingerprint, (byte[]) replay.getFirst().get("PacketFingerprint")))
                            throw conflict("OPERATION_PAYLOAD_CONFLICT");
                        var result =
                                messages(
                                        caller,
                                        room,
                                        "m.Sequence=?",
                                        replay.getFirst().get("Sequence"));
                        if (result.isEmpty()) throw missing();
                        return result.getFirst();
                    }
                    sendable(room, row);
                    var current = snapshot(room, row);
                    if (!current.keyState().equals("ready")) throw conflict("ROOM_KEY_PENDING");
                    if (!current.versions().equals(input.expected())
                            || !versions(current).equals(recipients))
                        throw conflict("KEY_STALE_NOT_SAVED");
                    if (input.attachmentId() != null) {
                        var uploads =
                                Rows.query(
                                        db,
                                        "SELECT * FROM messaging.Attachments WITH(UPDLOCK,HOLDLOCK) WHERE AttachmentId=?",
                                        uuid(input.attachmentId()));
                        if (uploads.isEmpty()) throw missing();
                        var upload = uploads.getFirst();
                        if (!room.toString().equalsIgnoreCase(upload.get("RoomId").toString())
                                || ((Number) upload.get("OwnerId")).intValue() != caller)
                            throw missing();
                        if (upload.get("Sequence") != null
                                || !((OffsetDateTime) upload.get("ExpiresAt")).isAfter(now()))
                            throw conflict("ATTACHMENT_UNAVAILABLE_NOT_SAVED");
                    }
                    long sequence =
                            Math.addExact(((Number) row.get("LastSequence")).longValue(), 1);
                    db.update(
                            "INSERT messaging.Messages(RoomId,Sequence,MessageId,SenderId,ClientOperationId,KeyVersion,Ciphertext,SentAt) VALUES (?,?,?,?,?,?,?,?)",
                            room,
                            sequence,
                            UUID.randomUUID(),
                            caller,
                            operation,
                            counter(input.expected().roomKey()),
                            json.writeValueAsBytes(input.packet()),
                            now());
                    if (input.attachmentId() != null)
                        db.update(
                                "UPDATE messaging.Attachments SET Sequence=? WHERE AttachmentId=?",
                                sequence,
                                uuid(input.attachmentId()));
                    db.update(
                            "INSERT messaging.SendOperations VALUES (?,?,?,?,?)",
                            room,
                            caller,
                            operation,
                            fingerprint,
                            sequence);
                    db.update(
                            "UPDATE messaging.Rooms SET LastSequence=? WHERE RoomId=?",
                            sequence,
                            room);
                    db.update(
                            "UPDATE messaging.Participants SET Hidden=0 WHERE RoomId=? AND UserId<>?",
                            room,
                            caller);
                    db.update(
                            "INSERT auth.ActivityNotifications(UserId,Kind,EventKey,ActorId,RoomId,Sequence,CreatedAt,RetryAt) SELECT p.UserId,'DIRECT_MESSAGE',?, ?,p.RoomId,?,?,? FROM messaging.Participants p WHERE p.RoomId=? AND p.UserId<>?",
                            room + ":" + sequence,
                            caller,
                            sequence,
                            now(),
                            now().plusSeconds(60),
                            room,
                            caller);
                    return messages(caller, room, "m.Sequence=?", sequence).getFirst();
                });
    }

    List<Map<String, Object>> messages(int caller, UUID room, String condition, Object... args) {
        var params = new ArrayList<Object>(List.of(caller, room));
        params.addAll(Arrays.asList(args));
        return Rows.query(
                        db,
                        "SELECT m.*,a.AttachmentId,k.MembershipVersion,u.FirstName,u.LastName FROM messaging.Messages m LEFT JOIN messaging.Attachments a ON a.RoomId=m.RoomId AND a.Sequence=m.Sequence JOIN messaging.RoomKeys k ON k.RoomId=m.RoomId AND k.KeyVersion=m.KeyVersion JOIN messaging.Participants p ON p.RoomId=m.RoomId AND p.UserId=? LEFT JOIN dbo.Users u ON u.UserId=m.SenderId WHERE m.RoomId=? AND m.Sequence>=p.JoinedSequence AND m.Sequence>p.HistoryCutoff AND "
                                + condition,
                        params.toArray())
                .stream()
                .map(
                        m -> {
                            Map<String, Object> result = new LinkedHashMap<>();
                            result.put(
                                    "id", m.get("MessageId").toString().toLowerCase(Locale.ROOT));
                            result.put("roomId", room.toString());
                            result.put("sequence", m.get("Sequence").toString());
                            result.put(
                                    "operationId",
                                    m.get("ClientOperationId").toString().toLowerCase(Locale.ROOT));
                            result.put("keyVersion", m.get("KeyVersion").toString());
                            result.put("membershipVersion", m.get("MembershipVersion").toString());
                            result.put("createdAt", m.get("SentAt").toString());
                            result.put("deleted", m.get("DeletedAt") != null);
                            result.put(
                                    "attachmentId",
                                    m.get("AttachmentId") == null
                                            ? null
                                            : m.get("AttachmentId")
                                                    .toString()
                                                    .toLowerCase(Locale.ROOT));
                            result.put(
                                    "sender",
                                    m.get("SenderId") == null
                                            ? null
                                            : Map.of(
                                                    "id",
                                                    m.get("SenderId").toString(),
                                                    "name",
                                                    m.get("FirstName") + " " + m.get("LastName"),
                                                    "avatar",
                                                    ""));
                            result.put(
                                    "packet",
                                    m.get("Ciphertext") == null
                                            ? null
                                            : json.readValue(
                                                    (byte[]) m.get("Ciphertext"), Packet.class));
                            return result;
                        })
                .toList();
    }

    public Map<String, Object> history(
            int caller, UUID room, String before, String after, int limit) {
        if (limit < 1 || limit > 100 || before != null && after != null)
            throw AuthFailure.invalid();
        long cursor =
                before != null ? counter(before) : after != null ? counter(after) : Long.MAX_VALUE;
        return transaction(
                () -> {
                    locked(caller, room);
                    var items =
                            new ArrayList<>(
                                    messages(
                                            caller,
                                            room,
                                            "m.Sequence"
                                                    + (after != null ? ">" : "<")
                                                    + "? ORDER BY m.Sequence "
                                                    + (after != null ? "ASC" : "DESC")
                                                    + " OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
                                            cursor,
                                            limit + 1));
                    boolean more = items.size() > limit;
                    if (more) items.removeLast();
                    if (after == null) Collections.reverse(items);
                    var result = new LinkedHashMap<String, Object>();
                    result.put("items", items);
                    result.put("hasMore", more);
                    result.put(
                            "nextBefore",
                            items.isEmpty() ? null : items.getFirst().get("sequence"));
                    result.put(
                            "nextAfter",
                            items.isEmpty()
                                    ? (after == null ? "0" : after)
                                    : items.getLast().get("sequence"));
                    return result;
                });
    }

    Map<String, Object> summary(int caller, UUID room, Map<String, Object> row) {
        var p =
                Rows.query(
                                db,
                                "SELECT * FROM messaging.Participants WHERE RoomId=? AND UserId=?",
                                room,
                                caller)
                        .getFirst();
        var people =
                members(room).stream()
                        .map(
                                id -> {
                                    var a = accounts.get(id);
                                    return Map.of(
                                            "id",
                                            "" + id,
                                            "name",
                                            a.firstName() + " " + a.lastName(),
                                            "avatar",
                                            "");
                                })
                        .toList();
        var snap = snapshot(room, row);
        boolean block =
                !Boolean.TRUE.equals(row.get("IsGroup"))
                        && blocked(user(people.get(0).get("id")), user(people.get(1).get("id")));
        var result = new LinkedHashMap<String, Object>();
        result.put("id", room.toString());
        result.put("isGroup", row.get("IsGroup"));
        result.put(
                "name",
                people.stream()
                        .filter(a -> !a.get("id").equals("" + caller))
                        .map(a -> a.get("name"))
                        .findFirst()
                        .orElse("Conversation"));
        result.put("participants", people);
        var groups = Rows.query(db, "SELECT * FROM messaging.Groups WHERE RoomId=?", room);
        var group = groups.isEmpty() ? null : groups.getFirst();
        String owner = group == null ? null : Objects.toString(group.get("OwnerId"), null);
        result.put("ownerId", owner);
        result.put(
                "metadataVersion", group == null ? "1" : group.get("MetadataVersion").toString());
        result.put(
                "canManage",
                owner != null
                        && owner.equals("" + caller)
                        && !Boolean.TRUE.equals(row.get("Closed")));

        if (group != null) result.put("name", group.get("Name"));
        result.put(
                "blocked",
                !Boolean.TRUE.equals(row.get("IsGroup"))
                        && db.queryForObject(
                                        "SELECT COUNT(*) FROM messaging.Blocks WHERE UserId=? AND TargetId=?",
                                        Integer.class,
                                        caller,
                                        members(room).stream()
                                                .filter(id -> id != caller)
                                                .findFirst()
                                                .orElse(caller))
                                > 0);
        result.put("closed", row.get("Closed"));
        result.put(
                "canSend",
                !block
                        && !Boolean.TRUE.equals(row.get("Closed"))
                        && members(room).stream()
                                .allMatch(id -> accounts.get(id).admission().equals("ADMITTED"))
                        && !snap.keyState().equals("recipient_unconfigured"));
        result.put("muted", p.get("Muted"));
        result.put(
                "unreadCount",
                ""
                        + db.queryForObject(
                                "SELECT COUNT_BIG(*) FROM messaging.Messages WHERE RoomId=? AND SenderId<>? AND Sequence>? AND Sequence>? AND Sequence>=?",
                                Long.class,
                                room,
                                caller,
                                p.get("LastReadSequence"),
                                p.get("HistoryCutoff"),
                                p.get("JoinedSequence")));
        result.put("historyCutoff", p.get("HistoryCutoff").toString());
        result.put("lastReadSequence", p.get("LastReadSequence").toString());
        result.put("lastSequence", row.get("LastSequence").toString());
        result.put("keySnapshot", snap);
        var last =
                messages(
                        caller,
                        room,
                        "m.Sequence=(SELECT MAX(Sequence) FROM messaging.Messages WHERE RoomId=?)",
                        room);
        result.put("lastMessage", last.isEmpty() ? null : last.getFirst());
        return result;
    }

    public Map<String, Object> read(int caller, UUID room, Read input) {
        long sequence = counter(input.throughSequence());
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    if (sequence > 0 && messages(caller, room, "m.Sequence=?", sequence).isEmpty())
                        throw AuthFailure.invalid();
                    db.update(
                            "UPDATE messaging.Participants SET LastReadSequence=CASE WHEN LastReadSequence<? THEN ? ELSE LastReadSequence END WHERE RoomId=? AND UserId=?",
                            sequence,
                            sequence,
                            room,
                            caller);
                    return summary(caller, room, row);
                });
    }

    public Map<String, Object> mute(int caller, UUID room, boolean value) {
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    db.update(
                            "UPDATE messaging.Participants SET Muted=? WHERE RoomId=? AND UserId=?",
                            value,
                            room,
                            caller);
                    return summary(caller, room, row);
                });
    }

    public Map<String, Object> hide(int caller, UUID room) {
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    long cutoff = ((Number) row.get("LastSequence")).longValue();
                    db.update(
                            "UPDATE messaging.Participants SET Hidden=1,HistoryCutoff=?,LastReadSequence=CASE WHEN LastReadSequence<? THEN ? ELSE LastReadSequence END WHERE RoomId=? AND UserId=?",
                            cutoff,
                            cutoff,
                            cutoff,
                            room,
                            caller);
                    return Map.of("historyCutoff", "" + cutoff);
                });
    }

    public void block(int caller, int target, boolean value) {
        if (caller == target) throw AuthFailure.invalid();
        transaction(
                () -> {
                    for (int id : new TreeSet<>(List.of(caller, target))) {
                        try {
                            accounts.lock(id);
                        } catch (AuthFailure e) {
                            throw missing();
                        }
                    }
                    accounts.get(caller).requireAdmitted();
                    db.update(
                            "DELETE messaging.Blocks WHERE UserId=? AND TargetId=?",
                            caller,
                            target);
                    if (value) db.update("INSERT messaging.Blocks VALUES (?,?)", caller, target);
                    return null;
                });
    }

    public Map<String, Object> upload(int caller, UUID room, UUID id, byte[] bytes) {
        if (bytes == null || bytes.length < 17 || bytes.length > 5242896)
            throw AuthFailure.invalid();
        byte[] digest = Secrets.digest(bytes);
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    var existing =
                            Rows.query(
                                    db,
                                    "SELECT * FROM messaging.Attachments WITH(UPDLOCK,HOLDLOCK) WHERE AttachmentId=?",
                                    id);
                    if (!existing.isEmpty()) {
                        var old = existing.getFirst();
                        if (((Number) old.get("OwnerId")).intValue() != caller
                                || !room.toString().equalsIgnoreCase(old.get("RoomId").toString()))
                            throw missing();
                        if (!Secrets.equal(digest, (byte[]) old.get("CiphertextDigest")))
                            throw conflict("OPERATION_PAYLOAD_CONFLICT");
                        if (old.get("Sequence") == null
                                && !((OffsetDateTime) old.get("ExpiresAt")).isAfter(now()))
                            throw conflict("ATTACHMENT_UNAVAILABLE_NOT_SAVED");
                        return uploadResult(old);
                    }
                    sendable(room, row);
                    long staged =
                            db.queryForObject(
                                    "SELECT COALESCE(SUM(CiphertextBytes),0) FROM messaging.Attachments WHERE OwnerId=? AND Sequence IS NULL AND ExpiresAt>?",
                                    Long.class,
                                    caller,
                                    now());
                    if (staged + bytes.length > 104857920
                            || db.queryForObject(
                                            "SELECT COUNT(*) FROM messaging.Attachments WHERE OwnerId=? AND Sequence IS NULL AND ExpiresAt>?",
                                            Integer.class,
                                            caller,
                                            now())
                                    >= 20)
                        throw new AuthFailure(
                                429, "RATE_LIMITED", "Too many pending image uploads.");
                    var expiry = now().plusHours(24);
                    db.update(
                            "INSERT messaging.Attachments(AttachmentId,RoomId,OwnerId,ObjectKey,CiphertextBytes,CiphertextDigest,ExpiresAt) VALUES (?,?,?,?,?,?,?)",
                            id,
                            room,
                            caller,
                            id.toString(),
                            bytes.length,
                            digest,
                            expiry);
                    db.update("INSERT messaging.AttachmentBodies VALUES (?,?)", id, bytes);
                    return uploadResult(
                            Rows.query(
                                            db,
                                            "SELECT * FROM messaging.Attachments WHERE AttachmentId=?",
                                            id)
                                    .getFirst());
                });
    }

    private Map<String, Object> uploadResult(Map<String, Object> row) {
        return Map.of(
                "attachmentId",
                row.get("AttachmentId").toString().toLowerCase(Locale.ROOT),
                "ciphertextBytes",
                ((Number) row.get("CiphertextBytes")).longValue(),
                "expiresAt",
                row.get("ExpiresAt").toString());
    }

    public byte[] download(int caller, UUID id) {
        var rows =
                Rows.query(db, "SELECT RoomId FROM messaging.Attachments WHERE AttachmentId=?", id);
        if (rows.isEmpty()) throw missing();
        UUID room = UUID.fromString(rows.getFirst().get("RoomId").toString());
        return transaction(
                () -> {
                    locked(caller, room);
                    var objects =
                            Rows.query(
                                    db,
                                    "SELECT b.Ciphertext FROM messaging.Attachments a JOIN messaging.AttachmentBodies b ON b.AttachmentId=a.AttachmentId JOIN messaging.Messages m ON m.RoomId=a.RoomId AND m.Sequence=a.Sequence JOIN messaging.Participants p ON p.RoomId=m.RoomId AND p.UserId=? WHERE a.AttachmentId=? AND m.DeletedAt IS NULL AND m.Sequence>=p.JoinedSequence AND m.Sequence>p.HistoryCutoff",
                                    caller,
                                    id);
                    if (objects.isEmpty()) throw missing();
                    return (byte[]) objects.getFirst().get("Ciphertext");
                });
    }

    /** Minimal admitted-account directory for the existing search page's Connect action. */
    public List<Map<String, Object>> people(String query) {
        if (query == null || query.length() > 100) throw AuthFailure.invalid();
        String text =
                query.strip()
                        .replace("!", "!!")
                        .replace("%", "!%")
                        .replace("_", "!_")
                        .replace("[", "![");
        return Rows.query(
                        db,
                        "SELECT TOP (100) u.UserId,u.FirstName,u.LastName,u.IsProfilePublic FROM dbo.Users u JOIN auth.AccountSecurity a ON a.UserId=u.UserId WHERE a.AdmissionStatus='ADMITTED' AND a.EmailVerifiedAt IS NOT NULL AND (u.FirstName+' '+u.LastName LIKE ? ESCAPE '!') ORDER BY u.FirstName,u.LastName,u.UserId",
                        "%" + text + "%")
                .stream()
                .map(
                        r -> {
                            Map<String, Object> person = new LinkedHashMap<>();
                            person.put("id", r.get("UserId").toString());
                            person.put("firstName", r.get("FirstName"));
                            person.put("lastName", r.get("LastName"));
                            person.put(
                                    "role",
                                    accounts.get(((Number) r.get("UserId")).intValue()).role());
                            person.put("onboardingComplete", true);
                            person.put("canOpenProfile", r.get("IsProfilePublic"));
                            return person;
                        })
                .toList();
    }

    public Map<String, Object> exportOwn(int caller, String cursor, int limit) {
        if (limit < 1 || limit > 100) throw AuthFailure.invalid();
        String lastRoom = "";
        long after = 0;
        if (cursor != null) {
            var parts = cursor.split(":");
            if (parts.length != 2) throw AuthFailure.invalid();
            lastRoom = uuid(parts[0]).toString();
            after = counter(parts[1]);
        }
        final String start = lastRoom;
        final long sequence = after;
        var items = new ArrayList<Map<String, Object>>();
        var rooms =
                db
                        .queryForList(
                                "SELECT RoomId FROM messaging.Participants WHERE UserId=?",
                                String.class,
                                caller)
                        .stream()
                        .map(id -> id.toLowerCase(Locale.ROOT))
                        .sorted()
                        .toList();
        for (String id : rooms) {
            if (id.compareTo(start) < 0) continue;
            UUID room = uuid(id);
            try {
                items.addAll(
                        transaction(
                                () -> {
                                    locked(caller, room);
                                    return messages(
                                            caller,
                                            room,
                                            "m.SenderId=? AND m.DeletedAt IS NULL AND m.Sequence>? ORDER BY m.Sequence OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
                                            caller,
                                            id.equals(start) ? sequence : 0,
                                            limit + 1 - items.size());
                                }));
            } catch (AuthFailure e) {
                if (e.status != 404) throw e;
            }
            if (items.size() > limit) break;
        }
        boolean more = items.size() > limit;
        if (more) items.removeLast();
        var result = new LinkedHashMap<String, Object>();
        result.put("items", items);
        result.put(
                "nextCursor",
                more
                        ? items.getLast().get("roomId") + ":" + items.getLast().get("sequence")
                        : null);
        return result;
    }

    public Map<String, Object> visibleSummary(int caller, UUID room) {
        return transaction(
                () -> {
                    var row = locked(caller, room);
                    if (db.queryForObject(
                            "SELECT Hidden FROM messaging.Participants WHERE RoomId=? AND UserId=?",
                            Boolean.class,
                            room,
                            caller)) throw missing();
                    return summary(caller, room, row);
                });
    }

    public List<Map<String, Object>> list(int caller) {
        return db
                .queryForList(
                        "SELECT RoomId FROM messaging.Participants WHERE UserId=? AND Hidden=0",
                        String.class,
                        caller)
                .stream()
                .map(
                        id -> {
                            try {
                                return visibleSummary(caller, UUID.fromString(id));
                            } catch (AuthFailure failure) {
                                if (failure.status == 404) return null;
                                throw failure;
                            }
                        })
                .filter(Objects::nonNull)
                .sorted(
                        Comparator.<Map<String, Object>, String>comparing(
                                        r ->
                                                r.get("lastMessage") == null
                                                        ? ""
                                                        : ((Map<?, ?>) r.get("lastMessage"))
                                                                .get("createdAt")
                                                                .toString())
                                .reversed()
                                .thenComparing(r -> r.get("id").toString()))
                .toList();
    }
}
