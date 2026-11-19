package com.backstabber.persistence;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.postgresql.ds.PGSimpleDataSource;

import static org.junit.jupiter.api.Assertions.*;

class GameJdbcTest {
    @Test
    void routesAllQualifiedGameTablesToTheSelectedSchema() {
        var query = "select p.user_id from public.bs_profiles p join public.bs_rooms r on r.host_id = p.user_id";
        assertEquals(query, GameSchema.parse("public").qualify(query));
        assertEquals("select p.user_id from bs_staging.bs_profiles p join bs_staging.bs_rooms r on r.host_id = p.user_id",
                GameSchema.parse("bs_staging").qualify(query));
    }

    @Test
    void rejectsSchemaInjectionAndFallbackSearchPathsBeforeExecutingSql() {
        var delegate = JdbcClient.create(new PGSimpleDataSource());
        for (String invalid : new String[]{"", "PUBLIC", "bs_staging,public", "bs_staging;drop schema public",
                "auth", "public ", " pg_catalog", "bs_staging.bs_profiles"}) {
            assertThrows(IllegalStateException.class, () -> new GameJdbc(delegate, invalid));
        }
    }
}
