package com.backstabber.game;

import com.backstabber.game.model.GameModel.Action;
import com.backstabber.game.model.GameModel.ActionPhase;
import com.backstabber.game.model.GameModel.CoreCommand;
import com.backstabber.game.model.GameModel.GameState;
import com.backstabber.game.model.GameModel.Participant;
import com.backstabber.game.model.GameModel.TargetPhase;
import com.backstabber.game.random.GameRandom;
import com.backstabber.game.rules.CoreEngine;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CoreEngineTest {
    private static final GameRandom NO_SWAPS = () -> 0.999;
    private static final GameRandom UNEXPECTED_DRAW = () -> {
        throw new AssertionError("This transition must not consume random samples");
    };

    @Test
    void dealsSoloForTheInternalCoreAndKeepsSeatIdSeparateFromName() {
        var draws = new AtomicInteger();
        GameState game = CoreEngine.create(List.of(new Participant("custom-id", "\ufeffSolo\u00a0")), () -> {
            draws.incrementAndGet();
            return NO_SWAPS.nextDouble();
        });
        assertEquals(14, draws.get());
        assertEquals(13, game.deck().size());
        assertEquals("custom-id", game.activeId());
        assertEquals("Solo", game.players().getFirst().name());
        assertEquals(List.of("broker-2", "broker-1"), game.players().getFirst().cards().stream().map(card -> card.id()).toList());
        assertEquals(List.of(Action.income, Action.patrocinio, Action.tax, Action.negotiate),
                CoreEngine.available(game).availableActions());
    }

    @Test
    void rejectsEmptyAndNormalizedDuplicateNamesBeforeShuffling() {
        assertEquals("Escolha entre 1 e 10 jogadores.", assertThrows(IllegalArgumentException.class,
                () -> CoreEngine.create(List.of(), UNEXPECTED_DRAW)).getMessage());
        assertEquals("Preencha os nomes dos jogadores (até 18 caracteres).", assertThrows(IllegalArgumentException.class,
                () -> CoreEngine.create(List.of(new Participant("one", "\u00a0\ufeff")), UNEXPECTED_DRAW)).getMessage());
        assertEquals("Os nomes dos jogadores devem ser diferentes.", assertThrows(IllegalArgumentException.class,
                () -> CoreEngine.create(List.of(new Participant("one", "Ágata"), new Participant("two", " A\u0301GATA ")),
                        UNEXPECTED_DRAW)).getMessage());
    }

    @Test
    void cancelsTargetWithoutCostOrHistoryAndLeavesInputUntouched() {
        GameState original = game();
        GameState selecting = play(original, command("select-action", "a", Action.steal, null));
        assertInstanceOf(TargetPhase.class, selecting.phase());
        assertEquals(List.of("b", "c"), CoreEngine.available(selecting).targets());
        assertEquals("NOT_AUTHORIZED", reject(selecting, command("cancel-target", "b", null, null), 1));
        assertEquals("INVALID_COMMAND", reject(selecting, command("select-target", "a", null, "a"), 1));
        GameState cancelled = play(selecting, command("cancel-target", "a", null, null));

        assertEquals(original.withRevision(2), cancelled);
        assertInstanceOf(ActionPhase.class, original.phase());
        assertEquals(new TargetPhase(Action.steal), selecting.phase());
        assertThrows(UnsupportedOperationException.class, () -> selecting.deck().clear());
        assertThrows(UnsupportedOperationException.class, () -> selecting.players().getFirst().cards().clear());
    }

    @Test
    void preservesRejectionOrderForMalformedAndUnauthorizedRequests() {
        GameState game = game();
        assertEquals("STALE_REVISION", reject(game, null, 1));
        assertEquals("INVALID_COMMAND", reject(game, null, 0));
        assertEquals("NOT_AUTHORIZED", reject(game, command("unknown", "absent", null, null), 0));
        assertEquals("INVALID_COMMAND", reject(game, command(null, "a", null, null), 0));
        assertEquals("INVALID_COMMAND", reject(game, command("select-action", "a", null, null), 0));
        assertEquals("INVALID_PHASE", reject(game, command("select-target", "b", null, "a"), 0));
        assertEquals("NOT_AUTHORIZED", reject(game, command("select-action", "b", Action.income, null), 0));
        assertEquals(0, game.revision());
        assertNull(game.lastEvent());
    }

    private static GameState game() {
        return CoreEngine.create(List.of(new Participant("a", "Ada"), new Participant("b", "Bia"),
                new Participant("c", "Caio")), NO_SWAPS);
    }

    private static CoreCommand command(String type, String player, Action action, String target) {
        return new CoreCommand(type, player, action, target, null, null, null);
    }

    private static GameState play(GameState game, CoreCommand command) {
        var result = CoreEngine.transition(game, command, game.revision(), UNEXPECTED_DRAW);
        assertTrue(result.ok(), result.error());
        return result.state();
    }

    private static String reject(GameState game, CoreCommand command, long revision) {
        var result = CoreEngine.transition(game, command, revision, UNEXPECTED_DRAW);
        assertFalse(result.ok());
        assertNull(result.state());
        return result.error();
    }
}
