package com.backstabber.config;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.*;

class DatabaseConfigurationTest {
    private static final String CA_FIXTURE = "-----BEGIN CERTIFICATE-----\\nfixture\\n-----END CERTIFICATE-----";

    @Test
    void convertsEncodedCredentialsAndUsesBoundedLoopbackConnections() {
        var source = DatabaseConfiguration.postgresSource(
                "postgresql://fixture%2Brole:foo%40bar+baz@127.0.0.1:55477/fixture", "", true).source();
        assertEquals("fixture+role", source.getUser());
        assertEquals("foo@bar+baz", source.getPassword());
        assertEquals(55477, source.getPortNumbers()[0]);
        assertEquals("disable", source.getSslMode());
        assertEquals(3, source.getConnectTimeout());
        assertEquals(12, source.getSocketTimeout());
        assertEquals(5, source.getLoginTimeout());
    }

    @Test
    void enforcesRemoteCertificateAndHostnameEvenWithInsecureSslMode() throws Exception {
        var connection = DatabaseConfiguration.postgresSource(
                "postgresql://fixture:fixture@db.example.test/fixture?sslmode=disable", CA_FIXTURE, true);
        try {
            assertEquals("verify-full", connection.source().getSslMode());
            assertEquals(connection.caFile().toString(), connection.source().getSslRootCert());
            assertEquals(CA_FIXTURE.replace("\\n", "\n") + "\n", Files.readString(connection.caFile()));
        } finally {
            connection.deleteCa();
        }
        assertFalse(Files.exists(connection.caFile()));
    }

    @Test
    void rejectsInsecureOrMalformedConfigurationWithoutEchoingSecrets() {
        assertThrows(IllegalStateException.class, () -> DatabaseConfiguration.postgresSource(
                "postgresql://fixture:fixture@db.example.test/fixture", "", true));
        assertThrows(IllegalStateException.class, () -> DatabaseConfiguration.postgresSource(
                "postgresql://fixture:fixture@127.0.0.1/fixture", "", false));
        var failure = assertThrows(IllegalStateException.class, () -> DatabaseConfiguration.postgresSource(
                "postgresql://fixture:fixture-sensitive@db.example.test/fixture?sslfactory=override", CA_FIXTURE, true));
        assertTrue(failure.getMessage().contains("DATABASE_URL"));
        assertFalse(failure.getMessage().contains("fixture-sensitive"));
    }
}
