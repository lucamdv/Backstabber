package com.backstabber.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component("dbHealthIndicator")
public class DatabaseHealth implements HealthIndicator {
    private static final Logger log = LoggerFactory.getLogger(DatabaseHealth.class);
    private final JdbcTemplate jdbc;

    public DatabaseHealth(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Health health() {
        try {
            jdbc.queryForObject("select 1", Integer.class);
            return Health.up().build();
        } catch (DataAccessException failure) {
            log.atWarn().addKeyValue("type", failure.getClass().getSimpleName()).log("Database readiness check failed");
            return Health.down().build();
        }
    }
}
