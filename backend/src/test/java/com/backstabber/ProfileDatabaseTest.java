package com.backstabber;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.skyscreamer.jsonassert.JSONAssert;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@EnabledIf(value = "databaseRequested", disabledReason = "Requires Testcontainers or a disposable local PostgreSQL cluster.")
class ProfileDatabaseTest {
    private static final String LOCAL_DATABASE = System.getenv("BACKSTABBER_JAVA_TEST_DATABASE_URL");
    private static final boolean USE_TESTCONTAINERS = "true".equalsIgnoreCase(System.getenv("BACKSTABBER_TESTCONTAINERS"));
    private static final UUID FIRST = UUID.fromString("b6100000-0000-0000-0000-000000000001");
    private static final UUID SECOND = UUID.fromString("b6100000-0000-0000-0000-000000000002");
    private static final UUID MISSING = UUID.fromString("b6100000-0000-0000-0000-000000000003");
    private static final String PUBLIC_KEY = "fixture-publishable-key";
    private static final String FIRST_PROFILE = """
            {"id":"%s","username":"first_profile","displayName":"Perfil de São Luís","avatarUrl":null,"showOnline":false}
            """.formatted(FIRST);
    private static final String SECOND_PROFILE = """
            {"id":"%s","username":"second_profile","displayName":"Second Profile","avatarUrl":"https://example.test/avatar.png","showOnline":true}
            """.formatted(SECOND);
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final String MANAGED_SCHEMA_FIXTURE = """
            do $setup$ begin
              if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
              if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
            end $setup$;
            create schema auth;
            create table auth.users (id uuid primary key);
            create function auth.uid() returns uuid language sql stable as
              $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            grant usage on schema auth to anon, authenticated;
            create schema realtime;
            create table realtime.messages (topic text, extension text, payload jsonb, event text, private boolean);
            alter table realtime.messages enable row level security;
            grant usage on schema realtime to anon, authenticated;
            grant select, insert on realtime.messages to anon, authenticated;
            create function realtime.topic() returns text language sql stable as
              $$ select current_setting('realtime.topic', true) $$;
            create function realtime.send(jsonb, text, text, boolean)
              returns void language sql as $$ insert into realtime.messages values ($3, 'broadcast', $1, $2, $4) $$;
            """;

    private static PostgreSQLContainer container;
    private static LocalCluster cluster;
    private static HttpServer auth;

    @LocalServerPort
    private int port;
    @Autowired
    private DataSource dataSource;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private PlatformTransactionManager transactions;

    static boolean databaseRequested() {
        return USE_TESTCONTAINERS || LOCAL_DATABASE != null && !LOCAL_DATABASE.isBlank();
    }

    @DynamicPropertySource
    static void startFixtures(DynamicPropertyRegistry properties) throws Exception {
        try {
            String databaseUrl = initializeDatabase();
            auth = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            auth.createContext("/auth/v1/user", ProfileDatabaseTest::authResponse);
            auth.start();
            properties.add("backstabber.database.url", () -> databaseUrl);
            properties.add("backstabber.auth.url", () -> "http://127.0.0.1:" + auth.getAddress().getPort());
            properties.add("backstabber.auth.publishable-key", () -> PUBLIC_KEY);
            properties.add("backstabber.auth.timeout", () -> "2s");
        } catch (Exception failure) {
            try {
                stopFixtures();
            } catch (Exception cleanupFailure) {
                failure.addSuppressed(cleanupFailure);
            }
            throw failure;
        }
    }

    @AfterAll
    static void stopFixtures() throws SQLException {
        if (auth != null) {
            auth.stop(0);
            auth = null;
        }
        if (container != null) {
            container.stop();
            container = null;
        }
        if (cluster != null) {
            cluster.close();
            cluster = null;
        }
    }

    @Test
    void returnsOwnProfileWithNodeContractAndNoCaching() throws Exception {
        var response = getProfile("first", "");
        assertEquals(200, response.statusCode());
        JSONAssert.assertEquals(FIRST_PROFILE, response.body(), true);
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
        assertTrue(response.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
    }

    @Test
    void reportsReadinessWhenPostgresAcceptsQueries() throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/actuator/health/readiness"))
                .timeout(Duration.ofSeconds(10)).GET().build();
        var response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        JSONAssert.assertEquals("{\"status\":\"UP\"}", response.body(), true);
    }

    @Test
    void usesAuthenticatedIdentityRatherThanUserIdFromTheRequest() throws Exception {
        var response = getProfile("second", "?userId=" + FIRST + "&id=" + FIRST);
        assertEquals(200, response.statusCode());
        JSONAssert.assertEquals(SECOND_PROFILE, response.body(), true);
    }

    @Test
    void returnsJsonNullWhenAuthenticatedUserHasNoProfile() throws Exception {
        var response = getProfile("missing", "");
        assertEquals(200, response.statusCode());
        assertEquals("null", response.body().trim());
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
    }

    @Test
    void rejectsMissingOrInvalidAuthentication() throws Exception {
        for (String token : new String[] {null, "invalid", "expired", "anonymous"}) {
            var response = getProfile(token, "");
            assertEquals(401, response.statusCode());
            JSONAssert.assertEquals("{\"error\":\"UNAUTHENTICATED\"}", response.body(), true);
        }
    }

    @Test
    void returnsCompatibleServiceUnavailableWhenAuthIsDown() throws Exception {
        var response = getProfile("unavailable", "");
        assertEquals(503, response.statusCode());
        JSONAssert.assertEquals("{\"error\":\"SERVICE_UNAVAILABLE\"}", response.body(), true);
    }

    @Test
    void rollsBackDatabaseFailuresAndRecoversAfterARealLockTimeout() throws Exception {
        try (Connection lock = dataSource.getConnection(); var sql = lock.createStatement()) {
            lock.setAutoCommit(false);
            try {
                sql.execute("lock table public.bs_profiles in access exclusive mode");
                var response = getProfile("first", "");
                assertEquals(503, response.statusCode());
                JSONAssert.assertEquals("{\"error\":\"SERVICE_UNAVAILABLE\"}", response.body(), true);
            } finally {
                lock.rollback();
            }
        }

        var recovered = getProfile("first", "");
        assertEquals(200, recovered.statusCode());
        JSONAssert.assertEquals(FIRST_PROFILE, recovered.body(), true);
    }

    @Test
    void commitsSuccessfulSpringJdbcTransactionsAndRollsBackFailedOnes() throws Exception {
        UUID committed = UUID.fromString("b6100000-0000-0000-0000-000000000004");
        UUID rolledBack = UUID.fromString("b6100000-0000-0000-0000-000000000005");
        var transaction = new TransactionTemplate(transactions);
        transaction.executeWithoutResult(status -> jdbc.update("insert into auth.users (id) values (?)", committed));

        assertThrows(DataIntegrityViolationException.class, () -> transaction.executeWithoutResult(status -> {
            jdbc.update("insert into auth.users (id) values (?)", rolledBack);
            jdbc.update("insert into auth.users (id) values (?)", committed);
        }));
        assertEquals(Boolean.TRUE, jdbc.queryForObject("select exists (select 1 from auth.users where id = ?)", Boolean.class, committed));
        assertEquals(Boolean.FALSE, jdbc.queryForObject("select exists (select 1 from auth.users where id = ?)", Boolean.class, rolledBack));
    }

    @Test
    void canonicalMigrationDeniesDirectProfileAndMatchStateReadsByClientRoles() throws SQLException {
        for (String role : new String[] {"anon", "authenticated"}) {
            for (String table : new String[] {"bs_profiles", "bs_matches"}) {
                try (Connection client = dataSource.getConnection(); var sql = client.createStatement()) {
                    client.setAutoCommit(false);
                    try {
                        sql.execute("set local role " + role);
                        sql.execute("set local request.jwt.claim.sub = '" + FIRST + "'");
                        SQLException denied = assertThrows(SQLException.class,
                                () -> sql.executeQuery("select * from public." + table));
                        assertEquals("42501", denied.getSQLState());
                    } finally {
                        client.rollback();
                    }
                }
            }
        }
    }

    private HttpResponse<String> getProfile(String token, String query) throws IOException, InterruptedException {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/profile" + query))
                .timeout(Duration.ofSeconds(15))
                .header("X-User-Id", FIRST.toString());
        if (token != null) request.header("Authorization", "Bearer " + token);
        return HTTP.send(request.GET().build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private static void authResponse(HttpExchange exchange) throws IOException {
        try (exchange) {
            if (!"GET".equals(exchange.getRequestMethod()) || !PUBLIC_KEY.equals(exchange.getRequestHeaders().getFirst("apikey"))) {
                reply(exchange, 400, "{}");
                return;
            }
            String token = exchange.getRequestHeaders().getFirst("Authorization");
            switch (token == null ? "" : token) {
                case "Bearer first" -> reply(exchange, 200, user(FIRST, false));
                case "Bearer second" -> reply(exchange, 200, user(SECOND, false));
                case "Bearer missing" -> reply(exchange, 200, user(MISSING, false));
                case "Bearer anonymous" -> reply(exchange, 200, user(FIRST, true));
                case "Bearer unavailable" -> reply(exchange, 503, "{}");
                default -> reply(exchange, 401, "{}");
            }
        }
    }

    private static String user(UUID id, boolean anonymous) {
        return "{\"id\":\"" + id + "\",\"is_anonymous\":" + anonymous + "}";
    }

    private static void reply(HttpExchange exchange, int status, String json) throws IOException {
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
    }

    private static String initializeDatabase() throws IOException, SQLException {
        if (USE_TESTCONTAINERS) {
            container = new PostgreSQLContainer("postgres:17-alpine");
            container.start();
            try (Connection db = DriverManager.getConnection(container.getJdbcUrl(), container.getUsername(), container.getPassword())) {
                seedDatabase(db);
            }
            return "postgresql://" + container.getUsername() + ":" + container.getPassword() + "@127.0.0.1:"
                    + container.getMappedPort(5432) + "/" + container.getDatabaseName();
        }
        cluster = LocalCluster.create(LOCAL_DATABASE);
        try (Connection db = cluster.connect(cluster.database)) {
            seedDatabase(db);
        }
        return cluster.applicationUrl();
    }

    private static void seedDatabase(Connection database) throws IOException, SQLException {
        Path migration = Path.of("..", "supabase", "migrations", "20261112000101_backstabber_multiplayer.sql");
        if (!Files.isRegularFile(migration)) migration = Path.of("supabase", "migrations", migration.getFileName().toString());
        try (var sql = database.createStatement()) {
            sql.execute(MANAGED_SCHEMA_FIXTURE);
            sql.execute(Files.readString(migration));
        }
        try (var users = database.prepareStatement("insert into auth.users (id) values (?), (?), (?)");
                var profiles = database.prepareStatement("""
                    insert into public.bs_profiles (user_id, username, display_name, avatar_url, show_online, last_seen)
                    values (?, ?, ?, ?, ?, now())
                    """)) {
            users.setObject(1, FIRST);
            users.setObject(2, SECOND);
            users.setObject(3, MISSING);
            users.executeUpdate();
            profiles.setObject(1, FIRST);
            profiles.setString(2, "first_profile");
            profiles.setString(3, "Perfil de São Luís");
            profiles.setString(4, null);
            profiles.setBoolean(5, false);
            profiles.executeUpdate();
            profiles.setObject(1, SECOND);
            profiles.setString(2, "second_profile");
            profiles.setString(3, "Second Profile");
            profiles.setString(4, "https://example.test/avatar.png");
            profiles.setBoolean(5, true);
            profiles.executeUpdate();
        }
    }

    private record LocalCluster(URI control, String database) implements AutoCloseable {
        static LocalCluster create(String url) throws SQLException {
            URI control;
            try {
                control = URI.create(url);
            } catch (IllegalArgumentException invalid) {
                throw new IllegalArgumentException("Malformed disposable PostgreSQL URL.");
            }
            if (!("postgres".equals(control.getScheme()) || "postgresql".equals(control.getScheme()))
                    || !"127.0.0.1".equals(control.getHost()) || control.getPort() <= 0
                    || !"/backstabber_native".equals(control.getPath()) || control.getRawQuery() != null || control.getRawFragment() != null
                    || control.getUserInfo() == null || !control.getUserInfo().startsWith("bs_homologation:")) {
                throw new IllegalArgumentException("Use the disposable backstabber_native loopback cluster and bs_homologation role.");
            }
            var isolated = new LocalCluster(control, "backstabber_java_" + UUID.randomUUID().toString().replace("-", ""));
            try (Connection admin = isolated.connect("backstabber_native"); var sql = admin.createStatement()) {
                sql.execute("create database " + isolated.database);
            }
            return isolated;
        }

        Connection connect(String name) throws SQLException {
            String[] credentials = control.getUserInfo().split(":", 2);
            String jdbc = "jdbc:postgresql://127.0.0.1:" + control.getPort() + "/" + name + "?connectTimeout=3";
            return DriverManager.getConnection(jdbc, credentials[0], credentials[1]);
        }

        String applicationUrl() {
            return "postgresql://" + control.getRawAuthority() + "/" + database;
        }

        @Override
        public void close() throws SQLException {
            // Only the randomly generated database is affected. The pool may still hold idle test connections.
            try (Connection admin = connect("backstabber_native"); var sql = admin.createStatement()) {
                sql.execute("drop database " + database + " with (force)");
            }
        }
    }
}
