package com.backstabber.lobby;

import java.util.UUID;

public record LockedRoom(UUID id, UUID hostId, int capacity, String status) {}
