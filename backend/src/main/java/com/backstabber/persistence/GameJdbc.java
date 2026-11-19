package com.backstabber.persistence;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Routes the game's constant SQL through the schema selected at startup. */
@Component
public final class GameJdbc {
    private final JdbcClient delegate;
    private final GameSchema schema;

    public GameJdbc(JdbcClient delegate, @Value("${backstabber.database.schema:public}") String schema) {
        this.delegate = delegate;
        this.schema = GameSchema.parse(schema);
    }

    public JdbcClient.StatementSpec sql(String sql) {
        return delegate.sql(schema.qualify(sql));
    }
}
