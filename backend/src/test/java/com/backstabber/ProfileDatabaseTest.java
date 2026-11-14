package com.backstabber;

import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProfileDatabaseTest extends SocialIntegrationTest {
    private static final String FIRST_PROFILE = """
            {"id":"%s","username":"first_profile","displayName":"Perfil de São Luís","avatarUrl":null,"showOnline":false}
            """.formatted(FIRST);
    private static final String SECOND_PROFILE = """
            {"id":"%s","username":"second_profile","displayName":"Second Profile","avatarUrl":"https://example.test/avatar.png","showOnline":true}
            """.formatted(SECOND);
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
        var response = request("GET", "/actuator/health/readiness", null, null);
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

    private HttpResponse<String> getProfile(String token, String query) throws Exception {
        return request("GET", "/api/v1/profile" + query, token, null);
    }
}
