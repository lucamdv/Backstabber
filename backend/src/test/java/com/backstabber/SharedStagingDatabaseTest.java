package com.backstabber;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Real PostgreSQL boundary tests. Every connection targets the disposable loopback fixture. */
@EnabledIf(value = "databaseRequested", disabledReason = "Requires Testcontainers or a disposable local PostgreSQL cluster.")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SharedStagingDatabaseTest {
    private static final UUID FIRST = SocialIntegrationTest.FIRST;
    private static final UUID SECOND = SocialIntegrationTest.SECOND;
    private static final UUID THIRD = SocialIntegrationTest.THIRD;
    private static final String PASSWORD = "local-only-test-password";
    private static final String PRODUCTION_ROLE = "bs_public_fixture_" + UUID.randomUUID().toString().replace("-", "");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final Map<String, Object> properties = new LinkedHashMap<>();
    private static ConfigurableApplicationContext application;
    private static URI database;
    private static String jdbcUrl;
    private static String adminUser;
    private static String adminPassword;
    private static List<String> originalPolicies;
    private static int port;

    static boolean databaseRequested() {
        return SocialIntegrationTest.databaseRequested();
    }

    @BeforeAll
    static void start() throws Exception {
        SocialIntegrationTest.startFixtures((key, supplier) -> properties.put(key, supplier.get()));
        database = URI.create(properties.get("backstabber.database.url").toString());
        assertEquals("127.0.0.1", database.getHost(), "Never use a remote database for this test");
        String[] credentials = database.getUserInfo().split(":", 2);
        adminUser = credentials[0];
        adminPassword = credentials[1];
        jdbcUrl = "jdbc:postgresql://127.0.0.1:" + database.getPort() + database.getPath() + "?connectTimeout=3";
        originalPolicies = productionPolicies();
        executeAdmin(Files.readString(sqlFile("migrations", "20261119000101_backstabber_shared_staging.sql")));
        executeAdmin("alter role bs_staging_app password '" + PASSWORD + "'; create role " + PRODUCTION_ROLE
                + " login password '" + PASSWORD + "' nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;"
                + " grant usage on schema public to " + PRODUCTION_ROLE + ";"
                + " grant select, insert, update, delete on all tables in schema public to " + PRODUCTION_ROLE);
        startApplication();
    }

    private static void startApplication() {
        String applicationUrl = "postgresql://bs_staging_app:" + PASSWORD + "@127.0.0.1:"
                + database.getPort() + database.getPath();
        application = new SpringApplicationBuilder(BackstabberApplication.class).profiles("test").run(
                "--server.port=0", "--server.address=127.0.0.1", "--spring.profiles.active=test",
                "--backstabber.database.url=" + applicationUrl, "--backstabber.database.schema=bs_staging",
                "--backstabber.database.allow-loopback-plaintext=true",
                "--backstabber.staging.mode=dedicated",
                "--backstabber.auth.url=" + properties.get("backstabber.auth.url"),
                "--backstabber.auth.publishable-key=" + properties.get("backstabber.auth.publishable-key"),
                "--backstabber.auth.timeout=2s");
        port = application.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
    }

    @AfterAll
    static void stop() throws Exception {
        if (application != null) application.close();
        try {
            if (jdbcUrl != null) {
                if ("1".equals(scalarAdmin("select count(*) from pg_namespace where nspname = 'bs_staging'"))) {
                    executeAdmin(Files.readString(sqlFile("rollbacks", "20261119000101_backstabber_shared_staging.rollback.sql")));
                }
                if ("1".equals(scalarAdmin("select count(*) from pg_roles where rolname='" + PRODUCTION_ROLE + "'"))) {
                    executeAdmin("drop owned by " + PRODUCTION_ROLE + "; drop role " + PRODUCTION_ROLE);
                }
            }
        } finally {
            SocialIntegrationTest.stopFixtures();
        }
    }

    @BeforeEach
    void reset() throws Exception {
        SocialIntegrationTest.resetAuthRejections();
        executeAdmin("truncate auth.users, public.bs_rooms, bs_staging.bs_profiles, bs_staging.bs_rooms, realtime.messages cascade;"
                + " insert into auth.users values ('" + FIRST + "'), ('" + SECOND + "'), ('" + THIRD + "');");
        for (String schema : List.of("public", "bs_staging")) {
            String prefix = schema.equals("public") ? "public" : "stage";
            executeAdmin("insert into " + schema + ".bs_profiles (user_id, username, display_name) values "
                    + "('" + FIRST + "','" + prefix + "_first','" + prefix + " first'),"
                    + "('" + SECOND + "','" + prefix + "_second','" + prefix + " second'),"
                    + "('" + THIRD + "','" + prefix + "_third','" + prefix + " third')");
        }
        executeAdmin("truncate realtime.messages");
        assertEquals(originalPolicies, productionPolicies());
    }

    @Test
    @Order(1)
    void sameAuthIdentityHasIndependentProfilesInBothDirections() throws Exception {
        JsonNode initial = ok(request("GET", "/api/v1/profile", "first", null));
        assertEquals("stage_first", initial.path("username").asString());
        JsonNode updated = ok(request("PUT", "/api/v1/profile", "first", """
                {"username":"stage_changed","displayName":"Staging changed","showOnline":true}
                """));
        assertEquals(FIRST.toString(), updated.path("id").asString());
        assertEquals("public_first", scalarAdmin("select username from public.bs_profiles where user_id='" + FIRST + "'"));
        executeAdmin("update public.bs_profiles set display_name='Public changed' where user_id='" + FIRST + "'");
        assertEquals("Staging changed", ok(request("GET", "/api/v1/profile", "first", null)).path("displayName").asString());
        assertEquals("Public changed", scalarAdmin("select display_name from public.bs_profiles where user_id='" + FIRST + "'"));
        assertEquals("3", scalarAdmin("select count(*) from auth.users"));
    }

    @Test
    @Order(2)
    void lobbyMatchFriendshipAndInvitationsUseOnlyStagingTablesAndKeepPrivacy() throws Exception {
        JsonNode pending = ok(request("POST", "/api/v1/friends/requests", "first", "{\"userId\":\"" + SECOND + "\"}"));
        String requestId = pending.path("id").asString();
        assertFalse(requestId.isBlank());
        ok(request("POST", "/api/v1/friends/requests/" + requestId + "/respond", "second", "{\"accept\":true}"));
        JsonNode room = ok(request("POST", "/api/v1/rooms", "first", "{\"capacity\":2}"));
        String roomId = room.path("id").asString();
        ok(request("POST", "/api/v1/rooms/" + roomId + "/invite", "first", "{\"userId\":\"" + SECOND + "\"}"));
        JsonNode invites = ok(request("GET", "/api/v1/invites", "second", null));
        assertEquals(1, invites.size());
        ok(request("POST", "/api/v1/rooms/join", "second", "{\"code\":\"" + room.path("code").asString() + "\"}"));
        ok(request("POST", "/api/v1/rooms/" + roomId + "/ready", "first", "{\"ready\":true}"));
        ok(request("POST", "/api/v1/rooms/" + roomId + "/ready", "second", "{\"ready\":true}"));
        String matchId = ok(request("POST", "/api/v1/rooms/" + roomId + "/start", "first", "{}")).path("matchId").asString();
        JsonNode host = ok(request("GET", "/api/v1/matches/" + matchId, "first", null));
        JsonNode guest = ok(request("GET", "/api/v1/matches/" + matchId, "second", null));
        assertEquals(2, host.path("hand").size());
        assertNotEquals(host.path("hand"), guest.path("hand"));
        assertFalse(host.has("deck"));
        assertFalse(host.has("audit"));
        assertFalse(host.path("players").get(1).has("cards"));
        assertEquals(404, request("GET", "/api/v1/matches/" + matchId, "third", null).statusCode());
        assertEquals(404, request("GET", "/api/v1/rooms/" + roomId, "third", null).statusCode());
        ok(request("POST", "/api/v1/matches/" + matchId + "/commands", "first", """
                {"protocolVersion":1,"commandId":"staging-income","expectedRevision":0,"command":{"type":"select-action","action":"income"}}
                """));
        for (String table : List.of("bs_friend_requests", "bs_friends", "bs_rooms", "bs_room_members", "bs_invites", "bs_matches", "bs_match_commands")) {
            assertEquals("0", scalarAdmin("select count(*) from public." + table), table);
            assertNotEquals("0", scalarAdmin("select count(*) from bs_staging." + table), table);
        }
    }

    @Test
    @Order(2)
    void forgedProfileUuidCannotChangeAnotherStagingOrPublicIdentity() throws Exception {
        JsonNode changed = ok(request("PUT", "/api/v1/profile?userId=" + FIRST, "second", """
                {"userId":"%s","username":"stage_authorized","displayName":"Authorized only"}
                """.formatted(FIRST)));
        assertEquals(SECOND.toString(), changed.path("id").asString());
        assertEquals("stage_first", scalarAdmin("select username from bs_staging.bs_profiles where user_id='" + FIRST + "'"));
        assertEquals("stage_authorized", scalarAdmin("select username from bs_staging.bs_profiles where user_id='" + SECOND + "'"));
        assertEquals("public_first", scalarAdmin("select username from public.bs_profiles where user_id='" + FIRST + "'"));
        assertEquals("public_second", scalarAdmin("select username from public.bs_profiles where user_id='" + SECOND + "'"));
        assertEquals(401, request("PUT", "/api/v1/profile", "expired", """
                {"userId":"%s","username":"forbidden_user","displayName":"Forbidden"}
                """.formatted(FIRST)).statusCode());
        assertEquals("stage_first", scalarAdmin("select username from bs_staging.bs_profiles where user_id='" + FIRST + "'"));
    }

    @Test
    @Order(3)
    void runtimeRoleHasOnlyStagingDmlAndProductionFixtureCannotAccessStaging() throws Exception {
        try (Connection app = appConnection()) {
            assertEquals("bs_staging_app", scalar(app, "select current_user"));
            assertEquals("stage_first", scalar(app, "select username from bs_staging.bs_profiles where user_id='" + FIRST + "'"));
            execute(app, "insert into bs_staging.bs_rooms(code,host_id,capacity) values ('123456789A','" + FIRST + "',2)");
            execute(app, "update bs_staging.bs_profiles set display_name='Allowed' where user_id='" + FIRST + "'");
            execute(app, "delete from bs_staging.bs_rooms where code='123456789A'");
            for (String sql : List.of("select * from public.bs_profiles", "insert into public.bs_profiles select * from public.bs_profiles where false",
                    "update public.bs_profiles set display_name='Forbidden' where false", "delete from public.bs_profiles where false",
                    "truncate public.bs_profiles", "truncate bs_staging.bs_profiles", "select * from auth.users",
                    "create table bs_staging.forbidden(id integer)", "create table public.bs_forbidden(id integer)",
                    "alter table bs_staging.bs_profiles add column forbidden text", "set role bs_staging_owner", "set role " + PRODUCTION_ROLE)) {
                denied(app, sql);
            }
        }
        try (Connection production = DriverManager.getConnection(jdbcUrl, PRODUCTION_ROLE, PASSWORD)) {
            assertEquals(PRODUCTION_ROLE, scalar(production, "select current_user"));
            // The fixture has table grants; canonical public RLS still filters its rows.
            assertEquals("0", scalar(production, "select count(*) from public.bs_profiles"));
            for (String sql : List.of("select * from bs_staging.bs_profiles", "insert into bs_staging.bs_profiles select * from public.bs_profiles where false",
                    "update bs_staging.bs_profiles set display_name='Forbidden' where false", "delete from bs_staging.bs_profiles where false",
                    "truncate bs_staging.bs_profiles", "set role bs_staging_owner", "set role bs_staging_app")) {
                denied(production, sql);
            }
        }
    }

    @Test
    @Order(4)
    void runtimeAssertionRejectsPrivilegeDriftAndMembershipAndWrongPassword() throws Exception {
        try (Connection app = appConnection()) {
            execute(app, "select bs_staging.assert_runtime_role()");
            for (String grant : List.of("grant select on public.bs_profiles to bs_staging_app",
                    "grant select (username) on public.bs_profiles to bs_staging_app",
                    "grant select on auth.users to bs_staging_app", "grant " + PRODUCTION_ROLE + " to bs_staging_app")) {
                executeAdmin(grant);
                try {
                    denied(app, "select bs_staging.assert_runtime_role()");
                } finally {
                    executeAdmin("revoke all on public.bs_profiles from bs_staging_app;"
                            + " revoke select(username) on public.bs_profiles from bs_staging_app;"
                            + " revoke all on auth.users from bs_staging_app;"
                            + " revoke " + PRODUCTION_ROLE + " from bs_staging_app");
                }
                execute(app, "select bs_staging.assert_runtime_role()");
            }
            for (String[] drift : List.of(
                    new String[]{"grant truncate on bs_staging.bs_profiles to bs_staging_app", "revoke truncate on bs_staging.bs_profiles from bs_staging_app"},
                    new String[]{"grant create on schema bs_staging to bs_staging_app", "revoke create on schema bs_staging from bs_staging_app"},
                    new String[]{"grant select on public.bs_profiles to public", "revoke select on public.bs_profiles from public"},
                    new String[]{"alter role bs_staging_app inherit", "alter role bs_staging_app noinherit"})) {
                executeAdmin(drift[0]);
                try {
                    denied(app, "select bs_staging.assert_runtime_role()");
                } finally {
                    executeAdmin(drift[1]);
                }
                execute(app, "select bs_staging.assert_runtime_role()");
            }
        }
        SQLException failure = assertThrows(SQLException.class,
                () -> DriverManager.getConnection(jdbcUrl, "bs_staging_app", "incorrect-local-test-password"));
        assertEquals("28P01", failure.getSQLState());
        try (Connection admin = adminConnection()) {
            denied(admin, "select bs_staging.assert_runtime_role()");
        }
    }

    @Test
    @Order(5)
    void realtimeRlsSeparatesUserRoomPresenceAndLegacyTopicsEvenWithBroadPermissivePolicies() throws Exception {
        UUID room = insertRoom("bs_staging", "ABCDEF1234");
        UUID productionRoom = insertRoom("public", "ABCDEF5678");
        String userTopic = "hml:user:" + FIRST;
        String roomTopic = "hml:room:" + room;
        for (String topic : List.of(userTopic, "hml:user:" + SECOND, roomTopic, "room:" + productionRoom, "user:" + FIRST)) {
            executeAdmin("insert into realtime.messages values ('" + topic + "','broadcast','{}','fixture',true)");
        }
        assertEquals("1", received(FIRST, userTopic));
        assertEquals("0", received(SECOND, userTopic));
        assertEquals("1", received(FIRST, roomTopic));
        assertEquals("0", received(THIRD, roomTopic));
        assertEquals("1", received(FIRST, "room:" + productionRoom));
        assertEquals("0", received(THIRD, "room:" + productionRoom));
        assertEquals("1", received(FIRST, "user:" + FIRST));
        try (Connection member = authenticated(FIRST, roomTopic); Connection outsider = authenticated(THIRD, roomTopic)) {
            execute(member, messageInsert(roomTopic, "presence"));
            denied(member, messageInsert(roomTopic, "broadcast"));
            denied(outsider, messageInsert(roomTopic, "presence"));
            denied(member, messageInsert(userTopic, "presence"));
            denied(member, "select ready from bs_staging.bs_room_members");
            assertEquals("1", scalar(member, "select count(user_id) from bs_staging.bs_room_members"));
        }
        executeAdmin("create policy fixture_broad_receive on realtime.messages for select to authenticated using(true);"
                + " create policy fixture_broad_insert on realtime.messages for insert to authenticated with check(true)");
        try {
            assertEquals("0", received(THIRD, roomTopic));
            assertEquals("0", received(SECOND, userTopic));
            try (Connection outsider = authenticated(THIRD, roomTopic); Connection member = authenticated(FIRST, roomTopic)) {
                denied(outsider, messageInsert(roomTopic, "presence"));
                denied(member, messageInsert(roomTopic, "broadcast"));
                execute(member, messageInsert(roomTopic, "presence"));
                execute(member, messageInsert("legacy:unchanged", "broadcast"));
            }
            assertEquals("1", received(THIRD, "legacy:unchanged"));
        } finally {
            executeAdmin("drop policy fixture_broad_receive on realtime.messages; drop policy fixture_broad_insert on realtime.messages");
        }
        assertEquals(originalPolicies, productionPolicies());
    }

    @Test
    @Order(6)
    void triggerInvalidationsContainOnlyKindAndHomologationPrefixes() throws Exception {
        UUID room = insertRoom("bs_staging", "1122334455");
        executeAdmin("insert into bs_staging.bs_friend_requests(sender_id,recipient_id) values ('" + FIRST + "','" + SECOND + "');"
                + " insert into bs_staging.bs_invites(room_id,sender_id,recipient_id) values ('" + room + "','" + FIRST + "','" + SECOND + "');"
                + " insert into bs_staging.bs_matches(room_id,state) values ('" + room + "','{\"secret\":\"must not broadcast\"}')");
        assertNotEquals("0", scalarAdmin("select count(*) from realtime.messages"));
        assertEquals("0", scalarAdmin("select count(*) from realtime.messages where topic not like 'hml:%'"
                + " or event <> 'invalidate' or private is distinct from true"
                + " or payload not in ('{\"kind\":\"room\"}'::jsonb,'{\"kind\":\"social\"}'::jsonb)"));
        assertNotEquals("0", scalarAdmin("select count(*) from realtime.messages where topic='hml:room:" + room + "'"));
        assertNotEquals("0", scalarAdmin("select count(*) from realtime.messages where topic='hml:user:" + FIRST + "'"));
        assertNotEquals("0", scalarAdmin("select count(*) from realtime.messages where topic='hml:user:" + SECOND + "'"));
    }

    @Test
    @Order(100)
    void collisionAbortsAtomicallyAndRollbackPreservesPublicAuthAndPolicies() throws Exception {
        String migration = Files.readString(sqlFile("migrations", "20261119000101_backstabber_shared_staging.sql"));
        try (Connection admin = adminConnection()) {
            assertThrows(SQLException.class, () -> execute(admin, migration));
            execute(admin, "rollback");
        }
        assertEquals("3", scalarAdmin("select count(*) from bs_staging.bs_profiles"));
        assertEquals("3", scalarAdmin("select count(*) from public.bs_profiles"));
        assertEquals("3", scalarAdmin("select count(*) from auth.users"));
        assertEquals(originalPolicies, productionPolicies());
        application.close();
        application = null;
        executeAdmin(Files.readString(sqlFile("rollbacks", "20261119000101_backstabber_shared_staging.rollback.sql")));
        assertEquals("0", scalarAdmin("select count(*) from pg_namespace where nspname='bs_staging'"));
        assertEquals("0", scalarAdmin("select count(*) from pg_roles where rolname in ('bs_staging_app','bs_staging_owner')"));
        assertEquals("3", scalarAdmin("select count(*) from public.bs_profiles"));
        assertEquals("3", scalarAdmin("select count(*) from auth.users"));
        assertEquals(originalPolicies, productionPolicies());
        // Reapplication proves rollback leaves no role, policy, grant or object residue.
        executeAdmin(migration);
        assertEquals("0", scalarAdmin("select count(*) from bs_staging.bs_profiles"));
        executeAdmin("alter role bs_staging_app password '" + PASSWORD + "'");
        try (Connection app = appConnection()) {
            execute(app, "select bs_staging.assert_runtime_role()");
        }
    }

    private static Path sqlFile(String directory, String name) {
        Path path = Path.of("..", "supabase", directory, name);
        return Files.isRegularFile(path) ? path : Path.of("supabase", directory, name);
    }

    private static Connection adminConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, adminUser, adminPassword);
    }

    private static Connection appConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, "bs_staging_app", PASSWORD);
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static void executeAdmin(String sql) throws SQLException {
        try (Connection admin = adminConnection()) {
            execute(admin, sql);
        }
    }

    private static String scalar(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next());
            return rows.getString(1);
        }
    }

    private static String scalarAdmin(String sql) throws SQLException {
        try (Connection admin = adminConnection()) {
            return scalar(admin, sql);
        }
    }

    private static void denied(Connection connection, String sql) {
        SQLException denied = assertThrows(SQLException.class, () -> execute(connection, sql), sql);
        assertEquals("42501", denied.getSQLState(), sql + ": " + denied.getMessage());
    }

    private static List<String> productionPolicies() throws SQLException {
        List<String> definitions = new ArrayList<>();
        try (Connection admin = adminConnection(); var statement = admin.createStatement(); var rows = statement.executeQuery("""
                select schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || roles::text
                  || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
                from pg_policies where schemaname='public' or
                  (schemaname='realtime' and policyname not like 'bs_staging_%')
                order by schemaname, tablename, policyname
                """)) {
            while (rows.next()) definitions.add(rows.getString(1));
        }
        return definitions;
    }

    private static UUID insertRoom(String schema, String code) throws SQLException {
        UUID room = UUID.randomUUID();
        executeAdmin("insert into " + schema + ".bs_rooms(id,code,host_id,capacity) values ('" + room + "','" + code + "','" + FIRST + "',2);"
                + " insert into " + schema + ".bs_room_members(room_id,user_id) values ('" + room + "','" + FIRST + "')");
        // Isolate authorization assertions from the invalidations generated by setup.
        executeAdmin("truncate realtime.messages");
        return room;
    }

    private static Connection authenticated(UUID user, String topic) throws SQLException {
        Connection connection = adminConnection();
        try {
            execute(connection, "set role authenticated; set request.jwt.claim.sub='" + user + "'; set realtime.topic='" + topic + "'");
            return connection;
        } catch (SQLException failure) {
            connection.close();
            throw failure;
        }
    }

    private static String received(UUID user, String topic) throws SQLException {
        try (Connection connection = authenticated(user, topic)) {
            return scalar(connection, "select count(*) from realtime.messages where topic='" + topic + "'");
        }
    }

    private static String messageInsert(String topic, String extension) {
        return "insert into realtime.messages values ('" + topic + "','" + extension + "','{}','fixture',true)";
    }

    private static HttpResponse<String> request(String method, String path, String token, String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer " + token);
        if (body != null) builder.header("Content-Type", "application/json");
        return HTTP.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    private static JsonNode ok(HttpResponse<String> response) throws Exception {
        assertEquals(200, response.statusCode(), response.body());
        return JSON.readTree(response.body());
    }
}
