package com.backstabber.game.online;

import com.backstabber.game.model.GameModel.ActionPhase;
import com.backstabber.game.model.GameModel.BlockReactionPhase;
import com.backstabber.game.model.GameModel.CoreCommand;
import com.backstabber.game.model.GameModel.CoreResult;
import com.backstabber.game.model.GameModel.LossPhase;
import com.backstabber.game.model.GameModel.OnlineState;
import com.backstabber.game.model.GameModel.Player;
import com.backstabber.game.model.GameModel.ReactionPhase;
import com.backstabber.game.model.GameModel.Vote;
import com.backstabber.game.model.GameModel.VoteChoice;
import com.backstabber.game.model.GameModel.WindowState;
import com.backstabber.game.random.GameRandom;
import com.backstabber.game.rules.CoreEngine;
import java.util.ArrayList;
import java.util.List;

final class VoteWindows {
    private static final String ACKNOWLEDGE = "acknowledge";

    private VoteWindows() {}

    static List<VoteChoice> choicesFor(OnlineState state, String playerId) {
        WindowState window = state.window();
        if (window == null || !window.eligible().contains(playerId)
                || window.votes().stream().anyMatch(vote -> vote.playerId().equals(playerId))) {
            return List.of();
        }
        if (ACKNOWLEDGE.equals(window.kind())) return List.of(new VoteChoice(ACKNOWLEDGE, null));

        var available = CoreEngine.available(state.game());
        var choices = new ArrayList<VoteChoice>();
        choices.add(new VoteChoice("accept", null));
        if (available.challenges().contains(playerId)) choices.add(new VoteChoice("challenge", null));
        for (var block : available.blocks()) {
            if (block.playerId().equals(playerId)) choices.add(new VoteChoice("block", block.character()));
        }
        return List.copyOf(choices);
    }

    static OnlineState afterCore(OnlineState state, String commandType, String previousActiveId) {
        var game = state.game();
        var phase = game.phase();

        if (phase instanceof ReactionPhase) return open(state, "reaction", "Reaja à declaração");
        if (phase instanceof BlockReactionPhase) return open(state, "block-reaction", "Reaja ao bloqueio");
        if (phase instanceof LossPhase loss) {
            if (loss.challenge() != null) {
                String summary = loss.challenge().truthful()
                        ? "Carta comprovada. O contestador perde influência."
                        : "Blefe descoberto. O declarante perde influência.";
                return open(state, ACKNOWLEDGE, summary);
            }
            if (game.lastEvent() != null && "backstab".equals(game.lastEvent().kind())) {
                return open(state, ACKNOWLEDGE, "Backstab declarado. A vítima perderá uma influência.");
            }
        }
        if ("lose".equals(commandType) || "negotiate".equals(commandType) || phase instanceof ActionPhase) {
            var history = game.history();
            String summary = history.isEmpty() ? "Resultado da jogada"
                    : history.getFirst().player() + " · " + history.getFirst().text();
            OnlineState opened = open(state, ACKNOWLEDGE, summary);
            if (opened.window() != null && !game.activeId().equals(previousActiveId)) {
                var window = opened.window();
                var deferred = new WindowState(window.id(), window.kind(), window.eligible(), window.votes(),
                        window.summary(), window.priority(), game.activeId());
                return new OnlineState(game.withActiveId(previousActiveId), opened.round(), deferred, opened.audit());
            }
            return opened;
        }
        return state;
    }

    static OnlineState close(OnlineState state, GameRandom random) {
        WindowState window = state.window();
        Vote priority = firstVote(window, "challenge");
        if (priority == null) priority = firstVote(window, "block");
        var closed = new WindowState(window.id(), window.kind(), window.eligible(), window.votes(),
                window.summary(), priority, window.nextActiveId());
        var audit = new ArrayList<>(state.audit());
        audit.add(closed);

        var game = state.game();
        if (ACKNOWLEDGE.equals(window.kind())) {
            if (window.nextActiveId() != null && !window.nextActiveId().isEmpty()) {
                game = game.withActiveId(window.nextActiveId());
            }
            return new OnlineState(game, state.round(), null, audit);
        }

        CoreCommand command = resolution(game.activeId(), priority);
        CoreResult result = CoreEngine.transition(game, command, game.revision(), random);
        if (!result.ok()) throw new IllegalStateException("Window resolution invariant: " + result.error());
        return afterCore(new OnlineState(result.state(), state.round(), null, audit), command.type(), game.activeId());
    }

    private static OnlineState open(OnlineState state, String kind, String summary) {
        var game = state.game();
        String actor = game.phase() instanceof BlockReactionPhase blocked ? blocked.block().playerId() : game.activeId();
        List<String> eligible = game.players().stream()
                .filter(player -> !player.cards().isEmpty() && (ACKNOWLEDGE.equals(kind) || !player.id().equals(actor)))
                .map(Player::id).toList();
        if (eligible.isEmpty()) return state;
        var window = new WindowState(state.round() + ":" + (state.audit().size() + 1),
                kind, eligible, List.of(), summary, null, null);
        return new OnlineState(game, state.round(), window, state.audit());
    }

    private static Vote firstVote(WindowState window, String kind) {
        return window.votes().stream().filter(vote -> vote.choice().kind().equals(kind)).findFirst().orElse(null);
    }

    private static CoreCommand resolution(String playerId, Vote priority) {
        if (priority == null) return new CoreCommand("accept", playerId, null, null, null, null, null);
        if ("block".equals(priority.choice().kind())) {
            return new CoreCommand("block", priority.playerId(), null, null, priority.choice().character(), null, null);
        }
        return new CoreCommand("challenge", priority.playerId(), null, null, null, null, null);
    }
}
