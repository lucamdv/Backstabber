package com.backstabber.config;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DatabaseConfiguration {
    private static final Set<String> LOOPBACK = Set.of("localhost", "127.0.0.1", "[::1]");

    @Bean(destroyMethod = "close")
    HikariDataSource dataSource(@Value("${backstabber.database.url:}") String url,
            @Value("${backstabber.database.ca-certificate:}") String ca,
            @Value("${backstabber.database.allow-loopback-plaintext:false}") boolean allowLoopbackPlaintext) {
        var postgres = postgresSource(url, ca, allowLoopbackPlaintext);
        var config = new HikariConfig();
        config.setPoolName("backstabber-db");
        config.setDataSource(postgres.source());
        config.setMaximumPoolSize(3);
        config.setMinimumIdle(0);
        config.setConnectionTimeout(5000);
        config.setValidationTimeout(2000);
        config.setInitializationFailTimeout(-1);
        try {
            return new HikariDataSource(config) {
                @Override
                public void close() {
                    try {
                        super.close();
                    } finally {
                        postgres.deleteCa();
                    }
                }
            };
        } catch (RuntimeException failure) {
            postgres.deleteCa();
            throw failure;
        }
    }

    static PostgresSource postgresSource(String url, String ca, boolean allowLoopbackPlaintext) {
        var source = new PGSimpleDataSource();
        String host;
        try {
            URI uri = URI.create(url);
            if (!Set.of("postgres", "postgresql").contains(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() == null || uri.getPath() == null || !uri.getPath().matches("/[^/]+")
                    || uri.getFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535
                    || (uri.getRawQuery() != null && !uri.getRawQuery().matches("sslmode=[a-z-]+"))) {
                throw new IllegalArgumentException();
            }
            String[] credentials = uri.getRawUserInfo().split(":", 2);
            if (credentials.length != 2 || credentials[0].isEmpty() || credentials[1].isEmpty()) {
                throw new IllegalArgumentException();
            }
            host = uri.getHost();
            source.setServerNames(new String[]{host});
            source.setPortNumbers(new int[]{uri.getPort() == -1 ? 5432 : uri.getPort()});
            source.setDatabaseName(uri.getPath().substring(1));
            source.setUser(decode(credentials[0]));
            source.setPassword(decode(credentials[1]));
        } catch (IllegalArgumentException | NullPointerException failure) {
            throw new IllegalStateException("Configure DATABASE_URL as a PostgreSQL URI with host, database and credentials.");
        }
        source.setConnectTimeout(3);
        source.setSocketTimeout(12);
        source.setLoginTimeout(5);
        if (allowLoopbackPlaintext && LOOPBACK.contains(host.toLowerCase(Locale.ROOT)) && ca.isBlank()) {
            source.setSslMode("disable");
            return new PostgresSource(source, null);
        }
        source.setSslMode("verify-full");
        String pem = ca.replace("\\n", "\n").strip();
        if (!pem.startsWith("-----BEGIN CERTIFICATE-----") || !pem.endsWith("-----END CERTIFICATE-----")) {
            throw new IllegalStateException("Configure SUPABASE_DB_CA_CERT with the PostgreSQL CA certificate in PEM format.");
        }
        Path caFile = null;
        try {
            caFile = Files.createTempFile("backstabber-postgres-ca-", ".pem");
            Files.writeString(caFile, pem + "\n", StandardCharsets.US_ASCII);
            source.setSslRootCert(caFile.toString());
            return new PostgresSource(source, caFile);
        } catch (IOException failure) {
            new PostgresSource(source, caFile).deleteCa();
            throw new IllegalStateException("Could not prepare the PostgreSQL CA certificate file.");
        }
    }

    private static String decode(String value) {
        return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    record PostgresSource(PGSimpleDataSource source, Path caFile) {
        void deleteCa() {
            if (caFile == null) return;
            try {
                Files.deleteIfExists(caFile);
            } catch (IOException ignored) {
                caFile.toFile().deleteOnExit();
            }
        }
    }
}
