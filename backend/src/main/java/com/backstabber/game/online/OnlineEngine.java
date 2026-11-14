package com.backstabber.game.online;

import com.backstabber.game.model.GameModel.CastVote;
import com.backstabber.game.model.GameModel.CoreCommand;
import com.backstabber.game.model.GameModel.CoreResult;
import com.backstabber.game.model.GameModel.GameState;
import com.backstabber.game.model.GameModel.LoseInfluence;
import com.backstabber.game.model.GameModel.Negotiate;
import com.backstabber.game.model.GameModel.OnlineCommand;
import com.backstabber.game.model.GameModel.OnlineResult;
import com.backstabber.game.model.GameModel.OnlineState;
import com.backstabber.game.model.GameModel.OnlineView;
import com.backstabber.game.model.GameModel.Participant;
import com.backstabber.game.model.GameModel.SelectAction;
import com.backstabber.game.model.GameModel.TargetPhase;
import com.backstabber.game.model.GameModel.Vote;
import com.backstabber.game.model.GameModel.VoteChoice;
import com.backstabber.game.model.GameModel.WindowState;
import com.backstabber.game.projection.OnlineProjector;
import com.backstabber.game.random.GameRandom;
import com.backstabber.game.rules.CoreEngine;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Pure online orchestration around the core actions shared by the two game modes. */
public final class OnlineEngine {
    private OnlineEngine() {}

    public static OnlineState create(List<Participant> participants, GameRandom random) {
        if (participants.size() < 2 || participants.stream().map(Participant::id).distinct().count() != participants.size()) {
            throw new IllegalArgumentException("Invalid roster");
        }
        return new OnlineState(CoreEngine.create(participants, random), 1, null, List.of());
    }

    public static OnlineResult transition(OnlineState state, String playerId, OnlineCommand command,
                                          long expectedRevision, GameRandom random) {
        if (expectedRevision != state.game().revision()) return OnlineResult.failure("STALE_REVISION");
        if (state.game().players().stream().noneMatch(player -> player.id().equals(playerId) && !player.cards().isEmpty())) {
            return OnlineResult.failure("NOT_AUTHORIZED");
        }

        OnlineResult applied = command instanceof CastVote vote
                ? castVote(state, playerId, vote, random)
                : applyCommand(state, playerId, command, random);
        if (!applied.ok()) return applied;

        OnlineState next = applied.state();
        // The online envelope costs one revision even when it runs multiple core commands.
        return OnlineResult.success(new OnlineState(next.game().withRevision(expectedRevision + 1),
                next.round(), next.window(), next.audit()));
    }

    public static List<VoteChoice> choicesFor(OnlineState state, String playerId) {
        return VoteWindows.choicesFor(state, playerId);
    }

    public static OnlineView project(OnlineState state, String viewerId, String hostId,
                                     boolean closed, boolean hostAbandoned) {
        return OnlineProjector.project(state, viewerId, hostId, closed, hostAbandoned);
    }

    private static OnlineResult applyCommand(OnlineState state, String playerId, OnlineCommand command, GameRandom random) {
        if (state.window() != null) return OnlineResult.failure("INVALID_PHASE");
        if (command == null) return OnlineResult.failure("INVALID_COMMAND");
        CoreCommand core = switch (command) {
            case SelectAction action -> new CoreCommand("select-action", playerId, action.action(), null, null, null, null);
            case LoseInfluence loss -> new CoreCommand("lose", playerId, null, null, null, loss.cardId(), null);
            case Negotiate negotiation -> new CoreCommand("negotiate", playerId, null, null, null, null, negotiation.keepIds());
            case CastVote ignored -> throw new IllegalArgumentException("Vote belongs to a window");
        };
        GameState before = state.game();
        CoreResult result = CoreEngine.transition(before, core, before.revision(), random);
        if (!result.ok()) return OnlineResult.failure(result.error());

        if (command instanceof SelectAction action) {
            String targetId = action.targetId();
            if (result.state().phase() instanceof TargetPhase) {
                if (targetId == null || targetId.isEmpty()) return OnlineResult.failure("INVALID_COMMAND");
                core = new CoreCommand("select-target", playerId, null, targetId, null, null, null);
                GameState selecting = result.state();
                result = CoreEngine.transition(selecting, core, selecting.revision(), random);
                if (!result.ok()) return OnlineResult.failure(result.error());
            } else if (targetId != null) {
                return OnlineResult.failure("INVALID_COMMAND");
            }
        }

        OnlineState next = new OnlineState(result.state(), state.round(), null, state.audit());
        return OnlineResult.success(VoteWindows.afterCore(next, core.type(), before.activeId()));
    }

    private static OnlineResult castVote(OnlineState state, String playerId, CastVote command, GameRandom random) {
        WindowState window = state.window();
        if (window == null || !window.id().equals(command.windowId())) return OnlineResult.failure("INVALID_PHASE");
        if (window.votes().stream().anyMatch(vote -> vote.playerId().equals(playerId))) {
            return OnlineResult.failure("ALREADY_RESPONDED");
        }

        VoteChoice requested = command.choice();
        var choice = choicesFor(state, playerId).stream()
                .filter(option -> requested != null && option.kind().equals(requested.kind())
                        && (!"block".equals(option.kind()) || Objects.equals(option.character(), requested.character())))
                .findFirst();
        if (choice.isEmpty()) return OnlineResult.failure("NOT_AUTHORIZED");

        var votes = new ArrayList<>(window.votes());
        votes.add(new Vote(playerId, choice.get(), votes.size() + 1));
        var updated = new WindowState(window.id(), window.kind(), window.eligible(), votes, window.summary(),
                window.priority(), window.nextActiveId());
        var next = new OnlineState(state.game(), state.round(), updated, state.audit());
        return OnlineResult.success(votes.size() == window.eligible().size()
                ? VoteWindows.close(next, random)
                : next);
    }
}
