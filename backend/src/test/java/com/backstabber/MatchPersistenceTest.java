package com.backstabber;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.ServerSocket;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class MatchPersistenceTest extends SocialIntegrationTest {
    static final String ROOMS = "/api/v1/rooms";
    static final String MATCHES = "/api/v1/matches";
    static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void startsRealMatchProjectsPrivateViewsAndReplaysTheOriginalResultAfterClose() throws Exception {
        UUID room = lobby(2);
        expect(post(ROOMS + "/" + room + "/start", "second", "{}"), 403, "HOST_REQUIRED");
        String path = MATCHES + "/" + start(room);
        OnlineViews views = new OnlineViews(ok(request("GET", path, "first", null)),
                ok(request("GET", path, "second", null)));
        assertEquals(0, views.host().get("revision").asLong());
        assertEquals(1, views.guest().get("round").asInt());
        assertEquals(2, views.host().get("hand").size());
        assertEquals(2, views.guest().get("hand").size());
        assertNotEquals(views.host().get("hand"), views.guest().get("hand"));
        assertFalse(views.host().get("players").get(1).has("cards"));
        assertFalse(views.host().has("deck"));
        assertFalse(views.guest().has("audit"));
        expect(request("GET", path, "third", null), 404, "NOT_FOUND");
        expect(post(path + "/commands", "third", "{}"), 404, "NOT_FOUND");
        expect(request("GET", MATCHES + "/invalid", "first", null), 404, "NOT_FOUND");
        expect(request("GET", path + "/commands", "first", null), 405, "METHOD_NOT_ALLOWED");
        assertEquals(405, request("HEAD", path, "first", null).statusCode());
        expect(request("GET", path.substring(0, MATCHES.length() + 1)
                + "%" + Integer.toHexString(path.charAt(MATCHES.length() + 1)) + path.substring(MATCHES.length() + 2),
                "first", null), 404, "NOT_FOUND");
        expect(request("GET", path + "/%63ommands", "first", null), 404, "NOT_FOUND");
        expect(post(path + "/commands", "first", envelope("spoof", 0,
                "{\"type\":\"select-action\",\"action\":\"income\",\"playerId\":\"" + SECOND + "\"}")), 400, "INVALID_COMMAND");
        String income = envelope("income", 0, """
                {"type":"select-action","action":"income"}
                """);
        var success = ok(post(path + "/commands", "first", income));
        assertEquals(1, success.get("revision").asLong());
        ok(post(ROOMS + "/" + room + "/close", "first", "{}"));
        assertEquals(success, ok(post(path + "/commands", "first", income)));
        expect(post(path + "/commands", "first", envelope("income", 0,
                "{\"type\":\"select-action\",\"action\":\"tax\"}")), 400, "INVALID_COMMAND");
        var closed = ok(request("GET", path, "second", null));
        assertTrue(closed.get("closed").asBoolean());
        assertEquals(0, closed.path("window").path("options").size());
        assertEquals(0, closed.path("availableActions").size());
        assertEquals(1, jdbc.queryForObject("select count(*) from public.bs_match_commands", Integer.class));
    }

    @Test
    void concurrentStartsWaitForTheRoomAndReturnTheSameMatch() throws Exception {
        UUID room = lobby(2);
        UUID invite = pendingInvite(room);
        String start = ROOMS + "/" + room + "/start";
        long baseline = invalidations(room);
        var replies = race(room, "start/start", () -> post(start, "first", "{}"), () -> post(start, "first", "{}"));
        var started = ok(replies.getFirst());
        assertEquals(started, ok(replies.getLast()));
        assertEquals(1, matchCount(room));
        assertEquals("expired", inviteStatus(invite));
        assertEquals(baseline + 2, invalidations(room));
        var players = state(UUID.fromString(started.get("matchId").asString())).path("game").path("players");
        assertEquals(FIRST.toString(), players.get(0).path("id").asString());
        assertEquals("second_profile", players.get(1).path("name").asString());
    }

    @Test
    void memberLeavingFirstPreventsStartAndLeavesNoMatch() throws Exception {
        UUID room = lobby(2);
        String path = ROOMS + "/" + room;
        var replies = race(room, "leave/start", () -> post(path + "/leave", "second", "{}"),
                () -> post(path + "/start", "first", "{}"));
        ok(replies.getFirst());
        expect(replies.getLast(), 409, "ROOM_NOT_READY");
        assertEquals(0, matchCount(room));
    }

    @Test
    void rollsBackStartEvenWhenTheMatchWasAlreadyInserted() throws Exception {
        UUID room = lobby(2);
        UUID invite = pendingInvite(room);
        long baseline = invalidations(room);
        fault("bs_invites", "update", "23514");
        try {
            expect(post(ROOMS + "/" + room + "/start", "first", "{}"), 500, "INTERNAL_ERROR");
        } finally {
            clearFault("bs_invites");
        }
        var snapshot = ok(request("GET", ROOMS + "/" + room, "first", null));
        assertTrue(snapshot.path("canStart").asBoolean());
        assertTrue(snapshot.get("matchId").isNull());
        assertEquals(0, matchCount(room));
        assertEquals("pending", inviteStatus(invite));
        assertEquals(baseline, invalidations(room));
        start(room);
    }

    @Test
    void rollsBackStateAndInvalidationWhenRegisteringTheCommandFails() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        String path = MATCHES + "/" + match + "/commands";
        String command = envelope("retry-after-rollback", 0, action("income"));
        var before = state(match);
        long baseline = invalidations(room);
        fault("bs_match_commands", "insert", "40001");
        try {
            expect(post(path, "first", command), 503, "SERVICE_UNAVAILABLE");
        } finally {
            clearFault("bs_match_commands");
        }
        assertEquals(before, state(match));
        assertEquals(0, recorded(match));
        assertEquals(baseline, invalidations(room));
        var result = ok(post(path, "first", command));
        assertEquals(1, result.path("revision").asLong());
        // Discard the first response as a client would if it lost the connection after commit.
        assertEquals(result, ok(post(path, "first", command)));
        assertEquals(1, recorded(match));
        assertEquals(baseline + 1, invalidations(room));
    }

    @Test
    void deduplicatesConcurrentCommandsAndMapsLockTimeoutTo503() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        String path = MATCHES + "/" + match + "/commands";
        String income = envelope("duplicate", 0, action("income"));
        var before = state(match);
        try (Connection gate = gate(room)) {
            expect(post(path, "first", income), 503, "SERVICE_UNAVAILABLE");
            gate.rollback();
        }
        assertEquals(before, state(match));
        long baseline = invalidations(room);
        var replies = race(room, "command/replay", () -> post(path, "first", income), () -> post(path, "first", income));
        assertEquals(ok(replies.getFirst()), ok(replies.getLast()));
        assertEquals(1, recorded(match));
        assertEquals(baseline + 1, invalidations(room));
        assertEquals(3, state(match).path("game").path("players").get(0).path("credits").asInt());
    }

    @Test
    void recordsCompetingContestsInOrderAndResolvesOnlyOnTheLastVote() throws Exception {
        UUID room = lobby(4);
        UUID match = start(room);
        String path = MATCHES + "/" + match;
        ok(post(path + "/commands", "first", envelope("tax", 0, action("tax"))));
        var view = ok(request("GET", path, "second", null));
        String window = view.path("window").path("id").asString();
        String challenge = vote(window, "challenge");
        long baseline = invalidations(room);
        var rivals = race(room, "vote/vote", () -> post(path + "/commands", "second", envelope("vote", 1, challenge)),
                () -> post(path + "/commands", "third", envelope("vote", 1, challenge)));
        ok(rivals.getFirst());
        expect(rivals.getLast(), 409, "STALE_REVISION");
        expect(post(path + "/commands", "second", envelope("duplicate-vote", 2, challenge)), 409, "ALREADY_RESPONDED");
        ok(post(path + "/commands", "third", envelope("vote", 2, challenge)));
        var before = ok(request("GET", path, "fourth", null));
        assertFalse(before.path("window").has("votes"));
        assertEquals(2, before.path("window").path("responded").size());
        try (Connection gate = gate(room)) {
            var last = submit(() -> post(path + "/commands", "fourth", envelope("last", 3, vote(window, "accept"))));
            awaitRoomWaiters(gate, 1);
            assertEquals(before, ok(request("GET", path, "fourth", null)));
            gate.rollback();
            ok(last.get(10, TimeUnit.SECONDS));
        }
        var after = state(match);
        assertEquals("acknowledge", after.path("window").path("kind").asString());
        var audit = after.path("audit").get(0);
        assertEquals(3, audit.path("votes").size());
        assertEquals(3, audit.path("votes").get(2).path("sequence").asInt());
        assertEquals(SECOND.toString(), audit.path("priority").path("playerId").asString());
        assertEquals("loss", after.path("game").path("phase").path("kind").asString());
        assertEquals(baseline + 3, invalidations(room));
        assertEquals(4, recorded(match));
    }

    @Test
    void closeRejectsQueuedCommandAndRematchWithoutDiscardingHistory() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        String path = MATCHES + "/" + match;
        String close = ROOMS + "/" + room + "/close";
        var replies = race(room, "close/command", () -> post(close, "first", "{}"),
                () -> post(path + "/commands", "first", envelope("late", 0, action("income"))));
        ok(replies.getFirst());
        expect(replies.getLast(), 409, "INVALID_PHASE");
        assertEquals(0, state(match).path("game").path("revision").asLong());
        UUID secondRoom = lobby(2);
        UUID secondMatch = start(secondRoom);
        finish(secondMatch);
        var finished = state(secondMatch);
        var rematch = race(secondRoom, "close/rematch", () -> post(ROOMS + "/" + secondRoom + "/close", "first", "{}"),
                () -> post(MATCHES + "/" + secondMatch + "/rematch", "first", "{}"));
        ok(rematch.getFirst());
        expect(rematch.getLast(), 409, "INVALID_PHASE");
        assertEquals(finished, state(secondMatch));
    }

    @Test
    void concurrentRematchesKeepAuditAndIdempotentHistoryAndCreateOneRound() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        String path = MATCHES + "/" + match;
        finish(match);
        var before = state(match);
        expect(post(path + "/rematch", "second", "{}"), 403, "NOT_AUTHORIZED");
        long baseline = invalidations(room);
        long commands = recorded(match);
        var replies = race(room, "rematch/rematch", () -> post(path + "/rematch", "first", "{}"),
                () -> post(path + "/rematch", "first", "{}"));
        var result = ok(replies.getFirst());
        expect(replies.getLast(), 409, "INVALID_PHASE");
        assertEquals(2, result.path("round").asInt());
        assertEquals(before.path("game").path("revision").asLong() + 1, result.path("revision").asLong());
        assertEquals(2, result.path("hand").size());
        assertEquals(before.path("audit"), state(match).path("audit"));
        assertEquals(commands, recorded(match));
        assertEquals(baseline + 1, invalidations(room));
        var old = envelope("final-backstab", 0, """
                {"type":"select-action","action":"backstab","targetId":"%s"}
                """.formatted(SECOND));
        assertEquals(1, ok(post(path + "/commands", "first", old)).path("revision").asLong());
        assertEquals(baseline + 1, invalidations(room));
    }

    @Test
    void aCommandQueuedBehindRematchSeesTheNewRevision() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        finish(match);
        String path = MATCHES + "/" + match;
        long previous = state(match).path("game").path("revision").asLong();
        long records = recorded(match);
        var replies = race(room, "rematch/command", () -> post(path + "/rematch", "first", "{}"),
                () -> post(path + "/commands", "first", envelope("after-win", previous, action("income"))));
        assertEquals(2, ok(replies.getFirst()).path("round").asInt());
        expect(replies.getLast(), 409, "STALE_REVISION");
        assertEquals(previous + 1, state(match).path("game").path("revision").asLong());
        assertEquals(records, recorded(match));
    }

    @Test
    void recoversAfterPostgresTerminatesTheConnectionDuringTheRoomLock() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        String path = MATCHES + "/" + match + "/commands";
        String command = envelope("terminated", 0, action("income"));
        long baseline = invalidations(room);
        try (var gate = gate(room); var sql = gate.createStatement()) {
            var pending = submit(() -> post(path, "first", command));
            awaitRoomWaiters(gate, 1);
            sql.execute("select pg_stat_clear_snapshot()");
            try (var rows = sql.executeQuery("""
                    select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database()
                      and wait_event_type = 'Lock' and query ilike '%bs_rooms%' and query ilike '%for update%'
                    """)) {
                assertTrue(rows.next());
                assertTrue(rows.getBoolean(1));
            }
            gate.rollback();
            expect(pending.get(10, TimeUnit.SECONDS), 503, "SERVICE_UNAVAILABLE");
        }
        assertEquals(0, recorded(match));
        assertEquals(baseline, invalidations(room));
        assertEquals(0, state(match).path("game").path("revision").asLong());
        assertEquals(1, ok(post(path, "first", command)).path("revision").asLong());
    }

    @Test
    void returns503WhenPostgresBreaksADeadlockAndAcceptsTheRetry() throws Exception {
        UUID room = lobby(2);
        UUID match = start(room);
        String path = MATCHES + "/" + match + "/commands";
        String command = envelope("deadlock", 0, action("income"));
        try (var other = dataSource.getConnection(); var sql = other.createStatement();
             var holdMatch = other.prepareStatement("select id from public.bs_matches where id = ? for update");
             var lockRoom = other.prepareStatement("select id from public.bs_rooms where id = ? for update")) {
            other.setAutoCommit(false);
            sql.execute("set local deadlock_timeout = '4s'");
            final long deadlocks = deadlocks(sql);
            holdMatch.setObject(1, match);
            holdMatch.executeQuery().close();
            var pending = submit(() -> post(path, "first", command));
            long deadline = System.nanoTime() + Duration.ofMillis(2400).toNanos();
            boolean waiting = false;
            while (System.nanoTime() < deadline && !waiting) {
                sql.execute("select pg_stat_clear_snapshot()");
                try (var rows = sql.executeQuery("""
                        select exists(select 1 from pg_stat_activity where datname = current_database()
                          and wait_event_type = 'Lock' and query ilike '%for update of m%')
                        """)) {
                    waiting = rows.next() && rows.getBoolean(1);
                }
                if (!waiting) Thread.sleep(15);
            }
            assertTrue(waiting, "The Java request must hold the room and wait on the match");
            lockRoom.setObject(1, room);
            lockRoom.executeQuery().close();
            other.rollback();
            expect(pending.get(10, TimeUnit.SECONDS), 503, "SERVICE_UNAVAILABLE");
            assertEquals(deadlocks + 1, deadlocks(sql));
        }
        assertEquals(0, recorded(match));
        assertEquals(0, state(match).path("game").path("revision").asLong());
        assertEquals(1, ok(post(path, "first", command)).path("revision").asLong());
    }

    private static long deadlocks(java.sql.Statement sql) throws Exception {
        sql.execute("select pg_stat_clear_snapshot()");
        try (var rows = sql.executeQuery("select deadlocks from pg_stat_database where datname = current_database()")) {
            rows.next();
            return rows.getLong(1);
        }
    }

    @Test
    void resumesSevenCheckpointsAfterReplacingTheJavaProcess(@TempDir Path temp) throws Exception {
        int parentPort = port;
        var checkpoints = new ArrayList<Checkpoint>();
        Process original = null;
        Process restarted = null;
        try {
            original = startChild(temp.resolve("before.log"));
            UUID partialVote = start(lobby(3));
            apply(partialVote, "first", action("tax"));
            apply(partialVote, "second", vote(window(partialVote), "accept"));
            checkpoint(checkpoints, partialVote, "third", vote(window(partialVote), "accept"));

            UUID contest = start(lobby(3));
            apply(contest, "first", action("tax"));
            apply(contest, "second", vote(window(contest), "challenge"));
            checkpoint(checkpoints, contest, "third", vote(window(contest), "accept"));

            UUID broker = start(lobby(2));
            apply(broker, "first", action("negotiate"));
            apply(broker, "second", vote(window(broker), "accept"));
            var offer = view(broker, "first").path("choices");
            assertEquals(4, offer.size());
            assertTrue(view(broker, "second").path("choices").isEmpty());
            checkpoint(checkpoints, broker, "first", "{\"type\":\"negotiate\",\"keepIds\":["
                    + offer.get(0).get("id") + "," + offer.get(3).get("id") + "]}");

            UUID partialAck = start(lobby(2));
            apply(partialAck, "first", action("income"));
            apply(partialAck, "first", vote(window(partialAck), "acknowledge"));
            checkpoint(checkpoints, partialAck, "second", vote(window(partialAck), "acknowledge"));

            UUID loss = start(lobby(2));
            backstabToLoss(loss);
            checkpoint(checkpoints, loss, "second", loseChoice(loss));

            UUID victory = start(lobby(2));
            backstabToLoss(victory);
            apply(victory, "second", loseChoice(victory));
            assertEquals("finished", state(victory).path("game").path("phase").path("kind").asString());
            checkpoint(checkpoints, victory, "first", vote(window(victory), "acknowledge"));

            UUID rematch = start(lobby(2));
            finish(rematch);
            assertEquals(2, ok(post(MATCHES + "/" + rematch + "/rematch", "first", "{}")).path("round").asInt());
            checkpoint(checkpoints, rematch, "first", action("income"));

            long oldPid = original.pid();
            stopChild(original);
            restarted = startChild(temp.resolve("after.log"));
            assertNotEquals(oldPid, restarted.pid());
            for (var point : checkpoints) {
                assertEquals(point.state(), state(point.match()));
                assertEquals(point.first(), view(point.match(), "first"));
                assertEquals(point.second(), view(point.match(), "second"));
                long before = point.state().path("game").path("revision").asLong();
                assertEquals(before + 1, apply(point.match(), point.actor(), point.command()).path("revision").asLong());
                assertEquals(before + 1, state(point.match()).path("game").path("revision").asLong());
            }
            System.out.println("Recovered 7 PostgreSQL checkpoints across two independent Java process PIDs");
        } finally {
            try {
                stopChild(restarted);
                stopChild(original);
            } finally {
                port = parentPort;
            }
        }
    }

    private Process startChild(Path log) throws Exception {
        try (var socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        var java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
        var process = new ProcessBuilder(java, "-cp", System.getProperty("surefire.test.class.path"),
                "com.backstabber.BackstabberApplication", "--server.port=" + port)
                .redirectErrorStream(true).redirectOutput(log.toFile());
        configureChildProcess(process);
        var child = process.start();
        try {
            long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
            while (child.isAlive() && System.nanoTime() < deadline) {
                try {
                    if (request("GET", "/actuator/health/liveness", null, null).statusCode() == 200) return child;
                } catch (java.net.ConnectException starting) {
                    Thread.sleep(100);
                }
            }
            fail("Child Spring Boot process did not start: " + Files.readString(log));
            return child;
        } catch (Exception | AssertionError failure) {
            stopChild(child);
            throw failure;
        }
    }

    private static void stopChild(Process child) throws InterruptedException {
        if (child != null && child.isAlive()) {
            child.destroy();
            if (!child.waitFor(5, TimeUnit.SECONDS)) {
                child.destroyForcibly();
                assertTrue(child.waitFor(5, TimeUnit.SECONDS));
            }
        }
    }

    private void checkpoint(List<Checkpoint> points, UUID match, String actor, String command) throws Exception {
        points.add(new Checkpoint(match, state(match), view(match, "first"), view(match, "second"), actor, command));
    }

    private record Checkpoint(UUID match, JsonNode state, JsonNode first, JsonNode second, String actor, String command) {}

    private JsonNode view(UUID match, String actor) throws Exception {
        return ok(request("GET", MATCHES + "/" + match, actor, null));
    }

    private JsonNode apply(UUID match, String actor, String command) throws Exception {
        long revision = state(match).path("game").path("revision").asLong();
        return ok(post(MATCHES + "/" + match + "/commands", actor, envelope("step-" + revision, revision, command)));
    }

    private String window(UUID match) {
        return state(match).path("window").path("id").asString();
    }

    private String loseChoice(UUID match) throws Exception {
        return "{\"type\":\"lose\",\"cardId\":" + view(match, "second").path("choices").get(0).path("id") + "}";
    }

    private void backstabToLoss(UUID match) throws Exception {
        seedLastInfluence(match);
        apply(match, "first", "{\"type\":\"select-action\",\"action\":\"backstab\",\"targetId\":\"" + SECOND + "\"}");
        apply(match, "first", vote(window(match), "acknowledge"));
        apply(match, "second", vote(window(match), "acknowledge"));
    }

    private void seedLastInfluence(UUID match) {
        var setup = (tools.jackson.databind.node.ObjectNode) state(match);
        var game = (tools.jackson.databind.node.ObjectNode) setup.path("game");
        ((tools.jackson.databind.node.ObjectNode) game.path("players").get(0)).put("credits", 7);
        var victim = (tools.jackson.databind.node.ArrayNode) game.path("players").get(1).path("cards");
        ((tools.jackson.databind.node.ArrayNode) game.path("deck")).add(victim.remove(1));
        jdbc.update("update public.bs_matches set state = cast(? as jsonb) where id = ?", setup.toString(), match);
    }

    private void finish(UUID match) throws Exception {
        String path = MATCHES + "/" + match;
        seedLastInfluence(match);
        ok(post(path + "/commands", "first", envelope("final-backstab", 0,
                "{\"type\":\"select-action\",\"action\":\"backstab\",\"targetId\":\"" + SECOND + "\"}")));
        String window = state(match).path("window").path("id").asString();
        ok(post(path + "/commands", "first", envelope("ack-first", 1, vote(window, "acknowledge"))));
        ok(post(path + "/commands", "second", envelope("ack-second", 2, vote(window, "acknowledge"))));
        String card = state(match).path("game").path("players").get(1).path("cards").get(0).path("id").asString();
        expect(post(path + "/commands", "first", envelope("not-mine", 3, "{\"type\":\"lose\",\"cardId\":\"" + card + "\"}")),
                403, "NOT_AUTHORIZED");
        ok(post(path + "/commands", "second", envelope("lose", 3, "{\"type\":\"lose\",\"cardId\":\"" + card + "\"}")));
        expect(post(path + "/rematch", "first", "{}"), 409, "INVALID_PHASE");
        window = state(match).path("window").path("id").asString();
        ok(post(path + "/commands", "first", envelope("ack-victory", 4, vote(window, "acknowledge"))));
    }

    static String action(String name) {
        return "{\"type\":\"select-action\",\"action\":\"" + name + "\"}";
    }

    static String vote(String window, String kind) {
        return "{\"type\":\"vote\",\"windowId\":\"" + window + "\",\"choice\":{\"kind\":\"" + kind + "\"}}";
    }

    JsonNode state(UUID id) {
        return JSON.readTree(jdbc.queryForObject("select state::text from public.bs_matches where id = ?", String.class, id));
    }

    private int matchCount(UUID room) {
        return jdbc.queryForObject("select count(*) from public.bs_matches where room_id = ?", Integer.class, room);
    }

    private long recorded(UUID match) {
        return jdbc.queryForObject("select count(*) from public.bs_match_commands where match_id = ?", Long.class, match);
    }

    private long invalidations(UUID room) {
        return jdbc.queryForObject("""
                select count(*) from realtime.messages where topic = ? and event = 'invalidate'
                  and private and payload = '{"kind":"room"}'::jsonb
                """, Long.class, "room:" + room);
    }

    private UUID pendingInvite(UUID room) {
        return jdbc.queryForObject("""
                insert into public.bs_invites(room_id, sender_id, recipient_id) values (?, ?, ?) returning id
                """, UUID.class, room, FIRST, THIRD);
    }

    private String inviteStatus(UUID id) {
        return jdbc.queryForObject("select status from public.bs_invites where id = ?", String.class, id);
    }

    private void fault(String table, String operation, String sqlState) {
        jdbc.execute("""
                create function fixture_fail_match() returns trigger language plpgsql as $$
                  begin raise exception using errcode = '%s', message = 'fixture failure'; end
                $$
                """.formatted(sqlState));
        jdbc.execute("create trigger fixture_fail_match before " + operation + " on public." + table
                + " for each row execute function fixture_fail_match()");
    }

    private void clearFault(String table) {
        jdbc.execute("drop trigger fixture_fail_match on public." + table);
        jdbc.execute("drop function fixture_fail_match()");
    }

    private List<HttpResponse<String>> race(UUID room, String scenario, Request leader, Request follower) throws Exception {
        CompletableFuture<HttpResponse<String>> first;
        CompletableFuture<HttpResponse<String>> second;
        try (Connection lock = gate(room)) {
            first = submit(leader);
            awaitRoomWaiters(lock, 1);
            second = submit(follower);
            awaitRoomWaiters(lock, 2);
            System.out.println(scenario + ": pg_stat_activity confirmed two independent room-lock waiters");
            lock.rollback();
        }
        return List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
    }

    private Connection gate(UUID room) throws Exception {
        Connection gate = dataSource.getConnection();
        try (var sql = gate.prepareStatement("select id from public.bs_rooms where id = ? for update")) {
            gate.setAutoCommit(false);
            sql.setObject(1, room);
            sql.executeQuery().close();
            return gate;
        } catch (Exception failure) {
            gate.close();
            throw failure;
        }
    }

    private void awaitRoomWaiters(Connection observer, int expected) throws Exception {
        long deadline = System.nanoTime() + Duration.ofMillis(2600).toNanos();
        try (var sql = observer.createStatement()) {
            do {
                sql.execute("select pg_stat_clear_snapshot()");
                try (var rows = sql.executeQuery("""
                        select count(distinct pid) from pg_stat_activity where datname = current_database()
                          and state = 'active' and wait_event_type = 'Lock'
                          and query ilike '%bs_rooms%' and query ilike '%for update%'
                        """)) {
                    rows.next();
                    if (rows.getInt(1) == expected) return;
                }
                Thread.sleep(15);
            } while (System.nanoTime() < deadline);
        }
        fail("Expected " + expected + " PostgreSQL backends waiting for room locks");
    }

    private CompletableFuture<HttpResponse<String>> submit(Request request) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return request.send();
            } catch (Exception failure) {
                throw new java.util.concurrent.CompletionException(failure);
            }
        });
    }

    @FunctionalInterface
    private interface Request {
        HttpResponse<String> send() throws Exception;
    }

    UUID lobby(int capacity) throws Exception {
        var room = ok(post(ROOMS, "first", "{\"capacity\":" + capacity + "}"));
        String id = room.get("id").asString();
        String[] participants = {"first", "second", "third", "fourth"};
        for (int i = 0; i < capacity; i++) {
            if (i > 0) ok(post(ROOMS + "/join", participants[i], "{\"code\":\"" + room.get("code").asString() + "\"}"));
        }
        for (int i = 0; i < capacity; i++) ok(post(ROOMS + "/" + id + "/ready", participants[i], "{\"ready\":true}"));
        return UUID.fromString(id);
    }

    UUID start(UUID room) throws Exception {
        var started = ok(post(ROOMS + "/" + room + "/start", "first", "{}"));
        assertEquals("started", started.get("status").asString());
        return UUID.fromString(started.get("matchId").asString());
    }

    HttpResponse<String> post(String path, String token, String body) throws Exception {
        return request("POST", path, token, body);
    }

    static String envelope(String id, long revision, String command) {
        return """
                {"protocolVersion":1,"commandId":%s,"expectedRevision":%d,"command":%s}
                """.formatted(JSON.writeValueAsString(id), revision, command);
    }

    static JsonNode ok(HttpResponse<String> response) {
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body());
    }

    static void expect(HttpResponse<String> response, int status, String error) {
        assertEquals(status, response.statusCode(), response.body());
        assertEquals(error, JSON.readTree(response.body()).get("error").asString());
    }

    private record OnlineViews(JsonNode host, JsonNode guest) {}
}
