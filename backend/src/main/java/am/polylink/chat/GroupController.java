package am.polylink.chat;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
@ConditionalOnProperty(name = "polylink.messenger.enabled", havingValue = "true")
public class GroupController {
    private final Sessions sessions;
    private final GroupService groups;
    private final RateLimiter limits;

    public GroupController(Sessions sessions, GroupService groups, RateLimiter limits) {
        this.sessions = sessions;
        this.groups = groups;
        this.limits = limits;
    }

    private int caller(HttpServletRequest request, boolean prepare) {
        int user = sessions.require(request).account().id();
        limits.consume(
                prepare ? "GROUP_PREPARE" : "GROUP_CHANGE", "" + user, prepare ? 120 : 60, 3600);
        return user;
    }

    @PostMapping("/chat/groups/prepare")
    public ChatDtos.Snapshot prepare(
            @RequestBody ChatDtos.GroupPrepare input, HttpServletRequest request) {
        return groups.prepare(caller(request, true), null, input);
    }

    @PostMapping("/chat/groups")
    public Map<String, Object> create(
            @RequestBody ChatDtos.GroupCreate input, HttpServletRequest request) {
        return groups.create(caller(request, false), input);
    }

    @GetMapping("/chat/rooms/{roomId}/participants")
    public Map<String, Object> participants(
            @PathVariable String roomId, HttpServletRequest request) {
        return groups.participants(sessions.require(request).account().id(), ChatDtos.uuid(roomId));
    }

    @PostMapping("/chat/rooms/{roomId}/participants/prepare")
    public ChatDtos.Snapshot prepareAdd(
            @PathVariable String roomId,
            @RequestBody ChatDtos.GroupPrepare input,
            HttpServletRequest request) {
        return groups.prepare(caller(request, true), ChatDtos.uuid(roomId), input);
    }

    @PostMapping("/chat/rooms/{roomId}/participants")
    public Map<String, Object> add(
            @PathVariable String roomId,
            @RequestBody ChatDtos.GroupChange input,
            HttpServletRequest request) {
        return groups.change(caller(request, false), ChatDtos.uuid(roomId), "add", null, input);
    }

    @DeleteMapping("/chat/rooms/{roomId}/participants/{userId}")
    public Map<String, Object> remove(
            @PathVariable String roomId,
            @PathVariable String userId,
            @RequestBody ChatDtos.GroupChange input,
            HttpServletRequest request) {
        return groups.change(
                caller(request, false), ChatDtos.uuid(roomId), "remove", userId, input);
    }

    @PostMapping("/chat/rooms/{roomId}/leave")
    public Map<String, Object> leave(
            @PathVariable String roomId,
            @RequestBody ChatDtos.GroupChange input,
            HttpServletRequest request) {
        return groups.change(caller(request, false), ChatDtos.uuid(roomId), "leave", null, input);
    }

    @PatchMapping("/chat/rooms/{roomId}")
    public Map<String, Object> rename(
            @PathVariable String roomId,
            @RequestBody ChatDtos.GroupChange input,
            HttpServletRequest request) {
        return groups.change(caller(request, false), ChatDtos.uuid(roomId), "rename", null, input);
    }

    @PutMapping("/chat/rooms/{roomId}/owner")
    public Map<String, Object> owner(
            @PathVariable String roomId,
            @RequestBody ChatDtos.GroupChange input,
            HttpServletRequest request) {
        return groups.change(caller(request, false), ChatDtos.uuid(roomId), "owner", null, input);
    }
}
