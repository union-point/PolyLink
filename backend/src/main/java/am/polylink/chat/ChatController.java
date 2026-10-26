package am.polylink.chat;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.*;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.messenger.enabled", havingValue = "true")
public class ChatController {
    private final Sessions sessions;
    private final ChatService chat;
    private final Clock clock;
    private final RateLimiter limits;

    private record Scan(int user, Instant expiry, List<Map<String, Object>> rooms) {}

    private final Map<String, Scan> scans = new LinkedHashMap<>();

    public ChatController(Sessions sessions, ChatService chat, Clock clock, RateLimiter limits) {
        this.sessions = sessions;
        this.chat = chat;
        this.clock = clock;
        this.limits = limits;
    }

    private int user(HttpServletRequest request) {
        return sessions.require(request).account().id();
    }

    @PostMapping("/chat/direct")
    public Map<String, Object> direct(
            @RequestBody ChatDtos.Direct input, HttpServletRequest request) {
        return chat.direct(user(request), input.userId());
    }

    @GetMapping("/chat/export")
    public Map<String, Object> exportOwn(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit,
            HttpServletRequest request) {
        return chat.exportOwn(user(request), cursor, limit);
    }

    @GetMapping("/chat/rooms")
    public Map<String, Object> rooms(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit,
            HttpServletRequest request) {
        int caller = user(request);
        if (limit < 1 || limit > 100) throw AuthFailure.invalid();
        String token;
        int offset;
        Scan scan;
        synchronized (scans) {
            scans.values().removeIf(s -> !s.expiry().isAfter(clock.instant()));
            if (cursor == null) {
                if (scans.size() >= 256) scans.remove(scans.keySet().iterator().next());
                token = UUID.randomUUID().toString();
                offset = 0;
                scan = null;
            } else {
                String[] parts = cursor.split(":");
                if (parts.length != 2) throw AuthFailure.invalid();
                token = ChatDtos.uuid(parts[0]).toString();
                offset = ChatDtos.user(parts[1]);
                scan = scans.get(token);
                if (scan == null || scan.user() != caller) throw AuthFailure.conflict();
            }
        }
        if (scan == null) {
            scan = new Scan(caller, clock.instant().plusSeconds(30), chat.list(caller));
            synchronized (scans) {
                scans.put(token, scan);
            }
        }
        if (offset > scan.rooms().size()) throw AuthFailure.invalid();
        int end = Math.min(offset + limit, scan.rooms().size());
        // Recheck authorization on every page; snapshots must never revive removed access.
        var visible = new ArrayList<Map<String, Object>>();
        for (var room : scan.rooms().subList(offset, end)) {
            try {
                visible.add(
                        chat.visibleSummary(caller, UUID.fromString(room.get("id").toString())));
            } catch (AuthFailure e) {
                if (e.status != 404) throw e;
            }
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("items", visible);
        result.put("nextCursor", end < scan.rooms().size() ? token + ":" + end : null);
        result.put("snapshotExpiresAt", scan.expiry().toString());
        return result;
    }

    @GetMapping("/chat/rooms/{roomId}/keys")
    public Map<String, Object> keys(@PathVariable String roomId, HttpServletRequest request) {
        return chat.keys(user(request), ChatDtos.uuid(roomId));
    }

    @PostMapping("/chat/rooms/{roomId}/keys/activate")
    public ChatDtos.Snapshot activate(
            @PathVariable String roomId,
            @RequestBody ChatDtos.Activation input,
            HttpServletRequest request) {
        return chat.activate(user(request), ChatDtos.uuid(roomId), input);
    }

    @GetMapping("/chat/rooms/{roomId}/messages")
    public Map<String, Object> history(
            @PathVariable String roomId,
            @RequestParam(required = false) String before,
            @RequestParam(required = false) String after,
            @RequestParam(defaultValue = "50") int limit,
            HttpServletRequest request) {
        return chat.history(user(request), ChatDtos.uuid(roomId), before, after, limit);
    }

    @PostMapping("/chat/rooms/{roomId}/messages")
    public Map<String, Object> send(
            @PathVariable String roomId,
            @RequestBody ChatDtos.Send input,
            HttpServletRequest request) {
        return chat.send(user(request), ChatDtos.uuid(roomId), input);
    }

    @PutMapping("/chat/rooms/{roomId}/read")
    public Map<String, Object> read(
            @PathVariable String roomId,
            @RequestBody ChatDtos.Read input,
            HttpServletRequest request) {
        return chat.read(user(request), ChatDtos.uuid(roomId), input);
    }

    @PutMapping("/chat/rooms/{roomId}/mute")
    public Map<String, Object> mute(
            @PathVariable String roomId,
            @RequestBody ChatDtos.Toggle input,
            HttpServletRequest request) {
        return chat.mute(user(request), ChatDtos.uuid(roomId), input.enabled());
    }

    @PostMapping("/chat/rooms/{roomId}/hide")
    public Map<String, Object> hide(
            @PathVariable String roomId,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        if (!input.isEmpty()) throw AuthFailure.invalid();
        return chat.hide(user(request), ChatDtos.uuid(roomId));
    }

    @PutMapping("/chat/blocks/{userId}")
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void block(
            @PathVariable String userId,
            @RequestBody ChatDtos.Toggle input,
            HttpServletRequest request) {
        chat.block(user(request), ChatDtos.user(userId), input.enabled());
    }

    @PostMapping(value = "/chat/rooms/{roomId}/attachments", consumes = "application/octet-stream")
    @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    public Map<String, Object> upload(
            @PathVariable String roomId,
            @RequestHeader("X-Attachment-Id") String id,
            @RequestBody byte[] bytes,
            HttpServletRequest request) {
        int caller = user(request);
        limits.consume("UPLOAD_ACCOUNT", "" + caller, 60, 3600);
        return chat.upload(caller, ChatDtos.uuid(roomId), ChatDtos.uuid(id), bytes);
    }

    @GetMapping("/chat/attachments/{attachmentId}")
    public org.springframework.http.ResponseEntity<byte[]> download(
            @PathVariable String attachmentId, HttpServletRequest request) {
        return org.springframework.http.ResponseEntity.ok()
                .header("Content-Disposition", "attachment")
                .contentType(org.springframework.http.MediaType.APPLICATION_OCTET_STREAM)
                .body(chat.download(user(request), ChatDtos.uuid(attachmentId)));
    }
}
