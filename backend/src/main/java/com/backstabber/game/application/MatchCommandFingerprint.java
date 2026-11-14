package com.backstabber.game.application;

import com.backstabber.game.application.MatchCommandParser.Envelope;
import com.backstabber.game.model.GameModel.CastVote;
import com.backstabber.game.model.GameModel.LoseInfluence;
import com.backstabber.game.model.GameModel.Negotiate;
import com.backstabber.game.model.GameModel.SelectAction;

import java.util.HexFormat;
import java.util.stream.Collectors;

/** The canonical text stored by JSON.stringify on the normalized Node envelope. */
final class MatchCommandFingerprint {
    private static final HexFormat HEX = HexFormat.of();

    private MatchCommandFingerprint() {}

    static String of(Envelope message) {
        String command = switch (message.command()) {
            case SelectAction action -> "{\"type\":\"select-action\",\"action\":" + quote(action.action().name())
                    + (action.targetId() == null ? "" : ",\"targetId\":" + quote(action.targetId())) + "}";
            case LoseInfluence loss -> "{\"type\":\"lose\",\"cardId\":" + quote(loss.cardId()) + "}";
            case Negotiate negotiation -> negotiation.keepIds().stream().map(MatchCommandFingerprint::quote)
                    .collect(Collectors.joining(",", "{\"type\":\"negotiate\",\"keepIds\":[", "]}"));
            case CastVote vote -> "{\"type\":\"vote\",\"windowId\":" + quote(vote.windowId())
                    + ",\"choice\":{\"kind\":" + quote(vote.choice().kind())
                    + (vote.choice().character() == null ? "" : ",\"character\":" + quote(vote.choice().character().name()))
                    + "}}";
        };
        return "{\"protocolVersion\":1,\"commandId\":" + quote(message.commandId())
                + ",\"expectedRevision\":" + message.expectedRevision() + ",\"command\":" + command + "}";
    }

    private static String quote(String value) {
        var json = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index++) {
            char unit = value.charAt(index);
            switch (unit) {
                case '"' -> json.append("\\\"");
                case '\\' -> json.append("\\\\");
                case '\b' -> json.append("\\b");
                case '\f' -> json.append("\\f");
                case '\n' -> json.append("\\n");
                case '\r' -> json.append("\\r");
                case '\t' -> json.append("\\t");
                default -> {
                    if (java.lang.Character.isHighSurrogate(unit) && index + 1 < value.length()
                            && java.lang.Character.isLowSurrogate(value.charAt(index + 1))) {
                        json.append(unit).append(value.charAt(++index));
                    } else if (unit < ' ' || java.lang.Character.isSurrogate(unit)) {
                        json.append("\\u").append(HEX.toHexDigits(unit));
                    } else {
                        json.append(unit);
                    }
                }
            }
        }
        return json.append('"').toString();
    }
}
