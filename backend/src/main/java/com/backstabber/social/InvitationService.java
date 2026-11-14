package com.backstabber.social;

import java.util.List;
import java.util.UUID;

import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import com.backstabber.lobby.RoomService;
import com.backstabber.persistence.TransactionLimits;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvitationService {
    public record Created(UUID id) {}
    public record Decision(String status) {}

    private final JdbcTemplate jdbc;
    private final InvitationRepository invitations;
    private final FriendshipRepository friendships;
    private final RoomService rooms;

    public InvitationService(JdbcTemplate jdbc, InvitationRepository invitations, FriendshipRepository friendships,
            RoomService rooms) {
        this.jdbc = jdbc;
        this.invitations = invitations;
        this.friendships = friendships;
        this.rooms = rooms;
    }

    @Transactional(readOnly = true, timeout = 8)
    public List<Invitation> pending(UUID user) {
        TransactionLimits.apply(jdbc);
        return invitations.pendingFor(user);
    }

    @Transactional(timeout = 8)
    public Created send(UUID user, UUID roomId, RequestInput input) {
        TransactionLimits.apply(jdbc);
        var room = rooms.lockMemberRoom(user, roomId);
        // The Node route validates membership before parsing the recipient field.
        UUID target = input.uuid("userId");
        RoomService.requireLobby(room);
        if (!friendships.areFriends(user, target)) {
            throw new ApiFailure(HttpStatus.FORBIDDEN, "FRIEND_REQUIRED");
        }
        var members = rooms.memberIds(room.id());
        if (members.contains(target)) throw new ApiFailure(HttpStatus.CONFLICT, "ALREADY_IN_ROOM");
        if (members.size() >= room.capacity()) throw new ApiFailure(HttpStatus.CONFLICT, "ROOM_FULL");

        invitations.expireStale(room.id(), target);
        return new Created(invitations.insert(room.id(), user, target)
                .orElseThrow(() -> new ApiFailure(HttpStatus.CONFLICT, "INVITE_EXISTS")));
    }

    @Transactional(timeout = 8)
    public Object respond(UUID user, UUID invitation, boolean accept) {
        TransactionLimits.apply(jdbc);
        UUID roomId = invitations.findRecipientRoom(user, invitation).orElseThrow(InvitationService::notFound);
        // Room membership and invite writers serialize on the same room row.
        var room = rooms.lockRoom(roomId);
        String status = accept ? "accepted" : "declined";
        if (!invitations.respond(user, invitation, status)) throw notFound();
        // A failed join rolls the invite update back along with the whole transaction.
        return accept ? rooms.addMember(user, room) : new Decision(status);
    }

    private static ApiFailure notFound() {
        return new ApiFailure(HttpStatus.NOT_FOUND, "INVITE_NOT_FOUND");
    }
}
