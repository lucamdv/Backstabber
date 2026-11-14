package com.backstabber.lobby;

import com.backstabber.api.RequestInput;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/rooms")
public class RoomController {
    private final RoomService rooms;

    public RoomController(RoomService rooms) {
        this.rooms = rooms;
    }

    @GetMapping
    public List<RoomSnapshot> list(@AuthenticationPrincipal UUID userId) {
        return rooms.list(userId);
    }

    @PostMapping
    public RoomSnapshot create(@AuthenticationPrincipal UUID userId,
                               @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput input) {
        return rooms.create(userId, input.node("capacity"));
    }

    @PostMapping("/join")
    public RoomSnapshot join(@AuthenticationPrincipal UUID userId,
                             @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput input) {
        return rooms.join(userId, input.text("code"));
    }

    @GetMapping("/{id}")
    public RoomSnapshot get(@AuthenticationPrincipal UUID userId, @PathVariable String id) {
        return rooms.get(userId, RequestInput.uuidValue(id));
    }

    @PostMapping("/{id}/heartbeat")
    public RoomSnapshot heartbeat(@AuthenticationPrincipal UUID userId, @PathVariable String id) {
        return rooms.heartbeat(userId, RequestInput.uuidValue(id));
    }

    @PostMapping("/{id}/ready")
    public RoomSnapshot ready(@AuthenticationPrincipal UUID userId, @PathVariable String id,
                              @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput input) {
        return rooms.ready(userId, RequestInput.uuidValue(id), input);
    }

    @PostMapping("/{id}/leave")
    public Map<String, Boolean> leave(@AuthenticationPrincipal UUID userId, @PathVariable String id) {
        return rooms.leave(userId, RequestInput.uuidValue(id));
    }

    @PostMapping("/{id}/close")
    public RoomSnapshot close(@AuthenticationPrincipal UUID userId, @PathVariable String id) {
        return rooms.close(userId, RequestInput.uuidValue(id));
    }
}
