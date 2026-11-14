package com.backstabber.social;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class FriendshipRepository {
    private final JdbcClient client;

    public FriendshipRepository(JdbcClient client) {
        this.client = client;
    }

    public record Friend(UUID id, String username, String displayName, String avatarUrl, boolean showOnline,
                         Boolean online) {}
    public record PendingRequest(UUID id, Profile from, Profile to, String status) {}

    List<Friend> friends(UUID user) {
        return client.sql("""
                select p.user_id, p.username, p.display_name, p.avatar_url, p.show_online,
                       case when p.show_online then coalesce(p.last_seen > now() - interval '45 seconds', false) end online
                from public.bs_friends f
                join public.bs_profiles p on p.user_id = case when f.user_a = :user then f.user_b else f.user_a end
                where f.user_a = :user or f.user_b = :user
                order by p.username
                """)
                .param("user", user)
                .query((row, number) -> new Friend(row.getObject("user_id", UUID.class),
                        row.getString("username"), row.getString("display_name"), row.getString("avatar_url"),
                        row.getBoolean("show_online"), row.getObject("online", Boolean.class)))
                .list();
    }

    List<PendingRequest> pendingRequests(UUID user) {
        return client.sql("""
                select f.id, f.status,
                       sender.user_id sender_id, sender.username sender_username,
                       sender.display_name sender_display_name, sender.avatar_url sender_avatar_url,
                       sender.show_online sender_show_online,
                       recipient.user_id recipient_id, recipient.username recipient_username,
                       recipient.display_name recipient_display_name, recipient.avatar_url recipient_avatar_url,
                       recipient.show_online recipient_show_online
                from public.bs_friend_requests f
                join public.bs_profiles sender on sender.user_id = f.sender_id
                join public.bs_profiles recipient on recipient.user_id = f.recipient_id
                where f.status = 'pending' and (f.sender_id = :user or f.recipient_id = :user)
                order by f.created_at desc, f.id
                """)
                .param("user", user)
                .query((row, number) -> new PendingRequest(row.getObject("id", UUID.class),
                        profile(row, "sender"), profile(row, "recipient"), row.getString("status")))
                .list();
    }

    private static Profile profile(ResultSet row, String prefix) throws SQLException {
        return new Profile(row.getObject(prefix + "_id", UUID.class), row.getString(prefix + "_username"),
                row.getString(prefix + "_display_name"), row.getString(prefix + "_avatar_url"),
                row.getBoolean(prefix + "_show_online"));
    }

    boolean lockProfiles(UUID first, UUID second) {
        return client.sql("""
                select user_id from public.bs_profiles
                where user_id in (:first, :second) order by user_id for no key update
                """)
                .param("first", first).param("second", second)
                .query(UUID.class).list().size() == 2;
    }

    public boolean areFriends(UUID first, UUID second) {
        return client.sql("""
                select 1 from public.bs_friends
                where user_a = least(cast(:first as uuid), cast(:second as uuid))
                  and user_b = greatest(cast(:first as uuid), cast(:second as uuid))
                """)
                .param("first", first).param("second", second).query(Integer.class).optional().isPresent();
    }

    Optional<UUID> createRequest(UUID sender, UUID recipient) {
        return client.sql("""
                insert into public.bs_friend_requests (sender_id, recipient_id) values (:sender, :recipient)
                on conflict do nothing returning id
                """)
                .param("sender", sender).param("recipient", recipient).query(UUID.class).optional();
    }

    Optional<UUID> pendingSender(UUID id, UUID recipient) {
        return client.sql("""
                select sender_id from public.bs_friend_requests
                where id = :id and recipient_id = :recipient and status = 'pending'
                """)
                .param("id", id).param("recipient", recipient).query(UUID.class).optional();
    }

    boolean respond(UUID id, UUID recipient, String status) {
        return client.sql("""
                update public.bs_friend_requests set status = :status
                where id = :id and recipient_id = :recipient and status = 'pending'
                """)
                .param("status", status).param("id", id).param("recipient", recipient).update() == 1;
    }

    void createFriendship(UUID first, UUID second) {
        client.sql("""
                insert into public.bs_friends (user_a, user_b)
                values (least(cast(:first as uuid), cast(:second as uuid)),
                        greatest(cast(:first as uuid), cast(:second as uuid)))
                on conflict do nothing
                """)
                .param("first", first).param("second", second).update();
    }

    void removeFriendship(UUID first, UUID second) {
        client.sql("""
                delete from public.bs_friends
                where user_a = least(cast(:first as uuid), cast(:second as uuid))
                  and user_b = greatest(cast(:first as uuid), cast(:second as uuid))
                """)
                .param("first", first).param("second", second).update();
    }
}
