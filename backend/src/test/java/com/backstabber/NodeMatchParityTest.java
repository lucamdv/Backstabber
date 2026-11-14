package com.backstabber;

import com.backstabber.game.random.GameRandom;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(NodeMatchParityTest.FixedRandom.class)
class NodeMatchParityTest extends SocialIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    static class FixedRandom {
        @Bean
        @Primary
        GameRandom parityRandom() {
            return () -> 0.5;
        }
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BACKSTABBER_NODE_PARITY", matches = "true")
    void comparesNodeAndJavaOnIdenticalPostgresFixtures(@TempDir Path temp) throws Exception {
        var root = Path.of("..").toAbsolutePath().normalize();
        var output = temp.resolve("node-match-parity.log");
        var builder = new ProcessBuilder("node", "--import", "tsx", root.resolve("backend/src/test/resources/match-parity.mjs").toString())
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
