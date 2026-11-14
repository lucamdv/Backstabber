package com.backstabber.game.application;

import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import com.backstabber.game.model.GameModel.Action;
import com.backstabber.game.model.GameModel.CastVote;
import com.backstabber.game.model.GameModel.Character;
import com.backstabber.game.model.GameModel.LoseInfluence;
import com.backstabber.game.model.GameModel.Negotiate;
import com.backstabber.game.model.GameModel.OnlineCommand;
import com.backstabber.game.model.GameModel.SelectAction;
import com.backstabber.game.model.GameModel.VoteChoice;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;

final class MatchCommandParser {
    private static final long MAX_SAFE_REVISION = 9_007_199_254_740_991L;

    private MatchCommandParser() {}

    record Envelope(String commandId, long expectedRevision, OnlineCommand command) {}

    static Envelope parse(RequestInput input) {
        var protocolVersion = input.node("protocolVersion");
        if (!protocolVersion.isNumber() || protocolVersion.doubleValue() != 1) {
            throw ApiFailure.badRequest("UNSUPPORTED_PROTOCOL");
        }
        String commandId = shortId(input.node("commandId"));
        var revision = input.node("expectedRevision");
        double value = revision.isNumber() ? revision.doubleValue() : Double.NaN;
        if (!Double.isFinite(value) || value < 0 || value > MAX_SAFE_REVISION || value != Math.rint(value)) {
            throw invalid();
        }
        return new Envelope(commandId, (long) value, command(input.node("command")));
    }

    private static OnlineCommand command(JsonNode command) {
        if (!command.isObject() || command.has("playerId")) throw invalid();
        return switch (text(command.path("type"))) {
            case "select-action" -> new SelectAction(enumValue(Action.class, command.path("action")),
                    command.has("targetId") ? shortId(command.path("targetId")) : null);
            case "lose" -> new LoseInfluence(shortId(command.path("cardId")));
            case "negotiate" -> {
                var keepIds = command.path("keepIds");
                if (!keepIds.isArray() || keepIds.size() > 2) throw invalid();
                var ids = new ArrayList<String>(keepIds.size());
                for (var id : keepIds) ids.add(shortId(id));
                yield new Negotiate(ids);
            }
            case "vote" -> new CastVote(shortId(command.path("windowId")), choice(command.path("choice")));
            default -> throw invalid();
        };
    }

    private static VoteChoice choice(JsonNode choice) {
        if (!choice.isObject()) throw invalid();
        String kind = text(choice.path("kind"));
        return switch (kind) {
            case "accept", "challenge", "acknowledge" -> new VoteChoice(kind, null);
            case "block" -> new VoteChoice(kind, enumValue(Character.class, choice.path("character")));
            default -> throw invalid();
        };
    }

    private static <E extends Enum<E>> E enumValue(Class<E> type, JsonNode value) {
        try {
            return Enum.valueOf(type, text(value));
        } catch (IllegalArgumentException badValue) {
            throw invalid();
        }
    }

    private static String text(JsonNode value) {
        return value.isTextual() ? value.asString() : "";
    }

    private static String shortId(JsonNode value) {
        String id = text(value);
        if (id.isEmpty() || id.length() > 80) throw invalid();
        return id;
    }

    private static ApiFailure invalid() {
        return ApiFailure.badRequest("INVALID_COMMAND");
    }
}
