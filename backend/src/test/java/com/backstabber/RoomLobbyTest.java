package com.backstabber;

import com.backstabber.api.ApiFailure;
import com.backstabber.lobby.RoomService;
import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RoomLobbyTest extends SocialIntegrationTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String ROOT = "/api/v1/rooms";

    @Autowired
    private RoomService rooms;

    @Test
    void createsCanonicalSnapshotsAndOnlyListsMemberRooms() throws Exception {
        JsonNode room = create("first", "2.0");
        UUID id = roomId(room);
        String code = room.get("code").asText();
        assertTrue(code.matches("[0-9A-F]{10}"));
        JSONAssert.assertEquals("""
                {"id":"%s","code":"%s","hostId":"%s","capacity":2,"status":"lobby","matchId":null,
                 "canStart":false,"members":[{"id":"%s","username":"first_profile","displayName":"Perfil de São Luís",
                 "avatarUrl":null,"showOnline":false,"ready":false,"connected":true}]}
                """.formatted(id, code, FIRST, FIRST), room.toString(), true);
        JsonNode larger = create("first", "10");
        assertNotEquals(code, larger.get("code").asText());
        assertEquals(10, larger.get("capacity").asInt());
        JsonNode list = expectOk(request("GET", ROOT, "first", null));
        assertEquals(larger.get("id"), list.get(0).get("id"));
        assertEquals(room.get("id"), list.get(1).get("id"));
        assertEquals(JSON.readTree("[]"), expectOk(request("GET", ROOT, "second", null)));
        assertError(request("GET", path(id), "second", null), 404, "ROOM_NOT_FOUND");
        assertError(request("GET", ROOT + "/not-a-uuid", "first", null), 400, "INVALID_ID");
    }

    @Test
    void rejectsInvalidCapacitiesAndMissingProfiles() throws Exception {
        for (String capacity : List.of("1", "11", "2.5", "\"3\"", "null", "true", "10000000000000")) {
            assertError(request("POST", ROOT, "first", "{\"capacity\":" + capacity + "}"), 400, "INVALID_CAPACITY");
        }
        assertError(request("POST", ROOT, "missing", "{\"capacity\":4}"), 409, "PROFILE_REQUIRED");
        assertError(request("POST", ROOT + "/join", "first", "{\"code\":false}"), 400, "INVALID_ROOM_CODE");
        assertError(request("POST", ROOT + "/join", "first", "{\"code\":\"0000000000\"}"), 404, "ROOM_NOT_FOUND");
    }

    @Test
    void retriesCodeGenerationThreeTimesAndDoesNotInsertAHostOnCollision() throws Exception {
        // A test-only trigger pins every generated code to a value already in the unique index.
        jdbc.execute("insert into public.bs_rooms (code, host_id, capacity) values ('ABCD000000', '" + FIRST + "', 2)");
        jdbc.execute("create sequence public.bs_test_collision_count");
        jdbc.execute("""
                create function public.bs_test_force_collision() returns trigger language plpgsql as $$
                begin
                  perform nextval('public.bs_test_collision_count');
                  new.code := 'ABCD000000';
                  return new;
                end $$;
                create trigger bs_test_force_collision before insert on public.bs_rooms
                  for each row execute function public.bs_test_force_collision();
                """);
        try {
            assertError(request("POST", ROOT, "first", "{\"capacity\":2}"), 503, "ROOM_CODE_UNAVAILABLE");
            assertEquals(3L, jdbc.queryForObject("select last_value from public.bs_test_collision_count", Long.class));
            assertEquals(1, jdbc.queryForObject("select count(*) from public.bs_rooms", Integer.class));
            assertEquals(0, jdbc.queryForObject("select count(*) from public.bs_room_members", Integer.class));
        } finally {
            jdbc.execute("drop trigger bs_test_force_collision on public.bs_rooms");
            jdbc.execute("drop function public.bs_test_force_collision()");
            jdbc.execute("drop sequence public.bs_test_collision_count");
        }
    }

    @Test
    void preservesReadinessOnReentryAndResetsItWhenCompositionChanges() throws Exception {
        JsonNode created = create("first", "3");
        UUID id = roomId(created);
        String code = created.get("code").asText();
        try (Connection first = dataSource.getConnection(); Connection second = dataSource.getConnection();
                Connection third = dataSource.getConnection()) {
            assertTrue(first.isValid(1) && second.isValid(1) && third.isValid(1));
        }
        assertError(join("missing", code), 409, "PROFILE_REQUIRED");
        expectOk(join("second", "  " + code.toLowerCase(java.util.Locale.ROOT) + "  "));
        expectOk(post(id, "ready", "first", "{\"ready\":true,\"userId\":\"" + SECOND + "\"}"));
        assertFalse(member(expectOk(request("GET", path(id), "first", null)), SECOND).get("ready").asBoolean());
        assertTrue(expectOk(post(id, "ready", "second", "{\"ready\":true}")).get("canStart").asBoolean());
        JsonNode rejoined = expectOk(join("second", code));
        assertEquals(2, rejoined.get("members").size());
        assertTrue(rejoined.get("canStart").asBoolean());
        JsonNode joined = expectOk(join("third", code));
        assertEquals(3, joined.get("members").size());
        assertFalse(joined.get("canStart").asBoolean());
        assertFalse(member(joined, FIRST).get("ready").asBoolean());
        assertFalse(member(joined, SECOND).get("ready").asBoolean());
        assertError(join("fourth", code), 409, "ROOM_FULL");
        assertEquals(joined, expectOk(join("second", code)));
    }

    @Test
    void enforcesPrivateMembershipBeforeValidationAndRefreshesOnlyOwnConnectivity() throws Exception {
        JsonNode created = create("first", "2");
        UUID id = roomId(created);
        expectOk(join("second", created.get("code").asText()));
        for (String mutation : List.of("ready", "heartbeat", "leave", "close")) {
            assertError(post(id, mutation, "third", "{}"), 404, "ROOM_NOT_FOUND");
        }
        assertError(post(id, "ready", "first", "{\"ready\":\"true\"}"), 400, "INVALID_BOOLEAN");
        expectOk(post(id, "ready", "first", "{\"ready\":true}"));
        expectOk(post(id, "ready", "second", "{\"ready\":true}"));
        jdbc.update("update public.bs_room_members set last_seen = now() - interval '36 seconds' where room_id = ? and user_id = ?",
                id, SECOND);
        JsonNode offline = expectOk(post(id, "heartbeat", "first", "{\"userId\":\"" + SECOND + "\"}"));
        assertFalse(member(offline, SECOND).get("connected").asBoolean());
        assertTrue(member(offline, SECOND).get("ready").asBoolean());
        assertFalse(offline.get("canStart").asBoolean());
        JsonNode online = expectOk(post(id, "heartbeat", "second", "{}"));
        assertTrue(member(online, SECOND).get("connected").asBoolean());
        assertTrue(online.get("canStart").asBoolean());
    }

    @Test
    void transfersHostByOldestMembershipThenUuidAndClosesEmptyLobby() throws Exception {
        JsonNode created = create("first", "3");
        UUID id = roomId(created);
        String code = created.get("code").asText();
        expectOk(join("third", code));
        expectOk(join("second", code));
        jdbc.update("update public.bs_room_members set joined_at = now(), ready = true where room_id = ?", id);
        UUID sent = invite(id, FIRST, FOURTH);
        UUID retained = invite(id, SECOND, FIRST);
        assertEquals(JSON.readTree("{\"ok\":true}"), expectOk(post(id, "leave", "first", "{}")));
        JsonNode transferred = expectOk(request("GET", path(id), "second", null));
        assertEquals(SECOND.toString(), transferred.get("hostId").asText());
        assertEquals(SECOND.toString(), transferred.get("members").get(0).get("id").asText());
        assertFalse(member(transferred, SECOND).get("ready").asBoolean());
        assertEquals("expired", inviteStatus(sent));
        assertEquals("pending", inviteStatus(retained));
        assertError(post(id, "close", "first", "{}"), 404, "ROOM_NOT_FOUND");
        expectOk(post(id, "leave", "third", "{}"));
        expectOk(post(id, "leave", "second", "{}"));
        assertEquals("closed", jdbc.queryForObject("select status from public.bs_rooms where id = ?", String.class, id));
        assertEquals(0, jdbc.queryForObject("select count(*) from public.bs_room_members where room_id = ?", Integer.class, id));
        assertEquals("expired", inviteStatus(retained));
    }

    @Test
    void expiredLobbyRemainsVisibleToMembersOnlyAndDoesNotRefreshHeartbeat() throws Exception {
        JsonNode created = create("first", "2");
        UUID id = roomId(created);
        jdbc.update("update public.bs_rooms set expires_at = now() - interval '1 second' where id = ?", id);
        jdbc.update("update public.bs_room_members set last_seen = now() - interval '60 seconds' where room_id = ?", id);
        assertEquals(JSON.readTree("[]"), expectOk(request("GET", ROOT, "first", null)));
        JsonNode stale = expectOk(post(id, "heartbeat", "first", "{}"));
        assertEquals("closed", stale.get("status").asText());
        assertFalse(member(stale, FIRST).get("connected").asBoolean());
        assertError(post(id, "ready", "first", "{\"ready\":true}"), 409, "ROOM_NOT_OPEN");
        assertError(join("second", created.get("code").asText()), 409, "ROOM_NOT_OPEN");
        assertError(request("GET", path(id), "second", null), 404, "ROOM_NOT_FOUND");
    }

    @Test
    void closesAsHostAndKeepsStartedMatchWhenClosedAfterAbandonment() throws Exception {
        JsonNode created = create("first", "2");
        UUID id = roomId(created);
        expectOk(join("second", created.get("code").asText()));
        UUID pending = invite(id, FIRST, THIRD);
        assertError(post(id, "close", "second", "{}"), 403, "HOST_REQUIRED");
        assertEquals("closed", expectOk(post(id, "close", "first", "{}")).get("status").asText());
        assertEquals("expired", inviteStatus(pending));

        JsonNode running = create("first", "2");
        UUID runningId = roomId(running);
        expectOk(join("second", running.get("code").asText()));
        UUID match = jdbc.queryForObject("insert into public.bs_matches (room_id, state) values (?, '{}'::jsonb) returning id",
                UUID.class, runningId);
        jdbc.update("update public.bs_rooms set status = 'started' where id = ?", runningId);
        assertError(post(runningId, "close", "second", "{}"), 403, "HOST_REQUIRED");
        assertError(join("second", running.get("code").asText()), 409, "ROOM_NOT_OPEN");
        jdbc.update("update public.bs_room_members set last_seen = now() - interval '301 seconds' where room_id = ? and user_id = ?",
                runningId, FIRST);
        JsonNode closed = expectOk(post(runningId, "close", "second", "{}"));
        assertEquals("closed", closed.get("status").asText());
        assertEquals(match.toString(), closed.get("matchId").asText());
        assertEquals(match, jdbc.queryForObject("select id from public.bs_matches where room_id = ?", UUID.class, runningId));
    }

    @Test
    void validatesStartInsideTransactionWithoutPublishingAFakeMatch() throws Exception {
        JsonNode created = create("first", "2");
        UUID id = roomId(created);
        expectOk(join("second", created.get("code").asText()));
        var tx = new TransactionTemplate(transactions);
        assertEquals("HOST_REQUIRED", assertThrows(ApiFailure.class,
                () -> tx.execute(status -> rooms.validateStart(SECOND, id))).getMessage());
        assertEquals("ROOM_NOT_READY", assertThrows(ApiFailure.class,
                () -> tx.execute(status -> rooms.validateStart(FIRST, id))).getMessage());
        expectOk(post(id, "ready", "first", "{\"ready\":true}"));
        expectOk(post(id, "ready", "second", "{\"ready\":true}"));
        var candidate = tx.execute(status -> rooms.validateStart(FIRST, id));
        assertTrue(candidate.canStart());
        assertEquals("lobby", candidate.status());
        assertNull(candidate.matchId());
        assertEquals(0, jdbc.queryForObject("select count(*) from public.bs_matches where room_id = ?", Integer.class, id));
        assertTrue(expectOk(post(id, "start", "first", "{}")).get("matchId").isTextual());
    }

    @Test
    void serializesTwoRequestsForTheLastSeatUsingIndependentDatabaseConnections() throws Exception {
        JsonNode created = create("first", "2");
        UUID id = roomId(created);
        String code = created.get("code").asText();
        CompletableFuture<HttpResponse<String>> second;
        CompletableFuture<HttpResponse<String>> third;
        try (Connection gate = dataSource.getConnection(); var statement = gate.prepareStatement(
                "select id from public.bs_rooms where id = ? for update")) {
            gate.setAutoCommit(false);
            statement.setObject(1, id);
            statement.executeQuery().close();
            try {
                second = concurrentJoin("second", code);
                third = concurrentJoin("third", code);
                awaitJoinLockWaiters(gate);
            } finally {
                gate.rollback();
            }
        }
        var left = second.get(10, TimeUnit.SECONDS);
        var right = third.get(10, TimeUnit.SECONDS);
        assertEquals(List.of(200, 409), java.util.stream.Stream.of(left, right).map(HttpResponse::statusCode).sorted().toList());
        assertError(left.statusCode() == 409 ? left : right, 409, "ROOM_FULL");
        JsonNode finalRoom = expectOk(request("GET", path(id), "first", null));
        assertEquals(2, finalRoom.get("members").size());
        assertTrue(jdbc.queryForObject("""
                select exists (select 1 from realtime.messages where topic = ? and event = 'invalidate'
                  and private and payload = '{"kind":"room"}'::jsonb)
                """, Boolean.class, "room:" + id));
    }

    private void awaitJoinLockWaiters(Connection observer) throws InterruptedException, SQLException {
        long deadline = System.nanoTime() + Duration.ofMillis(2700).toNanos();
        try (var sql = observer.createStatement()) {
            while (System.nanoTime() < deadline) {
                sql.execute("select pg_stat_clear_snapshot()");
                try (var rows = sql.executeQuery("""
                        select count(distinct pid) from pg_stat_activity where datname = current_database()
                          and state = 'active' and wait_event_type = 'Lock'
                          and query ilike '%bs_rooms%' and query ilike '%for update%'
                        """)) {
                    rows.next();
                    if (rows.getInt(1) == 2) {
                        System.out.println("Lobby last seat: two distinct PostgreSQL backends waiting for the room lock");
                        return;
                    }
                }
                Thread.sleep(15);
            }
        }
        throw new AssertionError("PostgreSQL did not observe two concurrent room lock waiters.");
    }

    private CompletableFuture<HttpResponse<String>> concurrentJoin(String token, String code) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return join(token, code);
            } catch (Exception failure) {
                throw new CompletionException(failure);
            }
        });
    }

    private JsonNode create(String token, String capacity) throws Exception {
        return expectOk(request("POST", ROOT, token, "{\"capacity\":" + capacity + "}"));
    }

    private HttpResponse<String> join(String token, String code) throws Exception {
        return request("POST", ROOT + "/join", token, "{\"code\":\"" + code + "\"}");
    }

    private HttpResponse<String> post(UUID room, String operation, String token, String body) throws Exception {
        return request("POST", path(room) + "/" + operation, token, body);
    }

    private UUID invite(UUID room, UUID sender, UUID recipient) {
        return jdbc.queryForObject("insert into public.bs_invites (room_id, sender_id, recipient_id) values (?, ?, ?) returning id",
                UUID.class, room, sender, recipient);
    }

    private String inviteStatus(UUID id) {
        return jdbc.queryForObject("select status from public.bs_invites where id = ?", String.class, id);
    }

    private static String path(UUID room) {
        return ROOT + "/" + room;
    }

    private static UUID roomId(JsonNode room) {
        return UUID.fromString(room.get("id").asText());
    }

    private static JsonNode member(JsonNode room, UUID id) {
        for (JsonNode member : room.get("members")) {
            if (id.toString().equals(member.get("id").asText())) return member;
        }
        throw new AssertionError("Member missing: " + id);
    }

    private static JsonNode expectOk(HttpResponse<String> response) {
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body());
    }

    private static void assertError(HttpResponse<String> response, int status, String code) throws Exception {
        assertEquals(status, response.statusCode(), response.body());
        JSONAssert.assertEquals("{\"error\":\"" + code + "\"}", response.body(), true);
    }
}
