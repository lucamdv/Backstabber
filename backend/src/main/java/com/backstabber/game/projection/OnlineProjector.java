package com.backstabber.game.projection;

import com.backstabber.game.model.GameModel.Card;
import com.backstabber.game.model.GameModel.FinishedPhase;
import com.backstabber.game.model.GameModel.LossPhase;
import com.backstabber.game.model.GameModel.NegotiationPhase;
import com.backstabber.game.model.GameModel.OnlineState;
import com.backstabber.game.model.GameModel.OnlineView;
import com.backstabber.game.model.GameModel.Player;
import com.backstabber.game.model.GameModel.PublicPlayer;
import com.backstabber.game.model.GameModel.Vote;
import com.backstabber.game.model.GameModel.WindowView;
import com.backstabber.game.online.OnlineEngine;
import com.backstabber.game.rules.CoreEngine;
import java.util.ArrayList;
import java.util.List;

/** Produces only the fields of the authenticated viewer's online snapshot. */
public final class OnlineProjector {
    private OnlineProjector() {}

    public static OnlineView project(OnlineState state, String viewerId, String hostId,
                                     boolean closed, boolean hostAbandoned) {
        var game = state.game();
        var window = state.window();
        var viewer = game.players().stream().filter(player -> player.id().equals(viewerId)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Viewer is not a participant"));

        var phase = game.phase();
        if (phase instanceof FinishedPhase finished && !finished.winnerId().equals(viewerId)) {
            phase = new FinishedPhase(finished.winnerId(), List.of());
        }
        boolean host = viewerId.equals(hostId);
        boolean mayChoose = !closed && window == null;
        boolean active = mayChoose && game.activeId().equals(viewerId);
        List<Card> hand = viewer.cards();
        List<Card> choices = List.of();
        if (mayChoose) {
            if (phase instanceof LossPhase loss && loss.victimId().equals(viewerId)) {
                choices = hand;
            } else if (phase instanceof NegotiationPhase broker && broker.playerId().equals(viewerId)) {
                var offer = new ArrayList<>(hand);
                offer.addAll(game.offer());
                choices = List.copyOf(offer);
            }
        }
        var players = game.players().stream()
                .map(player -> new PublicPlayer(player.id(), player.name(), player.credits(), player.cards().size()))
                .toList();
        var visibleWindow = window == null ? null : new WindowView(window.id(), window.kind(), window.eligible(),
                window.summary(), window.votes().stream().map(Vote::playerId).toList(),
                closed ? List.of() : OnlineEngine.choicesFor(state, viewerId));
        return new OnlineView(game.revision(), state.round(), game.activeId(), viewerId, closed,
                !closed && (host || hostAbandoned), mayChoose && host && phase instanceof FinishedPhase,
                phase, game.history(), game.cemetery(), game.deck().size(), game.lastEvent(),
                players, hand, true, viewerId, choices,
                active ? CoreEngine.available(game).availableActions() : List.of(),
                active ? game.players().stream()
                        .filter(player -> !player.id().equals(viewerId) && !player.cards().isEmpty())
                        .map(Player::id).toList() : List.of(),
                List.of(), List.of(), visibleWindow);
    }
}
