package com.backstabber;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.json.JSONException;
import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FriendshipTest extends SocialIntegrationTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String EMPTY = """
            {"friends":[],"requests":[]}
            """;

    @Test
    void listsOnlyOwnPendingRequestsInCreationOrderWithExactProfileProjection() throws Exception {
        UUID older = create("first", SECOND);
        UUID newer = create("third", FIRST);
        jdbc.update("update public.bs_friend_requests set created_at = now() - interval '1 day' where id = ?", older);
        assertJson(200, """
                {"friends":[],"requests":[
                  {"id":"%s","from":%s,"to":%s,"status":"pending"},
                  {"id":"%s","from":%s,"to":%s,"status":"pending"}
                ]}
                """.formatted(newer, profile(THIRD, true), profile(FIRST, false),
                        older, profile(FIRST, false), profile(SECOND, true)),
                request("GET", "/api/v1/friends", "first", null));
        assertJson(200, """
                {"friends":[],"requests":[{"id":"%s","from":%s,"to":%s,"status":"pending"}]}
                """.formatted(older, profile(FIRST, false), profile(SECOND, true)),
                request("GET", "/api/v1/friends", "second", null));
        assertJson(200, EMPTY, request("GET", "/api/v1/friends", "fourth", null));
        assertJson(200, EMPTY, request("GET", "/api/v1/friends", "missing", null));
    }

    @Test
    void rejectsSelfMissingInvalidDuplicateAndReverseRequests() throws Exception {
        assertError(400, "INVALID_FRIEND_TARGET", send("first", FIRST));
        assertError(404, "PROFILE_NOT_FOUND", send("first", MISSING));
        assertError(404, "PROFILE_NOT_FOUND", send("missing", FIRST));
        assertError(400, "INVALID_ID", request("POST", "/api/v1/friends/requests", "first", """
                {"userId":"not-a-uuid"}
                """));
        create("first", SECOND);
        assertError(409, "FRIEND_REQUEST_EXISTS", send("first", SECOND));
        assertError(409, "FRIEND_REQUEST_EXISTS", send("second", FIRST));
        assertEquals(1, count("bs_friend_requests"));
    }

    @Test
    void acceptsOnlyByRecipientAndDeclinesWithoutCreatingFriendship() throws Exception {
        UUID accepted = create("second", FIRST);
        assertError(404, "FRIEND_REQUEST_NOT_FOUND", respond("second", accepted, true));
        assertError(404, "FRIEND_REQUEST_NOT_FOUND", respond("third", accepted, true));
        assertError(400, "INVALID_BOOLEAN", request("POST", responsePath(accepted), "first", """
                {"accept":"true"}
                """));
        assertError(400, "INVALID_ID", request("POST", "/api/v1/friends/requests/123/respond", "first", "{}"));
        assertJson(200, "{\"status\":\"accepted\"}", respond("first", accepted, true));
        assertError(404, "FRIEND_REQUEST_NOT_FOUND", respond("first", accepted, false));
        assertError(409, "ALREADY_FRIENDS", send("first", SECOND));
        assertEquals(FIRST, jdbc.queryForObject("select user_a from public.bs_friends", UUID.class));
        assertEquals(SECOND, jdbc.queryForObject("select user_b from public.bs_friends", UUID.class));

        UUID declined = create("third", FIRST);
        assertJson(200, "{\"status\":\"declined\"}", respond("first", declined, false));
        assertEquals(1, count("bs_friends"));
        assertJson(200, EMPTY, request("GET", "/api/v1/friends", "third", null));
        create("first", THIRD); // A declined request does not block a later request.
    }

    @Test
    void preservesNullablePresenceOrderAndBilateralIdempotentRemoval() throws Exception {
        assertJson(200, "{\"status\":\"accepted\"}", respond("first", create("third", FIRST), true));
        assertJson(200, "{\"status\":\"accepted\"}", respond("second", create("first", SECOND), true));
        jdbc.update("update public.bs_profiles set show_online = true, last_seen = now() - interval '45 seconds' where user_id = ?", SECOND);
        jdbc.update("update public.bs_profiles set show_online = false, last_seen = now() where user_id = ?", THIRD);
        assertJson(200, """
                {"friends":[%s,%s],"requests":[]}
                """.formatted(onlineProfile(SECOND, true, false), onlineProfile(THIRD, false, null)),
                request("GET", "/api/v1/friends", "first", null));
        jdbc.update("update public.bs_profiles set last_seen = now() where user_id = ?", SECOND);
        assertJson(200, """
                {"friends":[%s,%s],"requests":[]}
                """.formatted(onlineProfile(SECOND, true, true), onlineProfile(THIRD, false, null)),
                request("GET", "/api/v1/friends", "first", null));

        assertError(400, "INVALID_ID", request("DELETE", "/api/v1/friends/not-a-uuid", "second", null));
        for (int attempt = 0; attempt < 2; attempt++) {
            assertJson(200, "{\"ok\":true}", request("DELETE", "/api/v1/friends/" + FIRST, "second", null));
        }
        assertJson(200, EMPTY, request("GET", "/api/v1/friends", "second", null));
        assertJson(200, """
                {"friends":[%s],"requests":[]}
                """.formatted(onlineProfile(THIRD, false, null)),
                request("GET", "/api/v1/friends", "first", null));
        assertEquals(1, count("bs_friends"));
        assertEquals(2, count("bs_friend_requests"));
    }

    @Test
    void concurrentOppositeRequestsProduceOnePendingRow() throws Exception {
        var responses = race(() -> send("first", SECOND), () -> send("second", FIRST));
        assertEquals(List.of(200, 409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        UUID id = successfulId(responses.stream().filter(response -> response.statusCode() == 200).findFirst().orElseThrow());
        assertError(409, "FRIEND_REQUEST_EXISTS", responses.stream().filter(response -> response.statusCode() == 409).findFirst().orElseThrow());
        assertEquals(id, jdbc.queryForObject("select id from public.bs_friend_requests where status = 'pending'", UUID.class));
        assertEquals(1, count("bs_friend_requests"));
    }

    @Test
    void concurrentResponsesToTheSameRequestApplyOnlyOneTransition() throws Exception {
        UUID id = create("second", FIRST);
        var responses = race(() -> respond("first", id, true), () -> respond("first", id, false));
        assertEquals(List.of(200, 404), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        var accepted = responses.get(0).statusCode() == 200;
        assertJson(200, accepted ? "{\"status\":\"accepted\"}" : "{\"status\":\"declined\"}",
                responses.get(accepted ? 0 : 1));
        assertError(404, "FRIEND_REQUEST_NOT_FOUND", responses.get(accepted ? 1 : 0));
        assertEquals(accepted ? "accepted" : "declined",
                jdbc.queryForObject("select status from public.bs_friend_requests where id = ?", String.class, id));
        assertEquals(accepted ? 1 : 0, count("bs_friends"));
    }

    @Test
    void existingTriggersPublishPrivateInvalidationsOnlyForTheTwoAccounts() throws Exception {
        int messagesBefore = jdbc.queryForObject("select count(*) from realtime.messages", Integer.class);
        create("first", SECOND);
        assertEquals(messagesBefore + 2, jdbc.queryForObject("select count(*) from realtime.messages", Integer.class));
        var notifications = jdbc.queryForList("""
                select topic from realtime.messages
                where private and event = 'invalidate' and payload = '{"kind":"social"}'::jsonb
                order by topic
                """, String.class);
        assertEquals(List.of("user:" + FIRST, "user:" + SECOND), notifications);
    }

    private List<HttpResponse<String>> race(
            Callable<HttpResponse<String>> first, Callable<HttpResponse<String>> second) throws Exception {
        try (var pool = Executors.newFixedThreadPool(2); Connection lock = dataSource.getConnection()) {
            lock.setAutoCommit(false);
            try (var statement = lock.prepareStatement("select user_id from public.bs_profiles where user_id = ? for update")) {
                statement.setObject(1, FIRST);
                try (var locked = statement.executeQuery()) {
                    assertTrue(locked.next(), "Fixture profile row is unavailable.");
                }
            }
            var a = pool.submit(first);
            var b = pool.submit(second);
            try {
                long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
                int waiting;
                // The lock holder and the two requests already use all three Hikari slots.
                try (var observer = lock.createStatement()) {
                    do {
                        observer.execute("select pg_stat_clear_snapshot()");
                        try (var activity = observer.executeQuery("""
                                select count(distinct pid) from pg_stat_activity
                                where datname = current_database() and wait_event_type = 'Lock'
                                  and query ilike '%for no key update%'
                                """)) {
                            activity.next();
                            waiting = activity.getInt(1);
                        }
                        if (waiting == 2) break;
                        Thread.sleep(10);
                    } while (System.nanoTime() < deadline);
                }
                assertEquals(2, waiting, "Two native PostgreSQL backends must be blocked before the gate opens.");
            } finally {
                lock.rollback();
            }
            return List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
        }
    }

    private HttpResponse<String> send(String token, UUID target) throws Exception {
        return request("POST", "/api/v1/friends/requests", token, "{\"userId\":\"" + target + "\"}");
    }

    private HttpResponse<String> respond(String token, UUID id, boolean accept) throws Exception {
        return request("POST", responsePath(id), token, "{\"accept\":" + accept + "}");
    }

    private String responsePath(UUID id) {
        return "/api/v1/friends/requests/" + id + "/respond";
    }

    private UUID create(String token, UUID target) throws Exception {
        return successfulId(send(token, target));
    }

    private UUID successfulId(HttpResponse<String> response) throws JSONException {
        assertEquals(200, response.statusCode(), response.body());
        UUID id = UUID.fromString(JSON.readTree(response.body()).get("id").asString());
        JSONAssert.assertEquals("{\"id\":\"" + id + "\"}", response.body(), true);
        return id;
    }

    private int count(String table) {
        return jdbc.queryForObject("select count(*) from public." + table, Integer.class);
    }

    private String profile(UUID user, boolean showOnline) {
        if (FIRST.equals(user)) return """
                {"id":"%s","username":"first_profile","displayName":"Perfil de São Luís","avatarUrl":null,"showOnline":%s}
                """.formatted(user, showOnline);
        if (SECOND.equals(user)) return """
                {"id":"%s","username":"second_profile","displayName":"Second Profile",
                 "avatarUrl":"https://example.test/avatar.png","showOnline":%s}
                """.formatted(user, showOnline);
        if (THIRD.equals(user)) return """
                {"id":"%s","username":"third_profile","displayName":"Third Profile","avatarUrl":null,"showOnline":%s}
                """.formatted(user, showOnline);
        throw new IllegalArgumentException("No expected profile for this fixture.");
    }

    private String onlineProfile(UUID user, boolean showOnline, Boolean online) {
        String profile = profile(user, showOnline).stripTrailing();
        return profile.substring(0, profile.length() - 1) + ",\"online\":" + online + "}";
    }

    private void assertError(int status, String code, HttpResponse<String> response) throws JSONException {
        assertJson(status, "{\"error\":\"" + code + "\"}", response);
    }

    private void assertJson(int status, String expected, HttpResponse<String> response) throws JSONException {
        assertEquals(status, response.statusCode(), response.body());
        JSONAssert.assertEquals(expected, response.body(), true);
    }
}
