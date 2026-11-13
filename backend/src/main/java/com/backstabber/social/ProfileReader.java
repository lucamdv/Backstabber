package com.backstabber.social;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileReader {
    private final JdbcTemplate jdbc;
    private final JdbcClient client;

    public ProfileReader(JdbcTemplate jdbc, JdbcClient client) {
        this.jdbc = jdbc;
        this.client = client;
    }

    @Transactional(readOnly = true, timeout = 8)
    public Optional<Profile> findOwnProfile(UUID userId) {
        jdbc.execute("set local lock_timeout = '3s'");
        jdbc.execute("set local statement_timeout = '8s'");
        jdbc.execute("set local idle_in_transaction_session_timeout = '10s'");
        return client.sql("""
                select user_id, username, display_name, avatar_url, show_online
                from public.bs_profiles
                where user_id = :userId
                """)
                .param("userId", userId)
                .query((row, number) -> new Profile(row.getObject("user_id", UUID.class),
                        row.getString("username"), row.getString("display_name"),
                        row.getString("avatar_url"), row.getBoolean("show_online")))
                .optional();
    }
}
