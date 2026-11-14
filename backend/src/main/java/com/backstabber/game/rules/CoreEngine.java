package com.backstabber.game.rules;

import com.backstabber.game.model.GameModel.Character;
import com.backstabber.game.random.GameRandom;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.backstabber.game.model.GameModel.*;

/** Pure turn and action rules. Voting and per-player projection belong to the online layer. */
public final class CoreEngine {
    private static final Map<Action, Character> CLAIMS = Map.of(
            Action.tax, Character.magnata, Action.steal, Character.mercenario,
            Action.assassinate, Character.executor, Action.negotiate, Character.broker);
    private static final Set<Action> TARGETED = Set.of(Action.steal, Action.assassinate, Action.backstab);
    private static final Map<Action, String> LABELS = Map.of(
            Action.income, "Renda", Action.patrocinio, "Patrocínio", Action.tax, "Taxar",
            Action.steal, "Extorquir", Action.assassinate, "Executar", Action.backstab, "Backstab",
            Action.negotiate, "Negociar");
    private static final Map<Character, String> CHARACTER_NAMES = Map.of(
            Character.magnata, "Magnata", Character.executor, "Executor", Character.sentinela, "Sentinela",
            Character.mercenario, "Mercenário", Character.broker, "Broker");
    private static final Pattern EDGE_WHITESPACE = Pattern.compile(
            "^[\\t-\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+"
            + "|[\\t-\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$");

    private CoreEngine() {}

    public static GameState create(List<Participant> participants, GameRandom random) {
        List<String> names = validatedNames(participants);
        int copies = deckSize(participants.size()) / Character.values().length;
        List<Card> deck = new ArrayList<>();
        for (Character character : Character.values()) {
            for (int copy = 0; copy < copies; copy++) {
                deck.add(new Card(character.name() + "-" + copy, character));
            }
        }
        shuffle(deck, random);
        List<Player> players = new ArrayList<>();
        for (int seat = 0; seat < participants.size(); seat++) {
            players.add(new Player(participants.get(seat).id(), names.get(seat), 2,
                    List.of(deck.removeLast(), deck.removeLast())));
        }
        return new GameState(0, players.getFirst().id(), players, deck, new ActionPhase(), null,
                List.of(), List.of(), List.of(), null);
    }

    private static int deckSize(int players) {
        if (players <= 6) return 15;
        return players <= 8 ? 20 : 25;
    }

    private static List<String> validatedNames(List<Participant> participants) {
        if (participants.size() < 1 || participants.size() > 10) {
            throw new IllegalArgumentException("Escolha entre 1 e 10 jogadores.");
        }
        List<String> names = new ArrayList<>();
        Set<String> normalized = new HashSet<>();
        boolean duplicate = false;
        for (Participant participant : participants) {
            String raw = participant == null ? null : participant.name();
            String name = raw == null ? "" : EDGE_WHITESPACE.matcher(raw).replaceAll("");
            if (name.isEmpty() || name.length() > 18) {
                throw new IllegalArgumentException("Preencha os nomes dos jogadores (até 18 caracteres).");
            }
            names.add(name);
            String canonical = Normalizer.normalize(name, Normalizer.Form.NFC).toLowerCase(Locale.forLanguageTag("pt-BR"));
            if (!normalized.add(canonical)) duplicate = true;
        }
        if (duplicate) throw new IllegalArgumentException("Os nomes dos jogadores devem ser diferentes.");
        return names;
    }

    private static void shuffle(List<Card> cards, GameRandom random) {
        for (int index = cards.size() - 1; index > 0; index--) {
            int other = (int) Math.floor(random.nextDouble() * (index + 1));
            Collections.swap(cards, index, other);
        }
    }

    public static AvailableCommands available(GameState state) {
        List<Player> others = state.players().stream()
                .filter(player -> !player.id().equals(state.activeId()) && !player.cards().isEmpty()).toList();
        List<Action> actions = List.of();
        List<String> targets = List.of();
        List<String> challenges = List.of();
        List<Block> blocks = new ArrayList<>();
        switch (state.phase()) {
            case ActionPhase ignored -> {
                Player current = findPlayer(state, state.activeId());
                int credits = current == null ? 0 : current.credits();
                if (credits >= 10 && !others.isEmpty()) {
                    actions = List.of(Action.backstab);
                } else {
                    actions = Arrays.stream(Action.values())
                            .filter(action -> !TARGETED.contains(action) || !others.isEmpty())
                            .filter(action -> switch (action) {
                                case assassinate -> credits >= 3;
                                case backstab -> credits >= 7;
                                case negotiate -> state.deck().size() >= 2;
                                default -> true;
                            }).toList();
                }
            }
            case TargetPhase ignored -> targets = others.stream().map(Player::id).toList();
            case ReactionPhase reaction -> {
                Declaration declaration = reaction.declaration();
                if (CLAIMS.containsKey(declaration.action())) challenges = others.stream().map(Player::id).toList();
                for (Player other : others) {
                    if (declaration.action() == Action.patrocinio) {
                        blocks.add(new Block(other.id(), Character.magnata));
                    }
                    if (!other.id().equals(declaration.targetId())) continue;
                    switch (declaration.action()) {
                        case assassinate -> blocks.add(new Block(other.id(), Character.sentinela));
                        case steal -> {
                            blocks.add(new Block(other.id(), Character.mercenario));
                            blocks.add(new Block(other.id(), Character.broker));
                        }
                        default -> { }
                    }
                }
            }
            case BlockReactionPhase reaction -> challenges = state.players().stream()
                    .filter(player -> !player.cards().isEmpty() && !player.id().equals(reaction.block().playerId()))
                    .map(Player::id).toList();
            default -> { }
        }
        return new AvailableCommands(actions, targets, challenges, blocks);
    }

    public static CoreResult transition(GameState state, CoreCommand command, long expectedRevision, GameRandom random) {
        if (state.revision() != expectedRevision) return CoreResult.failure("STALE_REVISION");
        if (command == null) return CoreResult.failure("INVALID_COMMAND");
        String error = validate(state, command);
        if (error != null) return CoreResult.failure(error);

        Draft next = new Draft(state);
        MutablePlayer actor = next.player(command.playerId());
        switch (command.type()) {
            case "select-action" -> {
                if (TARGETED.contains(command.action())) next.phase = new TargetPhase(command.action());
                else declare(next, actor, command.action(), null);
            }
            case "select-target" -> declare(next, actor, ((TargetPhase) state.phase()).action(), command.targetId());
            case "cancel-target" -> next.phase = new ActionPhase();
            case "accept" -> {
                if (state.phase() instanceof ReactionPhase reaction) resolve(next, reaction.declaration());
                else {
                    next.log("SISTEMA", "Bloqueio aceito. Ação cancelada.");
                    next.advance();
                }
            }
            case "block" -> {
                var reaction = (ReactionPhase) state.phase();
                next.phase = new BlockReactionPhase(reaction.declaration(), new Block(actor.id, command.character()));
                next.log(actor.name, "Bloqueou com " + CHARACTER_NAMES.get(command.character()) + ".");
            }
            case "challenge" -> {
                if (state.phase() instanceof ReactionPhase reaction) {
                    challenge(next, actor, reaction.declaration(), null, random);
                } else {
                    var reaction = (BlockReactionPhase) state.phase();
                    challenge(next, actor, reaction.declaration(), reaction.block(), random);
                }
            }
            case "lose" -> lose(next, actor, command.cardId(), random);
            case "negotiate" -> negotiate(next, actor, command.keepIds(), random);
            default -> throw new IllegalStateException("Unvalidated core command");
        }
        return CoreResult.success(next.freeze(state.revision() + 1));
    }

    private static String validate(GameState state, CoreCommand command) {
        Player actor = findPlayer(state, command.playerId());
        if (actor == null || actor.cards().isEmpty()) return "NOT_AUTHORIZED";
        if (command.type() == null) return "INVALID_COMMAND";

        boolean active = actor.id().equals(state.activeId());
        Phase phase = state.phase();
        var options = available(state);
        return switch (command.type()) {
            case "select-action" -> {
                if (!(phase instanceof ActionPhase)) yield "INVALID_PHASE";
                if (!active) yield "NOT_AUTHORIZED";
                yield command.action() != null && options.availableActions().contains(command.action()) ? null : "INVALID_COMMAND";
            }
            case "select-target", "cancel-target" -> {
                if (!(phase instanceof TargetPhase)) yield "INVALID_PHASE";
                if (!active) yield "NOT_AUTHORIZED";
                yield "cancel-target".equals(command.type())
                        || command.targetId() != null && options.targets().contains(command.targetId()) ? null : "INVALID_COMMAND";
            }
            case "accept" -> {
                if (!(phase instanceof ReactionPhase || phase instanceof BlockReactionPhase)) yield "INVALID_PHASE";
                yield active ? null : "NOT_AUTHORIZED";
            }
            case "block" -> {
                if (!(phase instanceof ReactionPhase)) yield "INVALID_PHASE";
                yield options.blocks().stream().anyMatch(block -> actor.id().equals(block.playerId())
                        && block.character() == command.character()) ? null : "NOT_AUTHORIZED";
            }
            case "challenge" -> {
                if (!(phase instanceof ReactionPhase || phase instanceof BlockReactionPhase)) yield "INVALID_PHASE";
                yield options.challenges().contains(actor.id()) ? null : "NOT_AUTHORIZED";
            }
            case "lose" -> {
                if (!(phase instanceof LossPhase loss)) yield "INVALID_PHASE";
                if (!actor.id().equals(loss.victimId())) yield "NOT_AUTHORIZED";
                yield actor.cards().stream().anyMatch(card -> card.id().equals(command.cardId())) ? null : "INVALID_COMMAND";
            }
            case "negotiate" -> {
                if (!(phase instanceof NegotiationPhase negotiation)) yield "INVALID_PHASE";
                if (!actor.id().equals(negotiation.playerId())) yield "NOT_AUTHORIZED";
                List<String> ids = command.keepIds();
                var owned = new ArrayList<>(actor.cards());
                owned.addAll(state.offer());
                yield ids != null && ids.size() == negotiation.keep() && new HashSet<>(ids).size() == ids.size()
                        && ids.stream().allMatch(id -> owned.stream().anyMatch(card -> card.id().equals(id)))
                        ? null : "INVALID_COMMAND";
            }
            default -> "INVALID_COMMAND";
        };
    }

    private static Player findPlayer(GameState state, String playerId) {
        return state.players().stream().filter(player -> player.id().equals(playerId)).findFirst().orElse(null);
    }

    private static void declare(Draft state, MutablePlayer actor, Action action, String targetId) {
        var declaration = new Declaration(action, actor.id, targetId);
        MutablePlayer target = state.player(targetId);
        String label = LABELS.get(action);
        state.log(actor.name, targetId == null ? label : label + " → " + target.name);
        if (action == Action.income) {
            actor.credits++;
            state.lastEvent = new GameEvent("income", actor.id, null);
            state.advance();
        } else if (action == Action.backstab && targetId != null) {
            actor.credits -= 7;
            state.lastEvent = new GameEvent("backstab", actor.id, targetId);
            state.phase = new LossPhase(targetId, "backstab", null);
        } else {
            if (action == Action.assassinate) actor.credits -= 3;
            state.phase = new ReactionPhase(declaration);
        }
    }

    private static void resolve(Draft state, Declaration declaration) {
        MutablePlayer actor = state.player(declaration.playerId());
        MutablePlayer target = state.player(declaration.targetId());
        state.continuation = null;
        state.log(actor.name, LABELS.get(declaration.action()) + ": ação efetuada.");
        switch (declaration.action()) {
            case patrocinio -> actor.credits += 2;
            case tax -> actor.credits += 3;
            case steal -> {
                if (target != null && target.alive()) {
                    int stolen = Math.min(2, target.credits);
                    target.credits -= stolen;
                    actor.credits += stolen;
                }
            }
            case assassinate -> {
                if (target != null && target.alive()) {
                    state.phase = new LossPhase(target.id, "execution", null);
                    return;
                }
            }
            case negotiate -> {
                state.offer = List.of(state.deck.removeLast(), state.deck.removeLast());
                state.phase = new NegotiationPhase(actor.id, actor.cards.size());
                return;
            }
            default -> { }
        }
        state.advance();
    }

    private static void challenge(Draft state, MutablePlayer challenger, Declaration declaration, Block block,
                                  GameRandom random) {
        Character claim = block == null ? CLAIMS.get(declaration.action()) : block.character();
        MutablePlayer declarer = state.player(block == null ? declaration.playerId() : block.playerId());
        int proofIndex = -1;
        for (int index = 0; index < declarer.cards.size(); index++) {
            if (declarer.cards.get(index).character() == claim) {
                proofIndex = index;
                break;
            }
        }
        boolean truthful = proofIndex >= 0;
        state.log(challenger.name, "Contestou " + (block == null ? "a ação" : "o bloqueio") + " de " + declarer.name + ".");
        if (truthful) {
            // The replacement is drawn before the proved card goes back into the deck.
            Card replacement = state.deck.removeLast();
            Card proof = declarer.cards.remove(proofIndex);
            declarer.cards.add(replacement);
            state.deck.add(proof);
            shuffle(state.deck, random);
        }
        state.continuation = truthful == (block == null) ? declaration : null;
        state.phase = new LossPhase(truthful ? challenger.id : declarer.id, "challenge",
                new Challenge(truthful, challenger.id, declarer.id, claim, declaration, block));
    }

    private static void lose(Draft state, MutablePlayer victim, String cardId, GameRandom random) {
        Card card = victim.cards.stream().filter(entry -> entry.id().equals(cardId)).findFirst().orElseThrow();
        victim.cards.remove(card);
        state.cemetery.add(card.character());
        state.deck.add(card);
        shuffle(state.deck, random);
        state.log(victim.name, "Perdeu influência: " + CHARACTER_NAMES.get(card.character()));
        if (!victim.alive()) {
            state.log("SISTEMA", victim.name + " foi eliminado!");
            state.lastEvent = new GameEvent("eliminated", victim.id, null);
        }
        List<MutablePlayer> survivors = state.players.stream().filter(MutablePlayer::alive).toList();
        if (survivors.size() == 1) {
            MutablePlayer survivor = survivors.getFirst();
            state.phase = new FinishedPhase(survivor.id, survivor.cards);
            state.continuation = null;
        } else if (state.continuation != null) {
            resolve(state, state.continuation);
        } else {
            state.advance();
        }
    }

    private static void negotiate(Draft state, MutablePlayer actor, List<String> keepIds, GameRandom random) {
        var combined = new ArrayList<>(actor.cards);
        combined.addAll(state.offer);
        var kept = Set.copyOf(keepIds);
        actor.cards.clear();
        for (Card card : combined) {
            if (kept.contains(card.id())) {
                actor.cards.add(card);
            } else {
                // The reference reshuffles for each returned card, not just once at the end.
                state.deck.add(card);
                shuffle(state.deck, random);
            }
        }
        state.log(actor.name, "Concluiu a negociação do Broker.");
        state.advance();
    }

    private static final class Draft {
        private String activeId;
        private final List<MutablePlayer> players;
        private final List<Card> deck;
        private Phase phase;
        private Declaration continuation;
        private List<Card> offer;
        private final List<HistoryEntry> history;
        private final List<Character> cemetery;
        private GameEvent lastEvent;

        private Draft(GameState state) {
            activeId = state.activeId();
            players = state.players().stream().map(MutablePlayer::new).toList();
            deck = new ArrayList<>(state.deck());
            phase = state.phase();
            continuation = state.continuation();
            offer = state.offer();
            history = new ArrayList<>(state.history());
            cemetery = new ArrayList<>(state.cemetery());
        }

        private MutablePlayer player(String id) {
            return players.stream().filter(player -> player.id.equals(id)).findFirst().orElse(null);
        }

        private void log(String name, String text) {
            history.addFirst(new HistoryEntry(name, text));
            while (history.size() > 5) history.removeLast();
        }

        private void advance() {
            int activeIndex = players.indexOf(player(activeId));
            for (int offset = 1; offset <= players.size(); offset++) {
                MutablePlayer candidate = players.get((activeIndex + offset) % players.size());
                if (candidate.alive()) {
                    activeId = candidate.id;
                    phase = new ActionPhase();
                    continuation = null;
                    offer = List.of();
                    return;
                }
            }
            throw new IllegalStateException("Partida sem jogadores ativos.");
        }

        private GameState freeze(long revision) {
            return new GameState(revision, activeId, players.stream().map(MutablePlayer::freeze).toList(),
                    deck, phase, continuation, offer, history, cemetery, lastEvent);
        }
    }

    private static final class MutablePlayer {
        private final String id;
        private final String name;
        private int credits;
        private final List<Card> cards;

        private MutablePlayer(Player player) {
            id = player.id();
            name = player.name();
            credits = player.credits();
            cards = new ArrayList<>(player.cards());
        }

        private boolean alive() {
            return !cards.isEmpty();
        }

        private Player freeze() {
            return new Player(id, name, credits, cards);
        }
    }
}
