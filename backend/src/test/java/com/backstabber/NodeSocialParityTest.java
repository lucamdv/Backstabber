package com.backstabber;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NodeSocialParityTest extends SocialIntegrationTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "BACKSTABBER_NODE_PARITY", matches = "true")
    void comparesNodeAndJavaOnIdenticalPostgresFixtures(@TempDir Path temp) throws Exception {
        var root = Path.of("..").toAbsolutePath().normalize();
        var output = temp.resolve("node-social-parity.log");
        var builder = new ProcessBuilder("node", "--import", "tsx", root.resolve("backend/src/test/resources/social-parity.mjs").toString())
                .directory(root.resolve("web").toFile()).redirectErrorStream(true).redirectOutput(output.toFile());
        builder.environment().put("BACKSTABBER_PARITY_DATABASE_URL", fixtureDatabaseUrl);
        builder.environment().put("BACKSTABBER_PARITY_JAVA_URL", "http://127.0.0.1:" + port);
        Process process = builder.start();
        try {
            assertTrue(process.waitFor(60, TimeUnit.SECONDS), "Node parity runner timed out");
            String result = Files.readString(output);
            assertEquals(0, process.exitValue(), result);
            System.out.print(result);
        } finally {
            if (process.isAlive()) process.destroyForcibly();
        }
    }
}
