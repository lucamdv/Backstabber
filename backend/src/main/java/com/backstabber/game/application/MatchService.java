package com.backstabber.game.application;

import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import com.backstabber.game.model.GameModel.FinishedPhase;
import com.backstabber.game.model.GameModel.OnlineState;
import com.backstabber.game.model.GameModel.OnlineView;
import com.backstabber.game.model.GameModel.Participant;
import com.backstabber.game.model.GameStateJson;
import com.backstabber.game.online.OnlineEngine;
import com.backstabber.game.random.GameRandom;
import com.backstabber.lobby.RoomService;
import com.backstabber.lobby.RoomSnapshot;
import com.backstabber.persistence.TransactionLimits;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

@Service
@Transactional
public class MatchService {
    private final GameStateJson states = new GameStateJson();
    private final GameRandom random;
    private final JdbcTemplate jdbc;
    private final MatchRepository matches;
    private final RoomService rooms;
    private final ObjectMapper json;

    MatchService(JdbcTemplate jdbc, MatchRepository matches, RoomService rooms, ObjectMapper json, GameRandom random) {
        this.jdbc = jdbc;
        this.matches = matches;
        this.rooms = rooms;
        this.json = json;
        this.random = random;
    }

    public RoomSnapshot start(UUID userId, UUID roomId) {
        var room = rooms.validateStart(userId, roomId);
        if ("started".equals(room.status())) return room;

        var roster = room.members().stream().map(member -> new Participant(member.id().toString(), member.username()))
                .toList();
        matches.insert(roomId, states.write(OnlineEngine.create(roster, random)));
        return rooms.completeStart(userId, roomId);
    }

    @Transactional(readOnly = true)
    public OnlineView get(UUID userId, UUID matchId) {
        TransactionLimits.apply(jdbc);
        var match = matches.findForMember(matchId, userId, false).orElseThrow(MatchService::notFound);
        String hostId = match.hostId() == null ? "" : match.hostId().toString();
        return OnlineEngine.project(states.read(match.state()), userId.toString(), hostId,
                "closed".equals(match.status()) || match.hostId() == null, match.hostAbandoned());
    }

    public JsonNode command(UUID userId, UUID matchId, RequestInput input) {
        var match = lockMatch(userId, matchId);
        var message = MatchCommandParser.parse(input);
        String fingerprint = MatchCommandFingerprint.of(message);
        var previous = matches.priorCommand(matchId, userId, message.commandId());
        if (previous.isPresent()) {
            if (!previous.get().fingerprint().equals(fingerprint)) throw ApiFailure.badRequest("INVALID_COMMAND");
            return json.readTree(previous.get().result());
        }

        if (!"started".equals(match.status()) || match.hostId() == null) throw invalidPhase();
        var next = OnlineEngine.transition(states.read(match.state()), userId.toString(), message.command(),
                message.expectedRevision(), random);
        if (!next.ok()) {
            throw new ApiFailure("NOT_AUTHORIZED".equals(next.error()) ? HttpStatus.FORBIDDEN : HttpStatus.CONFLICT,
                    next.error());
        }

        var result = json.createObjectNode().put("ok", true).put("revision", next.state().game().revision());
        matches.update(matchId, states.write(next.state()));
        matches.record(matchId, userId, message.commandId(), fingerprint, result.toString());
        return result;
    }

    public OnlineView rematch(UUID userId, UUID matchId) {
        var match = lockMatch(userId, matchId);
        if (!userId.equals(match.hostId())) throw new ApiFailure(HttpStatus.FORBIDDEN, "NOT_AUTHORIZED");
        var state = states.read(match.state());
        if (!"started".equals(match.status()) || state.window() != null || !(state.game().phase() instanceof FinishedPhase)) {
            throw invalidPhase();
        }

        var roster = state.game().players().stream().map(player -> new Participant(player.id(), player.name())).toList();
        var fresh = OnlineEngine.create(roster, random);
        var next = new OnlineState(fresh.game().withRevision(state.game().revision() + 1),
                state.round() + 1, null, state.audit());
        matches.update(matchId, states.write(next));
        return OnlineEngine.project(next, userId.toString(), userId.toString(), false, false);
    }

    private MatchRepository.MatchRow lockMatch(UUID userId, UUID matchId) {
        TransactionLimits.apply(jdbc);
        if (!matches.lockMemberRoom(matchId, userId)) throw notFound();
        // Read membership and status again after acquiring the room lock, before touching the match row.
        return matches.findForMember(matchId, userId, true).orElseThrow(MatchService::notFound);
    }

    static ApiFailure notFound() {
        return new ApiFailure(HttpStatus.NOT_FOUND, "NOT_FOUND");
    }

    private static ApiFailure invalidPhase() {
        return new ApiFailure(HttpStatus.CONFLICT, "INVALID_PHASE");
    }
}
