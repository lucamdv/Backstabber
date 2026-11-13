package com.backstabber.social;

import java.util.UUID;

public record Profile(UUID id, String username, String displayName, String avatarUrl, boolean showOnline) {}
