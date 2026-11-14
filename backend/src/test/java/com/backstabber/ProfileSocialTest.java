package com.backstabber;

import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;

import java.net.http.HttpResponse;
import java.time.OffsetDateTime;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class ProfileSocialTest extends SocialIntegrationTest {
    @Test
    void createsAndUpdatesOnlyTheAuthenticatedProfileWithNodeDefaults() throws Exception {
        var created = request("PUT", "/api/v1/profile", "missing", """
                {"userId":"%s","username":"  NOVO_PERFIL  ","displayName":"  Novo perfil  "}
                """.formatted(FIRST));
        assertJson(200, """
                {"id":"%s","username":"novo_perfil","displayName":"Novo perfil","avatarUrl":null,"showOnline":false}
                """.formatted(MISSING), created);
        assertEquals("first_profile", jdbc.queryForObject("select username from public.bs_profiles where user_id = ?", String.class, FIRST));

        assertJson(200, """
                {"id":"%s","username":"novo_perfil","displayName":"Outro","avatarUrl":"https://example.test/new.png","showOnline":true}
                """.formatted(MISSING), request("PUT", "/api/v1/profile", "missing", """
                {"username":"novo_perfil","displayName":"Outro","avatarUrl":"https://example.test/new.png","showOnline":true}
                """));
        assertJson(200, """
                {"id":"%s","username":"novo_perfil","displayName":"Final","avatarUrl":null,"showOnline":true}
                """.formatted(MISSING), request("PUT", "/api/v1/profile", "missing", """
                {"username":"novo_perfil","displayName":"Final"}
                """));
    }

    @Test
    void matchesProfileValidationAndUniqueConstraint() throws Exception {
        assertError(409, "USERNAME_TAKEN", request("PUT", "/api/v1/profile", "second",
                "{\"username\":\"FIRST_PROFILE\",\"displayName\":\"Other\"}"));
        assertError(400, "INVALID_PROFILE", request("PUT", "/api/v1/profile", "second",
                "{\"username\":\"ß%\",\"displayName\":\"Other\"}"));
        assertError(400, "INVALID_PROFILE", request("PUT", "/api/v1/profile", "second",
                "{\"username\":\"valid_name\",\"displayName\":\"   \"}"));
        for (String avatar : new String[]{"https://user:secret@example.test/path", "http://example.test", "https://example.test:65536"}) {
            assertError(400, "INVALID_AVATAR", request("PUT", "/api/v1/profile", "second",
                    "{\"username\":\"valid_name\",\"displayName\":\"Other\",\"avatarUrl\":\"" + avatar + "\"}"));
        }
        assertError(400, "INVALID_BOOLEAN", request("PUT", "/api/v1/profile", "second",
                "{\"username\":\"valid_name\",\"displayName\":\"Other\",\"showOnline\":null}"));
        assertEquals("second_profile", jdbc.queryForObject("select username from public.bs_profiles where user_id = ?", String.class, SECOND));
    }

    @Test
    void heartbeatThrottlesWritesAndIgnoresTargetId() throws Exception {
        jdbc.update("update public.bs_profiles set last_seen = now() - interval '11 seconds' where user_id in (?, ?)", FIRST, SECOND);
        var firstBefore = lastSeen(FIRST);
        assertJson(200, "{\"ok\":true}", request("POST", "/api/v1/profile/heartbeat", "second",
                "{\"userId\":\"" + FIRST + "\"}"));
        var heartbeat = lastSeen(SECOND);
        assertNotNull(heartbeat);
        assertEquals(firstBefore, lastSeen(FIRST));
        assertJson(200, "{\"ok\":true}", request("POST", "/api/v1/profile/heartbeat", "second", null));
        assertEquals(heartbeat, lastSeen(SECOND));
        assertJson(200, "{\"ok\":true}", request("POST", "/api/v1/profile/heartbeat", "missing", "{}"));
        assertEquals(0, jdbc.queryForObject("select count(*) from public.bs_profiles where user_id = ?", Integer.class, MISSING));
    }

    @Test
    void searchUsesLiteralUnderscoreAndFirstQueryValue() throws Exception {
        jdbc.update("update public.bs_profiles set username = ? where user_id = ?", "secondxprofile", THIRD);
        assertJson(200, """
                [{"id":"%s","username":"second_profile","displayName":"Second Profile","avatarUrl":"https://example.test/avatar.png","showOnline":true}]
                """.formatted(SECOND), request("GET", "/api/v1/users?username=%20SECOND_%20&username=third", "first", null));
        assertJson(200, "[]", request("GET", "/api/v1/users?username=SECOND_", "second", null));
        assertJson(200, "[]", request("GET", "/api/v1/users?username=%25", "first", null));
        assertJson(200, "[]", request("GET", "/api/v1/users", "first", null));
    }

    @Test
    void bodyLimitCountsUtf16AndRejectsInvalidJsonAfterAuthentication() throws Exception {
        String atLimit = "{\"note\":\"" + "😀".repeat(8186) + "x\"}";
        assertEquals(16_384, atLimit.length());
        assertJson(200, "{\"ok\":true}", request("POST", "/api/v1/profile/heartbeat", "first", atLimit));
        assertError(413, "PAYLOAD_TOO_LARGE", request("POST", "/api/v1/profile/heartbeat", "first", atLimit + " "));
        assertError(401, "UNAUTHENTICATED", request("POST", "/api/v1/profile/heartbeat", null, atLimit + " "));
        for (String invalid : new String[]{"null", "[]", " ", "true", "{} {}"}) {
            assertError(400, "INVALID_JSON", request("POST", "/api/v1/profile/heartbeat", "first", invalid));
        }
        assertJson(200, "{\"ok\":true}", request("POST", "/api/v1/profile/heartbeat", "first", "\ufeff{}"));
    }

    private OffsetDateTime lastSeen(UUID user) {
        return jdbc.queryForObject("select last_seen from public.bs_profiles where user_id = ?",
                (row, number) -> row.getObject(1, OffsetDateTime.class), user);
    }

    private static void assertError(int status, String code, HttpResponse<String> response) throws org.json.JSONException {
        assertJson(status, "{\"error\":\"" + code + "\"}", response);
    }

    private static void assertJson(int status, String expected, HttpResponse<String> response) throws org.json.JSONException {
        assertEquals(status, response.statusCode(), response.body());
        JSONAssert.assertEquals(expected, response.body(), true);
    }
}
