package com.backstabber.game;

import com.backstabber.game.model.GameStateJson;
import com.backstabber.game.online.OnlineEngine;
import com.backstabber.game.random.GameRandom;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static com.backstabber.game.model.GameModel.*;
import static org.junit.jupiter.api.Assertions.*;

class DeterministicParityTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final GameStateJson codec = new GameStateJson();

    @TestFactory
    List<DynamicTest> nodeOracleScenarios() throws IOException {
        try (var input = getClass().getResourceAsStream("/game/parity-scenarios.json")) {
            assertNotNull(input, "Versioned Node oracle fixture missing");
            JsonNode fixtures = json.readTree(input);
            assertEquals(1, fixtures.path("schemaVersion").asInt());
            List<DynamicTest> tests = new ArrayList<>();
            for (JsonNode scenario : fixtures.path("scenarios")) {
                tests.add(DynamicTest.dynamicTest(scenario.path("name").asString(), () -> compare(scenario)));
            }
            assertFalse(tests.isEmpty());
            return tests;
        }
    }

    private void compare(JsonNode scenario) {
        List<Participant> roster = StreamSupport.stream(scenario.path("roster").spliterator(), false)
                .map(participant -> json.treeToValue(participant, Participant.class)).toList();
        var random = new Samples(scenario.path("random"));
        var creation = scenario.path("creation");
        OnlineState created = OnlineEngine.create(roster, random);
        assertJson(creation.path("state"), codec.write(created), "create");
        assertEquals(creation.path("rngCalls").asInt(), random.consumed, "creation draws");

        var initial = scenario.path("initial");
        OnlineState state = roundTrip(initial.path("state"), "initial");
        checkViews(state, initial.path("views"), "initial");
        int index = 0;
        for (var step : scenario.path("steps")) {
            String label = "step " + (++index) + " " + step.path("label").asString() + " " + step.path("command");
            JsonNode expected = step.path("result");
            OnlineCommand command = json.treeToValue(step.path("command"), OnlineCommand.class);
            int before = random.consumed;
            String original = codec.write(state);
            var result = OnlineEngine.transition(state, step.path("actor").asString(), command,
                    step.path("expectedRevision").asLong(), random);
            assertEquals(original, codec.write(state), label + " mutated original");
            assertEquals(step.path("rngCalls").asInt(), random.consumed - before, label + " draws");
            assertEquals(expected.path("ok").asBoolean(), result.ok(), label);
            if (result.ok()) {
                assertEquals(state.game().revision() + 1, result.state().game().revision(), label);
                String written = codec.write(result.state());
                assertJson(expected.path("state"), written, label);
                state = codec.read(written);
                assertEquals(roundTrip(expected.path("state"), label), state, label + " recovered state");
            } else {
                assertEquals(expected.path("error").asString(), result.error(), label);
                assertNull(result.state(), label);
            }
            checkViews(state, step.path("views"), label);
        }
    }

    private OnlineState roundTrip(JsonNode expected, String label) {
        OnlineState decoded = codec.read(expected.toString());
        assertJson(expected, codec.write(decoded), label + " Node JSON round trip");
        return decoded;
    }

    private void checkViews(OnlineState state, JsonNode probes, String label) {
        assertTrue(probes.isArray(), label + " views");
        for (JsonNode probe : probes) {
            String viewer = probe.path("viewerId").asString();
            var projection = OnlineEngine.project(state, viewer, probe.path("hostId").asString(),
                    probe.path("closed").asBoolean(), probe.path("hostAbandoned").asBoolean());
            String encoded = json.writeValueAsString(projection);
            assertJson(probe.path("value"), encoded, label + " view " + viewer);
            JsonNode view = json.readTree(encoded);
            for (String secret : List.of("audit", "game", "continuation", "deck", "offer")) {
                assertFalse(view.has(secret), label + " leaked " + secret);
            }
            assertFalse(view.path("window").has("votes"), label + " leaked votes");
            assertFalse(view.path("window").has("priority"), label + " leaked priority");
            assertFalse(view.path("window").has("nextActiveId"), label + " leaked next player");
            var visible = new java.util.HashSet<String>();
            collectCardIds(view.path("hand"), visible);
            collectCardIds(view.path("choices"), visible);
            collectCardIds(view.path("phase").path("cards"), visible);
            for (Player opponent : state.game().players()) {
                if (viewer.equals(opponent.id())) continue;
                for (Card card : opponent.cards()) assertFalse(visible.contains(card.id()), label + " leaked opponent card");
            }
            for (Card card : state.game().deck()) assertFalse(visible.contains(card.id()), label + " leaked deck");
            boolean hasOffer = !projection.closed() && state.window() == null
                    && state.game().phase() instanceof NegotiationPhase negotiation && viewer.equals(negotiation.playerId());
            if (!hasOffer) {
                for (Card card : state.game().offer()) assertFalse(visible.contains(card.id()), label + " leaked offer");
            }
            // Ensure arbitrary nested fields cannot smuggle card IDs outside the three intended paths.
            Set<String> actualCardIds = StreamSupport.stream(state.game().players().spliterator(), false)
                    .flatMap(player -> player.cards().stream()).map(Card::id).collect(Collectors.toSet());
            state.game().deck().forEach(card -> actualCardIds.add(card.id()));
            state.game().offer().forEach(card -> actualCardIds.add(card.id()));
            assertEquals(visible, leakedIds(view, actualCardIds), label + " card field surface");
        }
    }

    private static void collectCardIds(JsonNode cards, Set<String> collected) {
        if (cards.isArray()) for (var card : cards) collected.add(card.path("id").asString());
    }

    private static Set<String> leakedIds(JsonNode node, Set<String> possibleIds) {
        var result = new java.util.HashSet<String>();
        if (node.isTextual() && possibleIds.contains(node.asString())) result.add(node.asString());
        if (node.isArray() || node.isObject()) for (var child : node) result.addAll(leakedIds(child, possibleIds));
        return result;
    }

    private void assertJson(JsonNode expected, String actual, String label) {
        JsonNode observed = json.readTree(actual);
        if (!expected.equals(observed)) {
            assertEquals(expected, observed, () -> label + " first difference: " + difference(expected, observed, "$"));
        }
    }

    private static String difference(JsonNode expected, JsonNode actual, String path) {
        if (expected.equals(actual)) return "";
        if (expected.isObject() && actual.isObject()) {
            for (String property : expected.propertyNames()) {
                if (!expected.path(property).equals(actual.path(property))) {
                    return difference(expected.path(property), actual.path(property), path + "." + property);
                }
            }
            for (String property : actual.propertyNames()) {
                if (!expected.has(property)) return path + "." + property + " unexpected";
            }
        }
        if (expected.isArray() && actual.isArray() && expected.size() == actual.size()) {
            for (int index = 0; index < expected.size(); index++) {
                if (!expected.get(index).equals(actual.get(index))) {
                    return difference(expected.get(index), actual.get(index), path + "[" + index + "]");
                }
            }
        }
        return path + ": expected " + expected + ", got " + actual;
    }

    private static final class Samples implements GameRandom {
        private final JsonNode values;
        private int consumed;

        private Samples(JsonNode values) {
            this.values = values;
        }

        @Override
        public double nextDouble() {
            assertTrue(consumed < values.size(), "Node fixture ran out of RNG samples at " + consumed);
            return values.get(consumed++).asDouble();
        }
    }
}
