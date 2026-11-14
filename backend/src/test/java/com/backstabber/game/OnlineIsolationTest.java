package com.backstabber.game;

import com.backstabber.game.model.GameStateJson;
import com.backstabber.game.online.OnlineEngine;
import com.backstabber.game.random.GameRandom;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static com.backstabber.game.model.GameModel.*;
import static org.junit.jupiter.api.Assertions.*;

class OnlineIsolationTest {
    private static final Participant FIRST = new Participant("first", "Ada");
    private static final Participant SECOND = new Participant("second", "Bia");

    @Test
    void rejectsInvalidRostersBeforeConsumingRandomness() {
        GameRandom unexpected = () -> fail("Invalid roster consumed randomness");
        assertThrows(IllegalArgumentException.class, () -> OnlineEngine.create(List.of(FIRST), unexpected));
        assertThrows(IllegalArgumentException.class, () ->
                OnlineEngine.create(List.of(FIRST, new Participant(FIRST.id(), SECOND.name())), unexpected));
        assertThrows(IllegalArgumentException.class, () ->
                OnlineEngine.create(List.of(FIRST, new Participant(SECOND.id(), " ADA ")), unexpected));
        assertThrows(IllegalArgumentException.class, () -> OnlineEngine.create(
                java.util.stream.IntStream.range(1, 12).mapToObj(i -> new Participant("p" + i, "Name " + i)).toList(),
                unexpected));
    }

    @Test
    void independentGamesAndConcurrentTransitionsCannotChangeInputsOrOldWindows() throws Exception {
        var codec = new GameStateJson();
        var left = OnlineEngine.create(List.of(FIRST, SECOND), () -> .999);
        var right = OnlineEngine.create(List.of(FIRST, SECOND), () -> .125);
        String originalLeft = codec.write(left);
        String originalRight = codec.write(right);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var a = workers.submit(() -> OnlineEngine.transition(left, "first", new SelectAction(Action.income, null),
                    0, () -> fail("Income consumed randomness")));
            var b = workers.submit(() -> OnlineEngine.transition(right, "first", new SelectAction(Action.tax, null),
                    0, () -> fail("Tax declaration consumed randomness")));
            var income = a.get(5, TimeUnit.SECONDS).state();
            var tax = b.get(5, TimeUnit.SECONDS).state();
            assertEquals("acknowledge", income.window().kind());
            assertEquals("reaction", tax.window().kind());
            assertEquals(3, income.game().players().getFirst().credits());
            assertEquals(2, tax.game().players().getFirst().credits());
            assertEquals(originalLeft, codec.write(left));
            assertEquals(originalRight, codec.write(right));
            String beforeVote = codec.write(income);
            var voted = OnlineEngine.transition(income, "second",
                    new CastVote(income.window().id(), new VoteChoice("acknowledge", null)), 1, () -> 0).state();
            assertEquals(1, voted.window().votes().size());
            assertEquals(beforeVote, codec.write(income));
            assertThrows(UnsupportedOperationException.class, () -> voted.window().votes().clear());
            assertThrows(UnsupportedOperationException.class, () -> voted.game().players().getFirst().cards().clear());
            var acknowledged = OnlineEngine.transition(voted, "first",
                    new CastVote(voted.window().id(), new VoteChoice("acknowledge", null)), 2, () -> 0).state();
            assertNull(acknowledged.window());
            assertEquals("second", acknowledged.game().activeId());
            assertEquals(List.of("second", "first"),
                    acknowledged.audit().getFirst().votes().stream().map(Vote::playerId).toList());
            assertThrows(UnsupportedOperationException.class, () -> acknowledged.audit().getFirst().votes().clear());
            assertEquals(1, voted.window().votes().size());
        }
    }

    @Test
    void secureRandomUsesTheProductionSampleSpaceAndModelsDefensivelyCopyLists() {
        var random = GameRandom.secure();
        for (int i = 0; i < 50; i++) {
            double value = random.nextDouble();
            assertTrue(value >= 0 && value < 1);
            assertEquals(Math.floor(value * 0x1_0000_0000p0), value * 0x1_0000_0000p0);
        }
        var cards = new ArrayList<Card>();
        var player = new Player(FIRST.id(), FIRST.name(), 2, cards);
        cards.add(new Card("broker-0", com.backstabber.game.model.GameModel.Character.broker));
        assertTrue(player.cards().isEmpty());
    }
}
