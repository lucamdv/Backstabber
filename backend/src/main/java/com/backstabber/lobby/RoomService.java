package com.backstabber.lobby;

import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import com.backstabber.persistence.TransactionLimits;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
@Transactional(timeout = 8)
public class RoomService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final HexFormat UPPER_HEX = HexFormat.of().withUpperCase();
    private static final Pattern ROOM_CODE = Pattern.compile("[0-9A-F]{10}");
    private final JdbcTemplate jdbc;
    private final RoomRepository rooms;

    RoomService(JdbcTemplate jdbc, RoomRepository rooms) {
        this.jdbc = jdbc;
        this.rooms = rooms;
    }

    @Transactional(readOnly = true, timeout = 8)
    public List<RoomSnapshot> list(UUID userId) {
        limits();
        return rooms.snapshots(userId, null);
    }

    @Transactional(readOnly = true, timeout = 8)
    public RoomSnapshot get(UUID userId, UUID roomId) {
        limits();
        return read(userId, roomId);
    }

    public RoomSnapshot create(UUID userId, JsonNode capacity) {
        if (capacity == null || !capacity.isNumber() || !capacity.canConvertToExactIntegral()
                || !capacity.canConvertToInt() || capacity.intValue() < 2 || capacity.intValue() > 10) {
            throw new ApiFailure(HttpStatus.BAD_REQUEST, "INVALID_CAPACITY");
        }
        limits();
        requireProfile(userId);
        for (int attempt = 0; attempt < 3; attempt++) {
            byte[] bytes = new byte[5];
            RANDOM.nextBytes(bytes);
            var id = rooms.insert(UPPER_HEX.formatHex(bytes), userId, capacity.intValue());
            if (id.isPresent()) {
                rooms.addMember(userId, id.get());
                return read(userId, id.get());
            }
        }
        throw new ApiFailure(HttpStatus.SERVICE_UNAVAILABLE, "ROOM_CODE_UNAVAILABLE");
    }

    public RoomSnapshot join(UUID userId, String rawCode) {
        String code = RequestInput.trim(rawCode == null ? "" : rawCode).toUpperCase(Locale.ROOT);
        if (!ROOM_CODE.matcher(code).matches()) throw new ApiFailure(HttpStatus.BAD_REQUEST, "INVALID_ROOM_CODE");
        limits();
        return addMember(userId, rooms.lockByCode(code).orElseThrow(RoomService::notFound));
    }

    public RoomSnapshot heartbeat(UUID userId, UUID roomId) {
        limits();
        LockedRoom room = lockMemberRoom(userId, roomId);
        if (!"closed".equals(room.status())) rooms.heartbeat(userId, roomId);
        return read(userId, roomId);
    }

    public RoomSnapshot ready(UUID userId, UUID roomId, RequestInput input) {
        limits();
        requireLobby(lockMemberRoom(userId, roomId));
        rooms.ready(userId, roomId, input.requiredBoolean("ready"));
        return read(userId, roomId);
    }

    public Map<String, Boolean> leave(UUID userId, UUID roomId) {
        limits();
        LockedRoom room = lockMemberRoom(userId, roomId);
        requireLobby(room);
        rooms.deleteMember(userId, roomId);
        rooms.resetReadiness(roomId);
        if (userId.equals(room.hostId())) {
            UUID newHost = rooms.memberIds(roomId).stream().findFirst().orElse(null);
            rooms.transferHost(roomId, newHost);
            if (newHost == null) {
                rooms.expireInvites(roomId, null);
                return Map.of("ok", true);
            }
        }
        rooms.expireInvites(roomId, userId);
        return Map.of("ok", true);
    }

    public RoomSnapshot close(UUID userId, UUID roomId) {
        limits();
        LockedRoom room = lockMemberRoom(userId, roomId);
        if (!userId.equals(room.hostId())
                && !("started".equals(room.status()) && !rooms.hostPresent(room))) throw hostRequired();
        rooms.close(roomId);
        rooms.expireInvites(roomId, null);
        return read(userId, roomId);
    }

    /** Locks and validates the room in the transaction that creates the match. */
    @Transactional(propagation = Propagation.MANDATORY)
    public RoomSnapshot validateStart(UUID userId, UUID roomId) {
        limits();
        LockedRoom room = lockMemberRoom(userId, roomId);
        if (!userId.equals(room.hostId())) throw hostRequired();
        RoomSnapshot snapshot = read(userId, roomId);
        if ("started".equals(room.status())) return snapshot;
        requireLobby(room);
        if (!snapshot.canStart()) throw new ApiFailure(HttpStatus.CONFLICT, "ROOM_NOT_READY");
        return snapshot;
    }

    /** Completes a start after validateStart acquired the room lock and the match was inserted. */
    @Transactional(propagation = Propagation.MANDATORY)
    public RoomSnapshot completeStart(UUID userId, UUID roomId) {
        rooms.markStarted(roomId);
        rooms.expireInvites(roomId, null);
        return read(userId, roomId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public LockedRoom lockRoom(UUID roomId) {
        return rooms.lockById(roomId).orElseThrow(RoomService::notFound);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public LockedRoom lockMemberRoom(UUID userId, UUID roomId) {
        requireMember(userId, roomId);
        LockedRoom room = lockRoom(roomId);
        requireMember(userId, roomId);
        return room;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public List<UUID> memberIds(UUID roomId) {
        return rooms.memberIds(roomId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public RoomSnapshot addMember(UUID userId, LockedRoom room) {
        requireLobby(room);
        List<UUID> members = memberIds(room.id());
        if (members.contains(userId)) return read(userId, room.id());
        if (members.size() >= room.capacity()) throw new ApiFailure(HttpStatus.CONFLICT, "ROOM_FULL");
        requireProfile(userId);
        rooms.addMember(userId, room.id());
        rooms.resetReadiness(room.id());
        return read(userId, room.id());
    }

    public static void requireLobby(LockedRoom room) {
        RoomPolicy.requireLobby(room);
    }

    private void limits() {
        TransactionLimits.apply(jdbc);
    }

    private RoomSnapshot read(UUID userId, UUID roomId) {
        return rooms.snapshots(userId, roomId).stream().findFirst().orElseThrow(RoomService::notFound);
    }

    private void requireProfile(UUID userId) {
        if (!rooms.hasProfile(userId)) throw new ApiFailure(HttpStatus.CONFLICT, "PROFILE_REQUIRED");
    }

    private void requireMember(UUID userId, UUID roomId) {
        if (!rooms.isMember(userId, roomId)) throw notFound();
    }

    private static ApiFailure notFound() {
        return new ApiFailure(HttpStatus.NOT_FOUND, "ROOM_NOT_FOUND");
    }

    private static ApiFailure hostRequired() {
        return new ApiFailure(HttpStatus.FORBIDDEN, "HOST_REQUIRED");
    }
}
