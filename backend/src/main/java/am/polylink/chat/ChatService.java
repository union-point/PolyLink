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
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private final JsonMapper json;
    private final Clock clock;

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

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    private static AuthFailure missing() {
        return new AuthFailure(404, "NOT_FOUND", "The conversation is unavailable.");
    }

    private static AuthFailure conflict(String code) {
        return new AuthFailure(409, code, "Conversation state changed. Reload and retry.");
    }

    // SQL Server victims retry the entire transaction, never an individual statement.
    private <T> T transaction(Supplier<T> work) {
        for (int attempt = 0; ; attempt++) {
            try {
                return tx.execute(status -> work.get());
            } catch (org.springframework.dao.PessimisticLockingFailureException e) {
                if (attempt == 2) throw e;
            }
        }
    }

    private List<Integer> members(UUID room) {
        return db.queryForList(
                "SELECT UserId FROM messaging.Participants WHERE RoomId=? ORDER BY UserId",
                Integer.class,
                room);
    }

    private Map<String, Object> locked(int caller, UUID room) {
        var ids = members(room);
        if (!ids.contains(caller)) throw missing();
        for (int id : ids) accounts.lock(id);
        var rows =
                Rows.query(
                        db,
                        "SELECT * FROM messaging.Rooms WITH(UPDLOCK,HOLDLOCK) WHERE RoomId=?",
                        room);
        if (rows.isEmpty() || !ids.equals(members(room))) throw conflict("REVISION_CONFLICT");
        accounts.get(caller).requireAdmitted();
        return rows.getFirst();
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
                    if (blocked(caller, peer))
                        throw new AuthFailure(403, "FORBIDDEN", "This action is unavailable.");
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

    private Snapshot snapshot(UUID room, Map<String, Object> row) {
        var recipients = new ArrayList<Recipient>();
        boolean configured = true;
        for (int id : members(room)) {
            var a = accounts.get(id);
            String key = null;
            if (a.identity() > 0)
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
                                    "SELECT e.*,k.MembershipVersion FROM messaging.Envelopes e JOIN messaging.RoomKeys k ON k.RoomId=e.RoomId AND k.KeyVersion=e.KeyVersion WHERE e.RoomId=? AND e.UserId=? AND (e.KeyVersion=? OR EXISTS(SELECT 1 FROM messaging.Messages m JOIN messaging.Participants p ON p.RoomId=m.RoomId AND p.UserId=? WHERE m.RoomId=e.RoomId AND m.KeyVersion=e.KeyVersion AND m.Sequence>=p.JoinedSequence AND m.Sequence>p.HistoryCutoff))",
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
        for (int id : ids) accounts.get(id).requireAdmitted();
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
                || input.recipientVersions() == null
                || input.attachmentId() != null) throw AuthFailure.invalid();
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
                                        null)));
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
                    return messages(caller, room, "m.Sequence=?", sequence).getFirst();
                });
    }

    private List<Map<String, Object>> messages(
            int caller, UUID room, String condition, Object... args) {
        var params = new ArrayList<Object>(List.of(caller, room));
        params.addAll(Arrays.asList(args));
        return Rows.query(
                        db,
                        "SELECT m.*,k.MembershipVersion,u.FirstName,u.LastName FROM messaging.Messages m JOIN messaging.RoomKeys k ON k.RoomId=m.RoomId AND k.KeyVersion=m.KeyVersion JOIN messaging.Participants p ON p.RoomId=m.RoomId AND p.UserId=? LEFT JOIN dbo.Users u ON u.UserId=m.SenderId WHERE m.RoomId=? AND m.Sequence>=p.JoinedSequence AND m.Sequence>p.HistoryCutoff AND "
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
                            result.put("attachmentId", null);
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

    private Map<String, Object> summary(int caller, UUID room, Map<String, Object> row) {
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
        result.put("blocked", block);
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

    public List<Map<String, Object>> list(int caller) {
        return db
                .queryForList(
                        "SELECT RoomId FROM messaging.Participants WHERE UserId=? AND Hidden=0",
                        String.class,
                        caller)
                .stream()
                .map(
                        id ->
                                transaction(
                                        () -> {
                                            UUID room = UUID.fromString(id);
                                            return summary(caller, room, locked(caller, room));
                                        }))
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
