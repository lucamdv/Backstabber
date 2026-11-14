package com.backstabber;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatterBuilder;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.json.JSONObject;
import org.json.JSONException;
import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;

import static org.junit.jupiter.api.Assertions.*;

class InvitationTest extends SocialIntegrationTest {
    private static final String CODE = "ABCDEF0123";
    private static final String ACCEPT = "{\"accept\":true}";
    private static final String DECLINE = "{\"accept\":false}";

    @Test
    void sendsListsAndAcceptsWithCanonicalShapeAndRecipientIsolation() throws Exception {
        UUID room = createLobby(3);
        friend(FIRST, SECOND);
        int notifications = notificationCount();
        UUID invite = invite(room, SECOND);
        assertEquals(notifications + 2, notificationCount());
        assertEquals(List.of("user:" + FIRST, "user:" + SECOND), jdbc.queryForList("""
                select topic from realtime.messages where event = 'invalidate' and private
                  and payload = '{"kind":"social"}'::jsonb
                  and (topic = ? or topic = ?)
                group by topic having count(*) = 2 order by topic
                """, String.class, "user:" + FIRST, "user:" + SECOND));
        var createdAt = jdbc.queryForObject("select created_at from public.bs_invites where id = ?", Timestamp.class, invite);
        var expiresAt = jdbc.queryForObject("select expires_at from public.bs_invites where id = ?", Timestamp.class, invite);
        assertEquals(Duration.ofMinutes(15), Duration.between(createdAt.toInstant(), expiresAt.toInstant()));

        var recipientList = request("GET", "/api/v1/invites", "second", null);
        assertEquals(200, recipientList.statusCode(), recipientList.body());
        var sender = jdbc.queryForMap("select username, display_name, avatar_url, show_online from public.bs_profiles where user_id = ?", FIRST);
        var senderJson = new JSONObject()
                .put("id", FIRST.toString()).put("username", sender.get("username"))
                .put("displayName", sender.get("display_name"))
                .put("avatarUrl", sender.get("avatar_url") == null ? JSONObject.NULL : sender.get("avatar_url"))
                .put("showOnline", sender.get("show_online"));
        String iso = new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(expiresAt.toInstant());
        JSONAssert.assertEquals("""
                [{"id":"%s","roomId":"%s","from":%s,"status":"pending","expiresAt":"%s"}]
                """.formatted(invite, room, senderJson, iso), recipientList.body(), true);
        JSONAssert.assertEquals("[]", request("GET", "/api/v1/invites", "first", null).body(), true);
        assertError(404, "INVITE_NOT_FOUND", respond(invite, "third", ACCEPT));

        jdbc.update("update public.bs_room_members set ready = true where room_id = ?", room);
        var accepted = respond(invite, "second", ACCEPT);
        assertEquals(200, accepted.statusCode(), accepted.body());
        var snapshot = request("GET", "/api/v1/rooms/" + room, "second", null);
        JSONAssert.assertEquals(snapshot.body(), accepted.body(), true);
        assertEquals("accepted", status(invite));
        assertEquals(2, members(room));
        assertEquals(0, jdbc.queryForObject("select count(*) from public.bs_room_members where room_id = ? and ready", Integer.class, room));
        assertError(404, "INVITE_NOT_FOUND", respond(invite, "second", ACCEPT));
    }

    @Test
    void declineDoesNotJoinAndAClosedRoomDoesNotRevealInvitations() throws Exception {
        UUID room = createLobby(3);
        friend(FIRST, SECOND);
        UUID invite = invite(room, SECOND);
        var response = respond(invite, "second", DECLINE);
        assertEquals(200, response.statusCode(), response.body());
        JSONAssert.assertEquals("{\"status\":\"declined\"}", response.body(), true);
        assertEquals(1, members(room));
        assertEquals("declined", status(invite));

        UUID pending = invite(room, SECOND);
        var closed = request("POST", "/api/v1/rooms/" + room + "/close", "first", "{}");
        assertEquals(200, closed.statusCode(), closed.body());
        JSONAssert.assertEquals("[]", request("GET", "/api/v1/invites", "second", null).body(), true);
        assertEquals("expired", status(pending));
        assertError(404, "INVITE_NOT_FOUND", respond(pending, "second", ACCEPT));
        assertError(409, "ROOM_NOT_OPEN", send(room, "first", SECOND));
    }

    @Test
    void rejectsInvalidSendersTargetsAndDuplicatePendingInvites() throws Exception {
        UUID room = createLobby(2);
        assertError(404, "ROOM_NOT_FOUND", send(room, "third", SECOND));
        assertError(403, "FRIEND_REQUIRED", send(room, "first", SECOND));
        friend(FIRST, SECOND);
        friend(FIRST, THIRD);
        UUID invite = invite(room, SECOND);
        assertError(409, "INVITE_EXISTS", send(room, "first", SECOND));
        assertError(400, "INVALID_BOOLEAN", respond(invite, "second", "{\"accept\":\"true\"}"));
        assertError(400, "INVALID_ID", request("POST", "/api/v1/invites/not-a-uuid/respond", "second", ACCEPT));
        assertEquals(200, respond(invite, "second", ACCEPT).statusCode());
        assertError(409, "ALREADY_IN_ROOM", send(room, "first", SECOND));
        assertError(409, "ROOM_FULL", send(room, "first", THIRD));
    }

    @Test
    void hidesExpiredInvitesAndReplacesThemWithoutDuplicatePendingRows() throws Exception {
        UUID room = createLobby(3);
        friend(FIRST, SECOND);
        UUID expired = invite(room, SECOND);
        jdbc.update("update public.bs_invites set expires_at = now() - interval '1 second' where id = ?", expired);
        JSONAssert.assertEquals("[]", request("GET", "/api/v1/invites", "second", null).body(), true);
        assertError(404, "INVITE_NOT_FOUND", respond(expired, "second", ACCEPT));
        UUID replacement = invite(room, SECOND);
        assertNotEquals(expired, replacement);
        assertEquals("expired", status(expired));
        assertEquals("pending", status(replacement));
    }

    @Test
    void acceptanceInAnEffectivelyClosedRoomKeepsAnUnexpiredInvitePending() throws Exception {
        UUID room = createLobby(3);
        friend(FIRST, SECOND);
        UUID invite = invite(room, SECOND);
        // An expired lobby is closed for reads before any mutation persists the status.
        jdbc.update("update public.bs_rooms set expires_at = now() - interval '1 second' where id = ?", room);

        JSONAssert.assertEquals("[]", request("GET", "/api/v1/invites", "second", null).body(), true);
        assertError(409, "ROOM_NOT_OPEN", respond(invite, "second", ACCEPT));
        assertEquals("pending", status(invite));
        assertEquals(1, members(room));
    }

    @Test
    void rollsBackTheInvitationUpdateIfTheRoomHasNoRemainingSeat() throws Exception {
        UUID room = createLobby(2);
        friend(FIRST, SECOND);
        UUID invite = invite(room, SECOND);
        jdbc.update("insert into public.bs_room_members(room_id, user_id) values (?, ?)", room, THIRD);
        int notifications = notificationCount();
        assertError(409, "ROOM_FULL", respond(invite, "second", ACCEPT));
        assertEquals("pending", status(invite));
        assertEquals(notifications, notificationCount());
        assertEquals(2, members(room));
        assertEquals(0, jdbc.queryForObject("select count(*) from public.bs_room_members where room_id = ? and user_id = ?",
                Integer.class, room, SECOND));
    }

    @Test
    void concurrentAcceptanceCannotConsumeTheSameInvitationTwice() throws Exception {
        UUID room = createLobby(3);
        friend(FIRST, SECOND);
        UUID invite = invite(room, SECOND);
        var responses = raceUnderRoomLock(room, () -> respond(invite, "second", ACCEPT), () -> respond(invite, "second", ACCEPT));
        assertTrue(responses.get(0).statusCode() == 200 || responses.get(1).statusCode() == 200);
        assertError(404, "INVITE_NOT_FOUND", responses.get(0).statusCode() == 200 ? responses.get(1) : responses.get(0));
        assertEquals("accepted", status(invite));
        assertEquals(2, members(room));
    }

    @Test
    void concurrentInvitesCompeteForLastSeatAndLosingInviteStaysPending() throws Exception {
        UUID room = createLobby(2);
        friend(FIRST, SECOND);
        friend(FIRST, THIRD);
        UUID second = invite(room, SECOND);
        UUID third = invite(room, THIRD);
        var responses = raceUnderRoomLock(room, () -> respond(second, "second", ACCEPT), () -> respond(third, "third", ACCEPT));
        boolean secondWon = responses.get(0).statusCode() == 200;
        assertEquals(200, responses.get(secondWon ? 0 : 1).statusCode());
        assertError(409, "ROOM_FULL", responses.get(secondWon ? 1 : 0));
        assertEquals("accepted", status(secondWon ? second : third));
        assertEquals("pending", status(secondWon ? third : second));
        assertEquals(2, members(room));
    }

    @Test
    void concurrentAcceptanceAndCloseAreSerializedWithoutPartialState() throws Exception {
        UUID room = createLobby(3);
        friend(FIRST, SECOND);
        UUID invite = invite(room, SECOND);
        var responses = raceUnderRoomLock(room, () -> respond(invite, "second", ACCEPT),
                () -> request("POST", "/api/v1/rooms/" + room + "/close", "first", "{}"));
        assertEquals(200, responses.get(1).statusCode(), responses.get(1).body());
        assertEquals("closed", jdbc.queryForObject("select status from public.bs_rooms where id = ?", String.class, room));
        if (responses.get(0).statusCode() == 200) {
            assertEquals("accepted", status(invite));
            assertEquals(2, members(room));
        } else {
            assertError(404, "INVITE_NOT_FOUND", responses.get(0));
            assertEquals("expired", status(invite));
            assertEquals(1, members(room));
        }
    }

    private UUID createLobby(int capacity) {
        UUID room = jdbc.queryForObject("insert into public.bs_rooms(code, host_id, capacity) values (?, ?, ?) returning id",
                UUID.class, CODE, FIRST, capacity);
        jdbc.update("insert into public.bs_room_members(room_id, user_id) values (?, ?)", room, FIRST);
        return room;
    }

    private void friend(UUID a, UUID b) {
        jdbc.update("insert into public.bs_friends(user_a, user_b) values (least(?::uuid, ?::uuid), greatest(?::uuid, ?::uuid))",
                a, b, a, b);
    }

    private UUID invite(UUID room, UUID target) throws Exception {
        var result = send(room, "first", target);
        assertEquals(200, result.statusCode(), result.body());
        UUID invite = UUID.fromString(new JSONObject(result.body()).getString("id"));
        JSONAssert.assertEquals("{\"id\":\"" + invite + "\"}", result.body(), true);
        return invite;
    }

    private HttpResponse<String> send(UUID room, String token, UUID target) throws Exception {
        return request("POST", "/api/v1/rooms/" + room + "/invite", token, "{\"userId\":\"" + target + "\"}");
    }

    private HttpResponse<String> respond(UUID invite, String token, String body) throws Exception {
        return request("POST", "/api/v1/invites/" + invite + "/respond", token, body);
    }

    private String status(UUID invite) {
        return jdbc.queryForObject("select status from public.bs_invites where id = ?", String.class, invite);
    }

    private int members(UUID room) {
        return jdbc.queryForObject("select count(*) from public.bs_room_members where room_id = ?", Integer.class, room);
    }

    private int notificationCount() {
        return jdbc.queryForObject("select count(*) from realtime.messages", Integer.class);
    }

    private static void assertError(int status, String code, HttpResponse<String> response) throws JSONException {
        assertEquals(status, response.statusCode(), response.body());
        JSONAssert.assertEquals("{\"error\":\"" + code + "\"}", response.body(), true);
    }

    private List<HttpResponse<String>> raceUnderRoomLock(UUID room, Callable<HttpResponse<String>> first,
            Callable<HttpResponse<String>> second) throws Exception {
        try (var workers = Executors.newFixedThreadPool(2); Connection blocker = dataSource.getConnection()) {
            blocker.setAutoCommit(false);
            try (var lock = blocker.prepareStatement("select id from public.bs_rooms where id = ? for update")) {
                lock.setObject(1, room);
                try (var result = lock.executeQuery()) {
                    assertTrue(result.next());
                }
            }
            var a = workers.submit(first);
            var b = workers.submit(second);
            try {
                awaitTwoContendingBackends(blocker);
            } finally {
                blocker.rollback();
            }
            return List.of(a.get(8, TimeUnit.SECONDS), b.get(8, TimeUnit.SECONDS));
        }
    }

    private void awaitTwoContendingBackends(Connection blocker) throws Exception {
        var deadline = Instant.now().plusMillis(2300);
        try (var observer = blocker.createStatement()) {
            do {
                // Reuse the blocker connection so the three-slot application pool cannot hide the wait.
                observer.execute("select pg_stat_clear_snapshot()");
                try (var result = observer.executeQuery("""
                    select count(distinct pid) from pg_stat_activity
                    where datname = current_database() and state = 'active' and wait_event_type = 'Lock'
                      and query ilike '%bs_rooms%' and query ilike '%for update%'
                    """)) {
                    if (result.next() && result.getInt(1) >= 2) return;
                }
                Thread.sleep(20);
            } while (Instant.now().isBefore(deadline));
        }
        fail("Two independent HTTP PostgreSQL connections never contested the room row lock");
    }
}
