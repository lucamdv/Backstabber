package com.backstabber.config;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/** Checks the effective staging configuration before the application can create its datasource. */
final class StagingIsolation {
    private static final String PRODUCTION = "ggddochwyxialyxmqbpa";
    private static final Pattern PROJECT_REF = Pattern.compile("[a-z]{20}");
    private static final Pattern POOLER = Pattern.compile("aws-[0-9]+-[a-z0-9-]+\\.pooler\\.supabase\\.com");

    private StagingIsolation() {}

    static void validate(String projectRef, String authUrl, String databaseUrl) {
        if (!PROJECT_REF.matcher(projectRef).matches() || PRODUCTION.equals(projectRef)) {
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
        String info = database.getUserInfo();
        String role = info == null ? "" : info.split(":", 2)[0];
        String host = host(database);
        boolean direct = ("db." + projectRef + ".supabase.co").equals(host)
                && (database.getPort() == -1 || database.getPort() == 5432);
        boolean pooled = POOLER.matcher(host).matches() && ("postgres." + projectRef).equals(role)
                && (database.getPort() == 5432 || database.getPort() == 6543);
        if (!("postgresql".equals(database.getScheme()) || "postgres".equals(database.getScheme()))
                || !(direct || pooled) || role.contains(PRODUCTION)) {
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
