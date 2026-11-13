package com.backstabber.security;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;

import com.backstabber.api.ApiFailure;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class SupabaseAuthenticator {
    private static final Logger log = LoggerFactory.getLogger(SupabaseAuthenticator.class);
    private static final Pattern UUID_FORMAT = Pattern.compile("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}");
    private static final Set<String> LOOPBACK = Set.of("localhost", "127.0.0.1", "[::1]");
    private final Environment environment;
    private final ObjectMapper json;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public SupabaseAuthenticator(Environment environment, ObjectMapper json) {
        this.environment = environment;
        this.json = json;
    }

    public UUID authenticate(String token) {
        HttpRequest request;
        Duration timeout;
        try {
            String key = environment.getProperty("backstabber.auth.publishable-key", "");
            URI endpoint = URI.create(environment.getProperty("backstabber.auth.url", "")).resolve("/auth/v1/user");
            if (key.isBlank() || endpoint.getHost() == null || endpoint.getUserInfo() != null
                    || !("https".equalsIgnoreCase(endpoint.getScheme())
                    || ("http".equalsIgnoreCase(endpoint.getScheme())
                    && LOOPBACK.contains(endpoint.getHost().toLowerCase(Locale.ROOT))))) {
                throw new IllegalArgumentException();
            }
            timeout = DurationStyle.detectAndParse(
                    environment.getProperty("backstabber.auth.timeout", "6s"));
            request = HttpRequest.newBuilder(endpoint).timeout(timeout)
                    .header("apikey", key).header("Authorization", "Bearer " + token).GET().build();
        } catch (IllegalArgumentException failure) {
            log.warn("Supabase Auth configuration missing or invalid");
            throw ApiFailure.unavailable();
        }
        HttpResponse<String> response;
        var pending = client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        try {
            response = pending.get(timeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (InterruptedException failure) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw ApiFailure.unavailable();
        } catch (ExecutionException | TimeoutException failure) {
            pending.cancel(true);
            log.atWarn().addKeyValue("type", failure.getClass().getSimpleName()).log("Supabase Auth unreachable");
            throw ApiFailure.unavailable();
        }
        int status = response.statusCode();
        if (status == 401 || status == 403) throw ApiFailure.unauthenticated();
        if (status < 200 || status >= 300) {
            log.atWarn().addKeyValue("upstream_status", status).log("Supabase Auth unavailable");
            throw ApiFailure.unavailable();
        }
        JsonNode user;
        try {
            if (response.body().isBlank()) throw ApiFailure.internal();
            user = json.readTree(response.body());
        } catch (JacksonException failure) {
            log.warn("Supabase Auth returned invalid JSON");
            throw ApiFailure.internal();
        }
        JsonNode id = user.path("id");
        JsonNode anonymous = user.path("is_anonymous");
        if (!id.isTextual() || !UUID_FORMAT.matcher(id.asText()).matches()
                || (anonymous.isBoolean() && anonymous.asBoolean())) {
            throw ApiFailure.unauthenticated();
        }
        return UUID.fromString(id.asText());
    }
}
