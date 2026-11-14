package com.backstabber.game.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

import java.util.List;

import static com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL;

public final class GameModel {
    private GameModel() {}

    public enum Character { magnata, executor, sentinela, mercenario, broker }
    public enum Action { income, patrocinio, tax, steal, assassinate, backstab, negotiate }

    public record Participant(String id, String name) {}
    public record Card(String id, Character character) {}
    public record Player(String id, String name, int credits, List<Card> cards) {
        public Player { cards = List.copyOf(cards); }
    }
    public record Declaration(Action action, String playerId, String targetId) {}
    public record Block(String playerId, Character character) {}
    public record HistoryEntry(String player, String text) {}
    public record Challenge(boolean truthful, String challengerId, String declarerId, Character character,
                            Declaration declaration, @JsonInclude(NON_NULL) Block block) {}
    public record GameEvent(String kind, String playerId, @JsonInclude(NON_NULL) String targetId) {}

    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "kind")
    @JsonSubTypes({
            @JsonSubTypes.Type(value = ActionPhase.class, name = "action"),
            @JsonSubTypes.Type(value = TargetPhase.class, name = "target"),
            @JsonSubTypes.Type(value = ReactionPhase.class, name = "reaction"),
            @JsonSubTypes.Type(value = BlockReactionPhase.class, name = "block-reaction"),
            @JsonSubTypes.Type(value = LossPhase.class, name = "loss"),
            @JsonSubTypes.Type(value = NegotiationPhase.class, name = "negotiation"),
            @JsonSubTypes.Type(value = FinishedPhase.class, name = "finished")
    })
    public sealed interface Phase permits ActionPhase, TargetPhase, ReactionPhase, BlockReactionPhase,
            LossPhase, NegotiationPhase, FinishedPhase {}

    public record ActionPhase() implements Phase {}
    public record TargetPhase(Action action) implements Phase {}
    public record ReactionPhase(Declaration declaration) implements Phase {}
    public record BlockReactionPhase(Declaration declaration, Block block) implements Phase {}
    public record LossPhase(String victimId, String reason, @JsonInclude(NON_NULL) Challenge challenge) implements Phase {}
    public record NegotiationPhase(String playerId, int keep) implements Phase {}
    public record FinishedPhase(String winnerId, List<Card> cards) implements Phase {
        public FinishedPhase { cards = List.copyOf(cards); }
    }

    public record GameState(long revision, String activeId, List<Player> players, List<Card> deck,
                            Phase phase, Declaration continuation, List<Card> offer, List<HistoryEntry> history,
                            List<Character> cemetery, @JsonInclude(NON_NULL) GameEvent lastEvent) {
        public GameState {
            players = List.copyOf(players);
            deck = List.copyOf(deck);
            offer = List.copyOf(offer);
            history = List.copyOf(history);
            cemetery = List.copyOf(cemetery);
        }

        public GameState withRevision(long next) {
            return new GameState(next, activeId, players, deck, phase, continuation, offer, history, cemetery, lastEvent);
        }

        public GameState withActiveId(String next) {
            return new GameState(revision, next, players, deck, phase, continuation, offer, history, cemetery, lastEvent);
        }
    }

    public record AvailableCommands(List<Action> availableActions, List<String> targets,
                                    List<String> challenges, List<Block> blocks) {
        public AvailableCommands {
            availableActions = List.copyOf(availableActions);
            targets = List.copyOf(targets);
            challenges = List.copyOf(challenges);
            blocks = List.copyOf(blocks);
        }
    }

    public record CoreCommand(String type, String playerId, Action action, String targetId, Character character,
                              String cardId, List<String> keepIds) {}

    @JsonInclude(NON_NULL)
    public record CoreResult(boolean ok, GameState state, String error) {
        public static CoreResult success(GameState state) { return new CoreResult(true, state, null); }
        public static CoreResult failure(String error) { return new CoreResult(false, null, error); }
    }

    public record VoteChoice(String kind, @JsonInclude(NON_NULL) Character character) {}
    public record Vote(String playerId, VoteChoice choice, int sequence) {}
    public record WindowState(String id, String kind, List<String> eligible, List<Vote> votes, String summary,
                              @JsonInclude(NON_NULL) Vote priority, @JsonInclude(NON_NULL) String nextActiveId) {
        public WindowState {
            eligible = List.copyOf(eligible);
            votes = List.copyOf(votes);
        }
    }

    public record OnlineState(GameState game, int round, WindowState window, List<WindowState> audit) {
        public OnlineState { audit = List.copyOf(audit); }
    }

    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
    @JsonSubTypes({
            @JsonSubTypes.Type(value = SelectAction.class, name = "select-action"),
            @JsonSubTypes.Type(value = CastVote.class, name = "vote"),
            @JsonSubTypes.Type(value = LoseInfluence.class, name = "lose"),
            @JsonSubTypes.Type(value = Negotiate.class, name = "negotiate")
    })
    public sealed interface OnlineCommand permits SelectAction, CastVote, LoseInfluence, Negotiate {}

    public record SelectAction(Action action, @JsonInclude(NON_NULL) String targetId) implements OnlineCommand {}
    public record CastVote(String windowId, VoteChoice choice) implements OnlineCommand {}
    public record LoseInfluence(String cardId) implements OnlineCommand {}
    public record Negotiate(List<String> keepIds) implements OnlineCommand {
        public Negotiate {
            if (keepIds != null) keepIds = java.util.Collections.unmodifiableList(new java.util.ArrayList<>(keepIds));
        }
    }

    @JsonInclude(NON_NULL)
    public record OnlineResult(boolean ok, OnlineState state, String error) {
        public static OnlineResult success(OnlineState state) { return new OnlineResult(true, state, null); }
        public static OnlineResult failure(String error) { return new OnlineResult(false, null, error); }
    }

    public record PublicPlayer(String id, String name, int credits, int influence) {}
    public record WindowView(String id, String kind, List<String> eligible, String summary,
                             List<String> responded, List<VoteChoice> options) {
        public WindowView {
            eligible = List.copyOf(eligible);
            responded = List.copyOf(responded);
            options = List.copyOf(options);
        }
    }

    public record OnlineView(long revision, int round, String activeId, String viewerId, boolean closed,
                             boolean canClose, boolean canRematch, Phase phase, List<HistoryEntry> history,
                             List<Character> cemetery, int deckCount, @JsonInclude(NON_NULL) GameEvent lastEvent,
                             List<PublicPlayer> players, List<Card> hand, boolean revealed, String privatePlayerId,
                             List<Card> choices, List<Action> availableActions, List<String> targets, List<Block> blocks,
                             List<String> challenges, @JsonInclude(NON_NULL) WindowView window) {
        public OnlineView {
            history = List.copyOf(history);
            cemetery = List.copyOf(cemetery);
            players = List.copyOf(players);
            hand = List.copyOf(hand);
            choices = List.copyOf(choices);
            availableActions = List.copyOf(availableActions);
            targets = List.copyOf(targets);
            blocks = List.copyOf(blocks);
            challenges = List.copyOf(challenges);
        }
    }
}
