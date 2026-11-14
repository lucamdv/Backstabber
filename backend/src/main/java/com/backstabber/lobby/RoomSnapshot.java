package com.backstabber.lobby;

import java.util.List;
import java.util.UUID;

public record RoomSnapshot(UUID id, String code, UUID hostId, int capacity, String status,
                           UUID matchId, boolean canStart, List<Member> members) {
    public record Member(UUID id, String username, String displayName, String avatarUrl,
                         boolean showOnline, boolean ready, boolean connected) {}
}
