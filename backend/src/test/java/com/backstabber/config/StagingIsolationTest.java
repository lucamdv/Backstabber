package com.backstabber.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.junit.jupiter.api.Assertions.*;

class StagingIsolationTest {
    private static final String REF = "abcdefghijklmnopqrst";
    private static final String PROD = "ggddochwyxialyxmqbpa";
    private static final String AUTH = "https://" + REF + ".supabase.co";
    private static final String DIRECT = "postgresql://postgres:fixture@db." + REF + ".supabase.co:5432/postgres";
    private static final String POOLER = "@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";

    @Test
    void acceptsMatchingDirectAndPoolerDestinationsWithoutConnecting() {
        assertDoesNotThrow(() -> StagingIsolation.validate(REF, AUTH, DIRECT));
        assertDoesNotThrow(() -> StagingIsolation.validate(REF, AUTH + "/",
                "postgresql://postgres." + REF + ":fixture" + POOLER));
    }

    @Test
    void rejectsProductionAndUnverifiableDestinations() {
        reject("", AUTH, DIRECT);
        reject(PROD, AUTH, DIRECT);
        reject(REF, "https://" + PROD + ".supabase.co", DIRECT);
        reject(REF, AUTH, DIRECT.replace(REF, PROD));
        reject(REF, AUTH, "postgresql://postgres%2E" + PROD + ":fixture" + POOLER);
        reject(REF, AUTH, "postgresql://postgres:fixture" + POOLER);
        reject(REF, AUTH, DIRECT.replace(".supabase.co", ".supabase.co.example.test"));
        reject(REF, AUTH, "postgresql://postgres:fixture@127.0.0.1:5432/postgres");
        reject(REF, AUTH + "/auth/v1", DIRECT);
        reject(REF, AUTH.replace("https", "http"), DIRECT);
    }

    @Test
    void refusesBeforeDatasourceCreationEvenWhenPlaintextIsEnabled() {
        var environment = new MockEnvironment().withProperty("backstabber.staging.project-ref", REF)
                .withProperty("backstabber.auth.url", AUTH);
        environment.setActiveProfiles("homologation", "dev");
        var failure = assertThrows(IllegalStateException.class, () -> new DatabaseConfiguration()
                .dataSource(environment, "postgresql://postgres:fixture-sensitive@127.0.0.1/postgres", "", true));
        assertTrue(failure.getMessage().contains("DATABASE_URL"));
        assertFalse(failure.getMessage().contains("fixture-sensitive"));
    }

    private static void reject(String ref, String auth, String db) {
        assertThrows(IllegalStateException.class, () -> StagingIsolation.validate(ref, auth, db));
    }
}
