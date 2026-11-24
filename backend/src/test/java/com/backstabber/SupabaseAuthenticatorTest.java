package com.backstabber;

import com.backstabber.api.ApiFailure;
import com.backstabber.security.SupabaseAuthenticator;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class SupabaseAuthenticatorTest {
    private static final String ID = "00000000-0000-4000-8000-000000000001";
    private static final String CONFIRMED = "2026-11-20T12:00:00.000Z";
    private static final String SECRET = "canary-password canary-otp-654321 canary-access-token";
    private static final AtomicInteger REQUESTS = new AtomicInteger();
    private static HttpServer auth;
    private static volatile String body;
    private static volatile int status;

    @BeforeAll
    static void startAuth() throws Exception {
        auth = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        auth.createContext("/auth/v1/user", exchange -> {
            REQUESTS.incrementAndGet();
            try (exchange) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Location", "/auth/v1/user");
                exchange.sendResponseHeaders(status, bytes.length);
                exchange.getResponseBody().write(bytes);
            }
        });
        auth.start();
    }

    @AfterAll
    static void stopAuth() { if (auth != null) auth.stop(0); }

    private SupabaseAuthenticator authenticator(String url) {
        return new SupabaseAuthenticator(new MockEnvironment()
                .withProperty("backstabber.auth.url", url)
                .withProperty("backstabber.auth.publishable-key", "fixture-public-key"), new ObjectMapper());
    }

    private SupabaseAuthenticator authenticator() {
        return authenticator("http://127.0.0.1:" + auth.getAddress().getPort());
    }

    private void reply(int code, String payload) { status = code; body = payload; }

    @Test
    void confirmedGoogleAndPasswordAccountsUseTheSameTrustedUuid() {
        for (String provider : new String[]{"google", "email"}) {
            reply(200, "{\"id\":\"" + ID + "\",\"email_confirmed_at\":\"" + CONFIRMED
                    + "\",\"app_metadata\":{\"provider\":\"" + provider + "\"},\"user_metadata\":{\"email_verified\":false}}");
            assertEquals(UUID.fromString(ID), authenticator().authenticate("canary-access-token"));
        }
    }

    @Test
    void untrustedMetadataAndGenericConfirmationCannotVerifyEmail() {
        for (String confirmation : new String[]{"", ",\"email_confirmed_at\":null", ",\"email_confirmed_at\":true",
                ",\"email_confirmed_at\":\"\"", ",\"email_confirmed_at\":\" \"", ",\"email_confirmed_at\":\"not-a-date\""}) {
            reply(200, "{\"id\":\"" + ID + "\"" + confirmation + ",\"confirmed_at\":\"" + CONFIRMED
                    + "\",\"user_metadata\":{\"email_verified\":true,\"email_confirmed_at\":\"" + CONFIRMED + "\"}}");
            assertFailure(401, "UNAUTHENTICATED", authenticator());
        }
    }

    @Test
    void confirmationIsCheckedAgainForTheSameToken() {
        var authenticator = authenticator();
        reply(200, "{\"id\":\"" + ID + "\",\"email_confirmed_at\":\"" + CONFIRMED + "\"}");
        assertEquals(UUID.fromString(ID), authenticator.authenticate("canary-access-token"));
        reply(200, "{\"id\":\"" + ID + "\",\"email_confirmed_at\":null}");
        assertFailure(401, "UNAUTHENTICATED", authenticator);
    }

    @Test
    void rejectsAnonymousAndMalformedIdentity() {
        for (String payload : new String[]{"null", "[]", "{}", "{\"id\":\"1-2-3-4-5\",\"email_confirmed_at\":\"" + CONFIRMED + "\"}",
                "{\"id\":\"" + ID + "\",\"is_anonymous\":true,\"email_confirmed_at\":\"" + CONFIRMED + "\"}"}) {
            reply(200, payload);
            assertFailure(401, "UNAUTHENTICATED", authenticator());
        }
    }

    @Test
    void rejectsInvalidConfigurationWithoutSendingCredentials(CapturedOutput output) {
        int before = REQUESTS.get();
        for (String url : new String[]{"http://remote.test", "http://canary-password@127.0.0.1:" + auth.getAddress().getPort(), "canary-password"}) {
            assertFailure(503, "SERVICE_UNAVAILABLE", authenticator(url));
        }
        assertEquals(before, REQUESTS.get());
        assertFalse(output.getAll().contains("canary"));
    }

    @Test
    void invalidExpiredRedirectAndMalformedResponsesNeverExposeSecrets(CapturedOutput output) {
        for (int upstreamStatus : new int[]{401, 403, 302, 503}) {
            reply(upstreamStatus, SECRET);
            int before = REQUESTS.get();
            boolean denied = upstreamStatus == 401 || upstreamStatus == 403;
            assertFailure(denied ? 401 : 503, denied ? "UNAUTHENTICATED" : "SERVICE_UNAVAILABLE", authenticator());
            assertEquals(before + 1, REQUESTS.get());
        }
        reply(200, "{" + SECRET);
        assertFailure(500, "INTERNAL_ERROR", authenticator());
        assertFalse(output.getAll().contains("canary"));
    }

    private void assertFailure(int expectedStatus, String code, SupabaseAuthenticator authenticator) {
        var failure = assertThrows(ApiFailure.class, () -> authenticator.authenticate("canary-access-token"));
        assertEquals(expectedStatus, failure.status().value());
        assertEquals(code, failure.getMessage());
        assertFalse(failure.toString().contains("canary"));
    }
}
