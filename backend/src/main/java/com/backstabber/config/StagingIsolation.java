package com.backstabber.config;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;
import com.backstabber.persistence.GameSchema;

/** Checks the effective staging configuration before the application can create its datasource. */
final class StagingIsolation {
    private static final String PRODUCTION = "ggddochwyxialyxmqbpa";
    private static final Pattern PROJECT_REF = Pattern.compile("[a-z]{20}");
    private static final Pattern POOLER = Pattern.compile("aws-[0-9]+-[a-z0-9-]+\\.pooler\\.supabase\\.com");

    private StagingIsolation() {}

    static void validate(String projectRef, String authUrl, String databaseUrl) {
        validateDestination(projectRef, authUrl, databaseUrl, false);
    }

    static void validateShared(String projectRef, String authUrl, String databaseUrl, GameSchema schema) {
        if (schema != GameSchema.STAGING) {
            throw new IllegalStateException("Shared homologation requires BACKSTABBER_GAME_SCHEMA=bs_staging.");
        }
        validateDestination(projectRef, authUrl, databaseUrl, true);
    }

    private static void validateDestination(String projectRef, String authUrl, String databaseUrl, boolean shared) {
        if (!PROJECT_REF.matcher(projectRef).matches() || (!shared && PRODUCTION.equals(projectRef))) {
            throw new IllegalStateException("Configure BACKSTABBER_STAGING_PROJECT_REF with the approved staging project.");
        }
        URI auth = parse(authUrl, "SUPABASE_URL");
        if (!"https".equals(auth.getScheme()) || !(projectRef + ".supabase.co").equals(host(auth))
                || auth.getRawUserInfo() != null || auth.getRawQuery() != null || auth.getRawFragment() != null
                || !(auth.getPort() == -1 || auth.getPort() == 443)
                || !(auth.getRawPath().isEmpty() || "/".equals(auth.getRawPath()))) {
            throw new IllegalStateException("SUPABASE_URL must be the approved HTTPS staging project origin.");
        }

        URI database = parse(databaseUrl, "DATABASE_URL");
        String info = database.getRawUserInfo();
        String role = info == null ? "" : URLDecoder.decode(info.split(":", 2)[0].replace("+", "%2B"), StandardCharsets.UTF_8);
        String host = host(database);
        boolean direct = ("db." + projectRef + ".supabase.co").equals(host)
                && (database.getPort() == -1 || database.getPort() == 5432);
        boolean pooled = POOLER.matcher(host).matches()
                && (shared ? ("bs_staging_app." + projectRef).equals(role) : ("postgres." + projectRef).equals(role))
                && (database.getPort() == 5432 || (!shared && database.getPort() == 6543));
        if (shared && ((direct && !"bs_staging_app".equals(role)) || !"/postgres".equals(database.getRawPath())
                || database.getRawFragment() != null || info == null || info.split(":", 2).length != 2
                || (database.getRawQuery() != null && !database.getRawQuery().matches("sslmode=[a-z-]+")))) {
            throw new IllegalStateException("Shared DATABASE_URL requires the restricted staging role and approved PostgreSQL endpoint.");
        }
        if (!("postgresql".equals(database.getScheme()) || "postgres".equals(database.getScheme()))
                || !(direct || pooled) || (!shared && role.contains(PRODUCTION))) {
            throw new IllegalStateException("DATABASE_URL must point to the approved staging PostgreSQL project.");
        }
    }

    private static URI parse(String value, String variable) {
        try {
            var result = URI.create(value);
            if (result.getHost() != null) return result;
        } catch (IllegalArgumentException invalid) {
            // URI parsing errors can echo credentials. Use a fixed message below.
        }
        throw new IllegalStateException("Invalid staging " + variable + ".");
    }

    private static String host(URI uri) {
        return uri.getHost().toLowerCase(Locale.ROOT);
    }
}
