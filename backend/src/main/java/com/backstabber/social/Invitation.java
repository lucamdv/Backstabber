package com.backstabber.social;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.UUID;

public record Invitation(UUID id, UUID roomId, Profile from, String status, String expiresAt) {
    private static final DateTimeFormatter NODE_DATE = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();

    static Invitation fromDatabase(UUID id, UUID roomId, Profile sender, String status, Instant expiresAt) {
        // PostgreSQL timestamps have microseconds, whereas Node's Date JSON emits milliseconds.
        return new Invitation(id, roomId, sender, status, NODE_DATE.format(expiresAt));
    }
}
