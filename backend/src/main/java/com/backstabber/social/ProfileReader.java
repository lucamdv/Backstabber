package com.backstabber.social;

import java.net.URI;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import com.backstabber.persistence.TransactionLimits;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileReader {
    private static final Pattern USERNAME = Pattern.compile("[a-z0-9_]{3,18}");
    private static final Pattern PREFIX = Pattern.compile("[a-z0-9_]{1,18}");
    private final JdbcTemplate jdbc;
    private final JdbcClient client;

    public ProfileReader(JdbcTemplate jdbc, JdbcClient client) {
        this.jdbc = jdbc;
        this.client = client;
    }

    @Transactional(readOnly = true, timeout = 8)
    public Optional<Profile> findOwnProfile(UUID userId) {
        TransactionLimits.apply(jdbc);
        return client.sql("""
                select user_id, username, display_name, avatar_url, show_online
                from public.bs_profiles
                where user_id = :userId
                """)
                .param("userId", userId)
                .query(ProfileReader::profile)
                .optional();
    }

    @Transactional(timeout = 8)
    public Profile update(UUID userId, RequestInput input) {
        TransactionLimits.apply(jdbc);
        String username = RequestInput.trim(input.text("username")).toLowerCase(Locale.ROOT);
        String displayName = RequestInput.trim(input.text("displayName"));
        if (!USERNAME.matcher(username).matches() || displayName.isEmpty() || displayName.length() > 40) {
            throw ApiFailure.badRequest("INVALID_PROFILE");
        }
        String avatarUrl = avatar(input);
        Boolean showOnline = input.has("showOnline") ? input.requiredBoolean("showOnline") : null;
        try {
            return client.sql("""
                    insert into public.bs_profiles as p (user_id, username, display_name, avatar_url, show_online)
                    values (:userId, :username, :displayName, :avatarUrl, coalesce(:showOnline, false))
                    on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name,
                        avatar_url = excluded.avatar_url, show_online = coalesce(:showOnline, p.show_online)
                    returning user_id, username, display_name, avatar_url, show_online
                    """)
                    .param("userId", userId).param("username", username).param("displayName", displayName)
                    .param("avatarUrl", avatarUrl, Types.VARCHAR).param("showOnline", showOnline, Types.BOOLEAN)
                    .query(ProfileReader::profile).single();
        } catch (DuplicateKeyException duplicate) {
            throw new ApiFailure(HttpStatus.CONFLICT, "USERNAME_TAKEN");
        }
    }

    @Transactional(timeout = 8)
    public void heartbeat(UUID userId) {
        TransactionLimits.apply(jdbc);
        client.sql("""
                update public.bs_profiles set last_seen = now()
                where user_id = :userId and (last_seen is null or last_seen <= now() - interval '10 seconds')
                """).param("userId", userId).update();
    }

    @Transactional(readOnly = true, timeout = 8)
    public List<Profile> search(UUID userId, String username) {
        TransactionLimits.apply(jdbc);
        String prefix = RequestInput.trim(username).toLowerCase(Locale.ROOT);
        if (!PREFIX.matcher(prefix).matches()) return List.of();
        return client.sql("""
                select user_id, username, display_name, avatar_url, show_online
                from public.bs_profiles where user_id <> :userId and username like :pattern
                order by username limit 20
                """).param("userId", userId).param("pattern", prefix.replace("_", "\\_") + "%")
                .query(ProfileReader::profile).list();
    }

    private static Profile profile(ResultSet row, int number) throws SQLException {
        return new Profile(row.getObject("user_id", UUID.class), row.getString("username"),
                row.getString("display_name"), row.getString("avatar_url"), row.getBoolean("show_online"));
    }

    private static String avatar(RequestInput input) {
        var value = input.node("avatarUrl");
        if (value.isNull() || value.isMissingNode()) return null;
        if (value.isTextual()) {
            String text = value.asString();
            if (text.isEmpty()) return null;
            if (text.length() <= 2048 && text.startsWith("https://")) {
                try {
                    URI uri = URI.create(text);
                    if (uri.getHost() != null && uri.getUserInfo() == null && uri.getPort() <= 65535) return text;
                } catch (IllegalArgumentException invalid) {
                    // The response below does not expose the supplied URL.
                }
            }
        }
        throw ApiFailure.badRequest("INVALID_AVATAR");
    }
}
