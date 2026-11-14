package com.backstabber;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
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


@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@EnabledIf(value = "databaseRequested", disabledReason = "Requires Testcontainers or a disposable local PostgreSQL cluster.")
public abstract class SocialIntegrationTest {
    private static final String LOCAL_DATABASE = System.getenv("BACKSTABBER_JAVA_TEST_DATABASE_URL");
    private static final boolean USE_TESTCONTAINERS = "true".equalsIgnoreCase(System.getenv("BACKSTABBER_TESTCONTAINERS"));
    protected static final UUID FIRST = UUID.fromString("b6100000-0000-0000-0000-000000000001");
    protected static final UUID SECOND = UUID.fromString("b6100000-0000-0000-0000-000000000002");
    protected static final UUID MISSING = UUID.fromString("b6100000-0000-0000-0000-000000000003");
    private static final String PUBLIC_KEY = "fixture-publishable-key";
    protected static final UUID THIRD = UUID.fromString("b6100000-0000-0000-0000-000000000006");
    protected static final UUID FOURTH = UUID.fromString("b6100000-0000-0000-0000-000000000007");
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
    protected static String fixtureDatabaseUrl;

    @LocalServerPort
    protected int port;
    @Autowired
    protected DataSource dataSource;
    @Autowired
    protected JdbcTemplate jdbc;
    @Autowired
    protected PlatformTransactionManager transactions;

    static boolean databaseRequested() {
        return USE_TESTCONTAINERS || LOCAL_DATABASE != null && !LOCAL_DATABASE.isBlank();
    }

    @DynamicPropertySource
    static void startFixtures(DynamicPropertyRegistry properties) throws Exception {
        try {
            fixtureDatabaseUrl = initializeDatabase();
            auth = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            auth.createContext("/auth/v1/user", SocialIntegrationTest::authResponse);
            auth.start();
            properties.add("backstabber.database.url", () -> fixtureDatabaseUrl);
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

    protected static void configureChildProcess(ProcessBuilder process) {
        process.environment().put("SPRING_PROFILES_ACTIVE", "test");
        process.environment().put("DATABASE_URL", fixtureDatabaseUrl);
        process.environment().put("SUPABASE_URL", "http://127.0.0.1:" + auth.getAddress().getPort());
        process.environment().put("SUPABASE_PUBLISHABLE_KEY", PUBLIC_KEY);
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

    @BeforeEach
    void resetRows() {
        jdbc.execute("truncate auth.users, public.bs_rooms, realtime.messages cascade");
        jdbc.update("insert into auth.users (id) values (?), (?), (?), (?), (?)", FIRST, SECOND, THIRD, FOURTH, MISSING);
        insertProfile(FIRST, "first_profile", "Perfil de São Luís", null, false);
        insertProfile(SECOND, "second_profile", "Second Profile", "https://example.test/avatar.png", true);
        insertProfile(THIRD, "third_profile", "Third Profile", null, true);
        insertProfile(FOURTH, "fourth_profile", "Fourth Profile", null, false);
        jdbc.execute("truncate realtime.messages");
    }

    private void insertProfile(UUID id, String username, String name, String avatar, boolean online) {
        jdbc.update("""
                insert into public.bs_profiles (user_id, username, display_name, avatar_url, show_online, last_seen)
                values (?, ?, ?, ?, ?, now())
                """, id, username, name, avatar, online);
    }

    protected HttpResponse<String> request(String method, String path, String token, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(15))
                .header("X-User-Id", FIRST.toString());
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (body != null) builder.header("Content-Type", "application/json");
        return HTTP.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
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
                case "Bearer third" -> reply(exchange, 200, user(THIRD, false));
                case "Bearer fourth" -> reply(exchange, 200, user(FOURTH, false));
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
            String database = "backstabber_java_" + UUID.randomUUID().toString().replace("-", "");
            container = new PostgreSQLContainer("postgres:17-alpine").withDatabaseName(database);
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
