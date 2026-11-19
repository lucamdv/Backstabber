package com.backstabber.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import com.backstabber.persistence.GameSchema;

import static org.junit.jupiter.api.Assertions.*;

class StagingIsolationTest {
    private static final String REF = "abcdefghijklmnopqrst";
    private static final String PROD = "ggddochwyxialyxmqbpa";
    private static final String AUTH = "https://" + REF + ".supabase.co";
    private static final String DIRECT = "postgresql://postgres:fixture@db." + REF + ".supabase.co:5432/postgres";
    private static final String POOLER = "@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";

    @Test
    void sharedModeRequiresExplicitStagingSchemaAndRestrictedRoleOnTheApprovedProject() {
        var auth = "https://" + PROD + ".supabase.co";
        var direct = "postgresql://bs_staging_app:fixture@db." + PROD + ".supabase.co:5432/postgres";
        assertDoesNotThrow(() -> StagingIsolation.validateShared(PROD, auth, direct, GameSchema.STAGING));
        assertDoesNotThrow(() -> StagingIsolation.validateShared(PROD, auth,
                "postgresql://bs_staging_app." + PROD + ":fixture" + POOLER, GameSchema.STAGING));
        assertThrows(IllegalStateException.class, () -> StagingIsolation.validateShared(PROD, auth, direct, GameSchema.PUBLIC));
        for (String invalid : new String[]{direct.replace("bs_staging_app:", "postgres:"),
                direct.replace(PROD, REF), direct.replace("/postgres", "/other"),
                "postgresql://postgres." + PROD + ":fixture" + POOLER,
                "postgresql://bs_staging_app." + REF + ":fixture" + POOLER,
                "postgresql://bs_staging_app." + PROD + ":fixture" + POOLER.replace(":5432", ":6543")}) {
            assertThrows(IllegalStateException.class,
                    () -> StagingIsolation.validateShared(PROD, auth, invalid, GameSchema.STAGING));
        }
        assertThrows(IllegalStateException.class, () -> StagingIsolation.validateShared(PROD,
                auth.replace("https:", "http:"), direct, GameSchema.STAGING));
        assertThrows(IllegalStateException.class, () -> StagingIsolation.validateShared(PROD,
                auth + "/auth/v1", direct, GameSchema.STAGING));
    }

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
