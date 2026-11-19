package com.backstabber.persistence;

public enum GameSchema {
    PUBLIC("public"),
    STAGING("bs_staging");

    private final String sqlName;

    GameSchema(String sqlName) {
        this.sqlName = sqlName;
    }

    public static GameSchema parse(String value) {
        if ("public".equals(value)) return PUBLIC;
        if ("bs_staging".equals(value)) return STAGING;
        throw new IllegalStateException("BACKSTABBER_GAME_SCHEMA must be public or bs_staging.");
    }

    public String sqlName() {
        return sqlName;
    }

    String qualify(String sql) {
        return sql.replace("public.bs_", sqlName + ".bs_");
    }
}
