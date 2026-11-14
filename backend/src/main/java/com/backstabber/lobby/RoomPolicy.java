package com.backstabber.lobby;

import com.backstabber.api.ApiFailure;
import org.springframework.http.HttpStatus;

import java.util.List;

public final class RoomPolicy {
    public static final int HOST_ABANDONMENT_SECONDS = 300;
    // Alias r must refer to public.bs_rooms.
    public static final String EFFECTIVE_STATUS_SQL = """
            case when r.host_id is null or (r.status = 'lobby' and r.expires_at <= now())
              then 'closed' else r.status end
            """;

    private RoomPolicy() {}

    static boolean canStart(String status, List<RoomSnapshot.Member> members) {
        return "lobby".equals(status) && members.size() >= 2
                && members.stream().allMatch(member -> member.ready() && member.connected());
    }

    static void requireLobby(LockedRoom room) {
        if (!"lobby".equals(room.status())) throw new ApiFailure(HttpStatus.CONFLICT, "ROOM_NOT_OPEN");
    }
}
