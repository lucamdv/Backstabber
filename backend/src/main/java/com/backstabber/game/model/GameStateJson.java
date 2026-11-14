package com.backstabber.game.model;

import tools.jackson.databind.json.JsonMapper;

import com.backstabber.game.model.GameModel.OnlineState;

/** Codec for the existing Node.js JSONB value, before any database integration. */
public final class GameStateJson {
    private final JsonMapper json = JsonMapper.builder().build();

    public String write(OnlineState state) {
        return json.writeValueAsString(state);
    }

    public OnlineState read(String serialized) {
        return json.readValue(serialized, OnlineState.class);
    }
}
