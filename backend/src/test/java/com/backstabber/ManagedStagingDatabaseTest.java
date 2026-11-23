package com.backstabber;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIf;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Disposable ordinary PostgreSQL model of the audited managed grant restrictions.
 * The positive fixture creates messages under its executor ONLY to model policy authority.
 * It does not prove hosted Supabase/supautils policy delegation. No remote target is accepted.
 */
@EnabledIf(value = "databaseRequested", disabledReason = "Requires Testcontainers or a disposable local PostgreSQL cluster.")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ManagedStagingDatabaseTest {
    private static final UUID FIRST = SocialIntegrationTest.FIRST;
    private static final UUID SECOND = SocialIntegrationTest.SECOND;
    private static final UUID THIRD = SocialIntegrationTest.THIRD;
    private static final String PASSWORD = "disposable-managed-test-only";
    private static final String EXECUTOR = "bs_managed_fixture_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NEGATIVE_EXECUTOR = "bs_managed_denied_" + UUID.randomUUID().toString().replace("-", "");
    private static final String MIGRATION = "20261119000101_backstabber_shared_staging.sql";
    private static String jdbcUrl;
    private static String adminUser;
    private static String adminPassword;
    private static List<String> originalPolicies;

    static boolean databaseRequested() {
        return SocialIntegrationTest.databaseRequested();
    }

    @BeforeAll
    static void start() throws Exception {
        Map<String, Object> properties = new LinkedHashMap<>();
        SocialIntegrationTest.startFixtures((key, supplier) -> properties.put(key, supplier.get()), messagesBootstrap());
        URI database = URI.create(properties.get("backstabber.database.url").toString());
        assertEquals("127.0.0.1", database.getHost(), "Only disposable loopback databases are allowed");
        String[] credentials = database.getUserInfo().split(":", 2);
        adminUser = credentials[0];
        adminPassword = credentials[1];
        jdbcUrl = "jdbc:postgresql://127.0.0.1:" + database.getPort() + database.getPath() + "?connectTimeout=3";
        try (Connection admin = admin()) {
            execute(admin, "grant create on database " + database.getPath().substring(1) + " to " + EXECUTOR + "," + NEGATIVE_EXECUTOR);
            execute(admin, "grant usage on schema auth to " + EXECUTOR + "," + NEGATIVE_EXECUTOR);
            execute(admin, "grant insert on realtime.messages to " + NEGATIVE_EXECUTOR + " with grant option");
            execute(admin, "insert into auth.users values ('" + FIRST + "'), ('" + SECOND + "'), ('" + THIRD + "');"
                    + " insert into public.bs_profiles(user_id,username,display_name) values ('" + FIRST
                    + "','public_first','Original public profile')");
        }
        originalPolicies = legacyPolicies();
    }

    @AfterAll
    static void stop() throws Exception {
        try {
            if (jdbcUrl != null) {
                try (Connection admin = admin()) {
                    if ("1".equals(scalar(admin, "select count(*) from pg_namespace where nspname='bs_staging'"))) {
                        // Revoke grants as their original grantor, just as the lifecycle test does.
                        try (Connection executor = executor()) {
                            executeStrict(executor, rollback());
                        }
                    }
                    // Dispose of this test-created table; no existing object ever changes owner.
                    execute(admin, "drop table realtime.messages;"
                            + " revoke usage on schema auth, realtime from " + EXECUTOR + "," + NEGATIVE_EXECUTOR + ";"
                            + " revoke create on database " + scalar(admin, "select current_database()")
                            + " from " + EXECUTOR + "," + NEGATIVE_EXECUTOR + ";"
                            + " drop role " + EXECUTOR + "," + NEGATIVE_EXECUTOR);
                }
            }
        } finally {
            SocialIntegrationTest.stopFixtures();
        }
    }

    @Test
    @Order(1)
    void fixtureHasAuditedEffectiveRestrictionsAndRejectsSilentGrantWarnings() throws Exception {
        try (Connection executor = negativeExecutor()) {
            assertEquals("false:true:true:false:false", scalar(executor, "select rolsuper || ':' || rolcreatedb || ':' || rolcreaterole"
                    + " || ':' || rolreplication || ':' || rolbypassrls from pg_roles where rolname=current_user"));
            assertEquals("true:false:false:false:true:false:true:true", scalar(executor, "select "
                    + "has_schema_privilege(current_user,'auth','USAGE') || ':' || "
                    + "has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION') || ':' || "
                    + "has_table_privilege(current_user,'auth.users','REFERENCES') || ':' || "
                    + "has_any_column_privilege(current_user,'auth.users','REFERENCES') || ':' || "
                    + "has_function_privilege(current_user,'realtime.send(jsonb,text,text,boolean)','EXECUTE') || ':' || "
                    + "has_function_privilege(current_user,'realtime.send(jsonb,text,text,boolean)','EXECUTE WITH GRANT OPTION') || ':' || "
                    + "has_schema_privilege(current_user,'realtime','USAGE WITH GRANT OPTION') || ':' || "
                    + "has_table_privilege(current_user,'realtime.messages','INSERT WITH GRANT OPTION')"));
            assertEquals("f", scalar(executor, "select prosecdef from pg_proc where oid='realtime.send(jsonb,text,text,boolean)'::regprocedure"));
            assertEquals("0", scalar(executor, "select count(*) from pg_auth_members where member=(select oid from pg_roles where rolname=current_user)"));
            execute(executor, "begin");
            SQLException warning = assertThrows(SQLException.class,
                    () -> executeStrict(executor, "grant usage on schema auth to " + NEGATIVE_EXECUTOR));
            assertEquals("01007", warning.getSQLState(), "No-op GRANT warnings must fail the verification harness");
            execute(executor, "rollback");
        }
        try (Connection executor = executor()) {
            assertEquals("t", scalar(executor, "select "
                    + "not has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION') and "
                    + "not has_any_column_privilege(current_user,'auth.users','REFERENCES') and "
                    + "not has_function_privilege(current_user,'realtime.send(jsonb,text,text,boolean)','EXECUTE WITH GRANT OPTION')"));
            assertEquals(EXECUTOR, scalar(executor, "select pg_get_userbyid(relowner) from pg_class where oid='realtime.messages'::regclass"));
            assertEquals("f", scalar(executor, "select has_schema_privilege(current_user,'realtime','CREATE')"),
                    "The creation-only schema privilege must be revoked after fixture bootstrap");
        }
    }

    @Test
    @Order(2)
    void missingPolicyAuthorityAbortsAtomicallyEvenWithDelegableRealtimeInsert() throws Exception {
        try (Connection executor = negativeExecutor()) {
            assertNotEquals(NEGATIVE_EXECUTOR, scalar(executor,
                    "select pg_get_userbyid(relowner) from pg_class where oid='realtime.messages'::regclass"));
            SQLException failure = assertThrows(SQLException.class, () -> executeStrict(executor, migration()));
            assertEquals("42501", failure.getSQLState(), failure.getMessage());
            assertTrue(failure.getMessage().contains("must be owner of table messages"), failure.getMessage());
            execute(executor, "rollback");
        }
        assertNoStagingResidue();
        assertSharedUnchanged();
    }

    @Test
    @Order(3)
    void nonSuperuserInstallRunsTriggersAndKeepsRuntimeAndPrivateTopicsRestricted() throws Exception {
        // Ownership at fixture creation models ordinary-PG policy authority, never hosted delegation.
        try (Connection executor = executor()) {
            assertDoesNotThrow(() -> executeStrict(executor, migration()),
                    "Migration must not require managed Auth REFERENCES/USAGE grant option or send EXECUTE grant option");
            executeStrict(executor, "alter role bs_staging_app password '" + PASSWORD + "'");
        }
        try (Connection app = app()) {
            executeStrict(app, "select bs_staging.assert_runtime_role()");
            executeStrict(app, "insert into bs_staging.bs_profiles(user_id,username,display_name) values "
                    + "('" + FIRST + "','managed_first','First'),('" + SECOND + "','managed_second','Second'),"
                    + "('" + THIRD + "','managed_third','Third')");
            executeStrict(app, "insert into bs_staging.bs_rooms(id,code,host_id,capacity) values "
                    + "('" + roomId() + "','AABBCCDDEE','" + FIRST + "',2)");
            executeStrict(app, "insert into bs_staging.bs_room_members(room_id,user_id) values "
                    + "('" + roomId() + "','" + FIRST + "')");
            executeStrict(app, "insert into bs_staging.bs_friend_requests(sender_id,recipient_id) values ('" + FIRST + "','" + SECOND + "')");
            for (String sql : List.of("select * from auth.users", "select * from public.bs_profiles",
                    "insert into public.bs_profiles select * from public.bs_profiles where false",
                    "update public.bs_profiles set display_name='Forbidden' where false", "delete from public.bs_profiles where false",
                    "truncate bs_staging.bs_profiles", "create table bs_staging.forbidden(id integer)",
                    "set role bs_staging_owner", "set role " + EXECUTOR,
                    "select bs_staging.room_invalidation()", "select bs_staging.social_invalidation()",
                    "insert into realtime.messages values ('hml:room:" + roomId() + "','broadcast','{}','forged',true)",
                    "select realtime.send('{}'::jsonb,'forged','hml:user:" + FIRST + "',true)")) {
                denied(app, sql);
            }
            try (Connection executor = executor(); Connection observer = admin()) {
                // Resolve and invoke PUBLIC send() explicitly: lack of INSERT must still stop it.
                executeStrict(executor, "grant usage on schema realtime to bs_staging_app");
                try {
                    assertEquals("t", scalar(app, "select has_schema_privilege(current_user,'realtime','USAGE')"));
                    assertEquals("t", scalar(app, "select has_function_privilege(current_user,"
                            + "'realtime.send(jsonb,text,text,boolean)','EXECUTE')"));
                    String messagesBefore = scalar(observer, "select count(*) from realtime.messages");
                    denied(app, "select realtime.send('{\"kind\":\"social\"}'::jsonb,'invalidate','hml:user:" + FIRST + "',true)");
                    assertEquals(messagesBefore, scalar(observer, "select count(*) from realtime.messages"));
                    executeStrict(app, "select bs_staging.assert_runtime_role()");
                } finally {
                    executeStrict(executor, "revoke usage on schema realtime from bs_staging_app");
                }
                executeStrict(executor, "grant insert on realtime.messages to bs_staging_app");
                try {
                    denied(app, "select bs_staging.assert_runtime_role()");
                } finally {
                    executeStrict(executor, "revoke insert on realtime.messages from bs_staging_app");
                }
                executeStrict(app, "select bs_staging.assert_runtime_role()");
            }
        }
        try (Connection admin = admin()) {
            assertEquals("0", scalar(admin, "select count(*) from pg_auth_members where member in "
                    + "(select oid from pg_roles where rolname in ('bs_staging_app','bs_staging_owner'))"));
            assertEquals("0", scalar(admin, "select count(*) from pg_roles where rolname in ('bs_staging_app','bs_staging_owner')"
                    + " and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit)"));
            assertEquals("f", scalar(admin, "select rolcanlogin from pg_roles where rolname='bs_staging_owner'"));
            assertEquals("f", scalar(admin, "select has_schema_privilege('bs_staging_owner','auth','USAGE')"));
            assertEquals("f", scalar(admin, "select has_any_column_privilege('bs_staging_owner','auth.users','SELECT,INSERT,UPDATE,REFERENCES')"));
            assertNotEquals("0", scalar(admin, "select count(*) from realtime.messages"));
            assertEquals("0", scalar(admin, "select count(*) from realtime.messages where topic not like 'hml:%'"
                    + " or private is distinct from true or event <> 'invalidate' or extension <> 'broadcast'"
                    + " or payload not in ('{\"kind\":\"room\"}'::jsonb,'{\"kind\":\"social\"}'::jsonb)"));
            // Broad legacy policies must not open the private hml namespace.
            execute(admin, "create policy fixture_managed_receive on realtime.messages for select to authenticated using(true);"
                    + " create policy fixture_managed_insert on realtime.messages for insert to authenticated with check(true)");
        }
        try {
            assertEquals("1", received(FIRST, "hml:user:" + FIRST));
            assertEquals("0", received(SECOND, "hml:user:" + FIRST));
            assertNotEquals("0", received(FIRST, "hml:room:" + roomId()));
            assertEquals("0", received(THIRD, "hml:room:" + roomId()));
            try (Connection member = authenticated(FIRST, "hml:room:" + roomId());
                 Connection outsider = authenticated(THIRD, "hml:room:" + roomId())) {
                executeStrict(member, message("hml:room:" + roomId(), "presence", true));
                denied(member, message("hml:room:" + roomId(), "broadcast", true));
                denied(outsider, message("hml:room:" + roomId(), "presence", true));
                denied(member, message("hml:user:" + FIRST, "presence", true));
                denied(member, "select ready from bs_staging.bs_room_members");
                assertEquals("1", scalar(member, "select count(user_id) from bs_staging.bs_room_members"));
                executeStrict(member, message("legacy:unchanged", "broadcast", true));
            }
            assertEquals("1", received(THIRD, "legacy:unchanged"));
        } finally {
            try (Connection admin = admin()) {
                execute(admin, "drop policy fixture_managed_receive on realtime.messages; drop policy fixture_managed_insert on realtime.messages");
            }
        }
        assertSharedUnchanged();
    }

    @Test
    @Order(4)
    void authForeignKeyIsAbsentInternalForeignKeysRemainAndAuthDeletionLeavesOrphan() throws Exception {
        try (Connection admin = admin(); Connection app = app()) {
            assertEquals("0", scalar(admin, "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace"
                    + " where n.nspname='bs_staging' and c.contype='f' and c.confrelid='auth.users'::regclass"));
            assertEquals("13", scalar(admin, "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace"
                    + " join pg_class referenced on referenced.oid=c.confrelid join pg_namespace rn on rn.oid=referenced.relnamespace"
                    + " where n.nspname='bs_staging' and c.contype='f' and rn.nspname='bs_staging'"));
            SQLException missingProfile = assertThrows(SQLException.class, () -> executeStrict(app,
                    "insert into bs_staging.bs_room_members(room_id,user_id) values ('" + roomId() + "','" + UUID.randomUUID() + "')"));
            assertEquals("23503", missingProfile.getSQLState());
            executeStrict(admin, "delete from auth.users where id='" + THIRD + "'");
            assertEquals("1", scalar(app, "select count(*) from bs_staging.bs_profiles where user_id='" + THIRD + "'"),
                    "No Auth FK means deletion cleanup is deliberately an explicit lifecycle operation");
            executeStrict(admin, "insert into auth.users values ('" + THIRD + "')");
        }
        assertSharedUnchanged();
    }

    @Test
    @Order(100)
    void restrictedExecutorRollsBackAndReappliesWithoutChangingSharedRowsOrLegacyPolicies() throws Exception {
        try (Connection executor = executor()) {
            executeStrict(executor, rollback());
            assertNoStagingResidue();
            assertSharedUnchanged();
            executeStrict(executor, migration());
            executeStrict(executor, "alter role bs_staging_app password '" + PASSWORD + "'");
        }
        try (Connection app = app()) {
            executeStrict(app, "select bs_staging.assert_runtime_role()");
            assertEquals("0", scalar(app, "select count(*) from bs_staging.bs_profiles"));
        }
        assertSharedUnchanged();
    }

    private static void assertNoStagingResidue() throws SQLException {
        try (Connection admin = admin()) {
            assertEquals("0", scalar(admin, "select count(*) from pg_namespace where nspname='bs_staging'"));
            assertEquals("0", scalar(admin, "select count(*) from pg_roles where rolname in ('bs_staging_owner','bs_staging_app')"));
            assertEquals("0", scalar(admin, "select count(*) from pg_policies where schemaname='realtime' and policyname like 'bs_staging_%'"));
        }
    }

    private static void assertSharedUnchanged() throws SQLException {
        try (Connection admin = admin()) {
            assertEquals("3", scalar(admin, "select count(*) from auth.users"));
            assertEquals(FIRST + "," + SECOND + "," + THIRD,
                    scalar(admin, "select string_agg(id::text,',' order by id) from auth.users"));
            assertEquals("1", scalar(admin, "select count(*) from public.bs_profiles"));
            assertEquals("Original public profile", scalar(admin, "select display_name from public.bs_profiles where user_id='" + FIRST + "'"));
            for (String table : List.of("bs_friend_requests", "bs_friends", "bs_rooms", "bs_room_members",
                    "bs_invites", "bs_matches", "bs_match_commands")) {
                assertEquals("0", scalar(admin, "select count(*) from public." + table), table);
            }
        }
        assertEquals(originalPolicies, legacyPolicies());
    }

    private static List<String> legacyPolicies() throws SQLException {
        List<String> policies = new ArrayList<>();
        try (Connection admin = admin(); var statement = admin.createStatement(); var rows = statement.executeQuery("""
                select schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || roles::text
                  || ':' || cmd || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'')
                from pg_policies where schemaname='public' or
                  (schemaname='realtime' and policyname not like 'bs_staging_%')
                order by schemaname,tablename,policyname
                """)) {
            while (rows.next()) policies.add(rows.getString(1));
        }
        return policies;
    }

    private static UUID roomId() {
        return UUID.fromString("b6100000-0000-0000-0000-000000000099");
    }

    private static String messagesBootstrap() {
        String roleAttributes = " login password '" + PASSWORD
                + "' nosuperuser createdb createrole noreplication nobypassrls noinherit;";
        return "create role " + EXECUTOR + roleAttributes
                + " create role " + NEGATIVE_EXECUTOR + roleAttributes
                + " grant usage on schema realtime to " + EXECUTOR + "," + NEGATIVE_EXECUTOR + " with grant option;"
                + " grant create on schema realtime to " + EXECUTOR + ";"
                + " set role " + EXECUTOR + ";"
                + " create table realtime.messages (topic text, extension text, payload jsonb, event text, private boolean);"
                + " reset role; revoke create on schema realtime from " + EXECUTOR + ";";
    }

    private static String migration() throws Exception {
        return Files.readString(sqlFile("migrations", MIGRATION));
    }

    private static String rollback() throws Exception {
        return Files.readString(sqlFile("rollbacks", "20261119000101_backstabber_shared_staging.rollback.sql"));
    }

    private static Path sqlFile(String directory, String name) {
        Path path = Path.of("..", "supabase", directory, name);
        return Files.isRegularFile(path) ? path : Path.of("supabase", directory, name);
    }

    private static Connection admin() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, adminUser, adminPassword);
    }

    private static Connection executor() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, EXECUTOR, PASSWORD);
    }

    private static Connection negativeExecutor() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, NEGATIVE_EXECUTOR, PASSWORD);
    }

    private static Connection app() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, "bs_staging_app", PASSWORD);
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    /** A GRANT without grant option can emit SQLWARNING 01007 and otherwise succeed. */
    private static void executeStrict(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute(sql);
            for (SQLWarning warning = statement.getWarnings(); warning != null; warning = warning.getNextWarning()) {
                if ("WARNING".equalsIgnoreCase(warning instanceof org.postgresql.util.PSQLWarning pg
                        ? pg.getServerErrorMessage().getSeverity() : "WARNING")) {
                    throw new SQLException("SQL warning must not be ignored: " + warning.getMessage(), warning.getSQLState(), warning);
                }
            }
        }
    }

    private static String scalar(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next());
            return rows.getString(1);
        }
    }

    private static void denied(Connection connection, String sql) {
        SQLException denied = assertThrows(SQLException.class, () -> executeStrict(connection, sql), sql);
        assertEquals("42501", denied.getSQLState(), sql + ": " + denied.getMessage());
    }

    private static Connection authenticated(UUID user, String topic) throws SQLException {
        Connection connection = admin();
        try {
            executeStrict(connection, "set role authenticated; set request.jwt.claim.sub='" + user + "'; set realtime.topic='" + topic + "'");
            return connection;
        } catch (SQLException failure) {
            connection.close();
            throw failure;
        }
    }

    private static String received(UUID user, String topic) throws SQLException {
        try (Connection member = authenticated(user, topic)) {
            return scalar(member, "select count(*) from realtime.messages where topic='" + topic + "'");
        }
    }

    private static String message(String topic, String extension, boolean privateMessage) {
        return "insert into realtime.messages values ('" + topic + "','" + extension + "','{}','fixture'," + privateMessage + ")";
    }
}
