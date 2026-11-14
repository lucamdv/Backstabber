package com.backstabber;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "backstabber.allowed-origin=http://localhost:5173", "backstabber.auth.timeout=750ms",
        "backstabber.auth.publishable-key=test-public-key"
})
class FoundationHttpTest {
    private static final HttpServer AUTH = startAuth();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int port;

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry properties) throws IOException {
        properties.add("backstabber.auth.url", () -> "http://127.0.0.1:" + AUTH.getAddress().getPort());
        int unavailable;
        try (var socket = new ServerSocket()) {
            socket.bind(new InetSocketAddress("127.0.0.1", 0));
            unavailable = socket.getLocalPort();
        }
        properties.add("backstabber.database.url",
                () -> "postgresql://fixture:fixture@127.0.0.1:" + unavailable + "/fixture");
    }

    @AfterAll
    static void stopAuth() {
        AUTH.stop(0);
    }

    @Test
    void livenessWorksWhileReadinessDetectsUnreachableDatabase() throws Exception {
        var live = get("/actuator/health/liveness", null);
        assertEquals(200, live.statusCode());
        assertEquals("{\"status\":\"UP\"}", live.body());
        var readiness = get("/actuator/health/readiness", null);
        assertEquals(503, readiness.statusCode());
        assertEquals("{\"status\":\"DOWN\"}", readiness.body());
    }

    @Test
    void profileRejectsMissingInvalidExpiredAnonymousAndMalformedIdentity() throws Exception {
        for (String authorization : new String[]{"Basic test", "Bearer invalid", "Bearer expired",
                "Bearer anonymous", "Bearer invalid-uuid", "Bearer missing-id"}) {
            assertError(401, "UNAUTHENTICATED", get("/api/v1/profile", authorization));
        }
        assertError(401, "UNAUTHENTICATED", get("/api/v1/profile", null));
    }

    @Test
    void mapsUpstreamTimeoutAndUnavailabilityTo503() throws Exception {
        for (String token : new String[]{"unavailable", "slow", "redirect"}) {
            assertError(503, "SERVICE_UNAVAILABLE", get("/api/v1/profile", "Bearer " + token));
        }
        assertError(500, "INTERNAL_ERROR", get("/api/v1/profile", "Bearer invalid-json"));
    }

    @Test
    void validAuthWithUnavailableDatabaseReturns503() throws Exception {
        assertError(503, "SERVICE_UNAVAILABLE", get("/api/v1/profile", "Bearer valid"));
    }

    @Test
    void preflightDoesNotRequireAuthAndOnlyReflectsAllowedOrigins() throws Exception {
        for (String origin : new String[]{"http://localhost:5173", "http://localhost:5174"}) {
            var request = request("/api/v1/profile").header("Origin", origin)
                    .header("Access-Control-Request-Method", "GET")
                    .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
            var response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(204, response.statusCode());
            assertEquals(origin.endsWith("5173") ? origin : null,
                    response.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
            assertEquals("Authorization, Content-Type", response.headers().firstValue("Access-Control-Allow-Headers").orElseThrow());
        }
    }

    @Test
    void matchRoutesAuthenticateBeforeLookingUpTheMatch() throws Exception {
        assertError(401, "UNAUTHENTICATED", get("/api/v1/matches/00000000-0000-4000-8000-000000000001", null));
        assertError(404, "NOT_FOUND", get("/api/v1/matches/invalid", "Bearer valid"));
        assertError(503, "SERVICE_UNAVAILABLE", get("/api/v1/matches/00000000-0000-4000-8000-000000000001", "Bearer valid"));
    }

    private HttpResponse<String> get(String path, String authorization) throws Exception {
        var request = request(path);
        if (authorization != null) request.header("Authorization", authorization);
        return HTTP.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest.Builder request(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
    }

    private static void assertError(int status, String code, HttpResponse<String> response) {
        assertEquals(status, response.statusCode(), response.body());
        assertEquals("{\"error\":\"" + code + "\"}", response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        assertFalse(response.body().contains("test-public-key"));
    }

    private static HttpServer startAuth() {
        try {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/auth/v1/user", exchange -> {
                try (exchange) {
                    String token = exchange.getRequestHeaders().getFirst("Authorization");
                    int status = 200;
                    String body = "{\"id\":\"00000000-0000-4000-8000-000000000001\"}";
                    if (!"GET".equals(exchange.getRequestMethod())
                            || !"test-public-key".equals(exchange.getRequestHeaders().getFirst("apikey"))) {
                        status = 500;
                    } else {
                        switch (token == null ? "" : token) {
                            case "Bearer invalid" -> status = 401;
                            case "Bearer expired" -> status = 403;
                            case "Bearer anonymous" -> body = body.replace("}", ",\"is_anonymous\":true}");
                            case "Bearer invalid-uuid" -> body = "{\"id\":\"1-2-3-4-5\"}";
                            case "Bearer missing-id" -> body = "{}";
                            case "Bearer invalid-json" -> body = "{";
                            case "Bearer unavailable" -> status = 503;
                            case "Bearer redirect" -> {
                                status = 302;
                                exchange.getResponseHeaders().set("Location", "/auth/v1/user");
                            }
                            case "Bearer slow" -> {
                                exchange.sendResponseHeaders(200, 10);
                                try { Thread.sleep(1500); }
                                catch (InterruptedException interruption) { Thread.currentThread().interrupt(); }
                                return;
                            }
                            case "Bearer valid" -> { }
                            default -> status = 401;
                        }
                    }
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status, bytes.length);
                    exchange.getResponseBody().write(bytes);
                }
            });
            server.setExecutor(java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor());
            server.start();
            return server;
        } catch (IOException failure) {
            throw new IllegalStateException("Could not start the local Auth fixture", failure);
        }
    }
}
