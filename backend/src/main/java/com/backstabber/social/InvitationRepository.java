package com.backstabber.social;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.backstabber.lobby.RoomPolicy;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class InvitationRepository {
    private final JdbcClient jdbc;

    public InvitationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<Invitation> pendingFor(UUID recipient) {
        return jdbc.sql("""
                select i.id, i.room_id, i.status, i.expires_at,
                    p.user_id, p.username, p.display_name, p.avatar_url, p.show_online
                from public.bs_invites i
                join public.bs_profiles p on p.user_id = i.sender_id
                join public.bs_rooms r on r.id = i.room_id
                where i.recipient_id = :recipient and i.status = 'pending'
                  and i.expires_at > now() and (%s) = 'lobby'
                order by i.created_at desc, i.id
                """.formatted(RoomPolicy.EFFECTIVE_STATUS_SQL))
                .param("recipient", recipient)
                .query((row, index) -> Invitation.fromDatabase(
                        row.getObject("id", UUID.class), row.getObject("room_id", UUID.class),
                        new Profile(row.getObject("user_id", UUID.class), row.getString("username"),
                                row.getString("display_name"), row.getString("avatar_url"), row.getBoolean("show_online")),
                        row.getString("status"), row.getObject("expires_at", OffsetDateTime.class).toInstant()))
                .list();
    }

    void expireStale(UUID room, UUID recipient) {
        jdbc.sql("""
                update public.bs_invites set status = 'expired'
                where room_id = :room and recipient_id = :recipient and status = 'pending'
                  and expires_at <= now()
                """).param("room", room).param("recipient", recipient).update();
    }

    Optional<UUID> insert(UUID room, UUID sender, UUID recipient) {
        return jdbc.sql("""
                insert into public.bs_invites (room_id, sender_id, recipient_id)
                values (:room, :sender, :recipient)
                on conflict do nothing returning id
                """).param("room", room).param("sender", sender).param("recipient", recipient)
                .query(UUID.class).optional();
    }

    Optional<UUID> findRecipientRoom(UUID recipient, UUID invitation) {
        return jdbc.sql("""
                select room_id from public.bs_invites
                where id = :invitation and recipient_id = :recipient
                """).param("invitation", invitation).param("recipient", recipient).query(UUID.class).optional();
    }

    boolean respond(UUID recipient, UUID invitation, String status) {
        return jdbc.sql("""
                update public.bs_invites set status = :status
                where id = :invitation and recipient_id = :recipient
                  and status = 'pending' and expires_at > now()
                """).param("invitation", invitation).param("recipient", recipient).param("status", status)
                .update() == 1;
    }
}
