package com.backstabber.game.application;

import com.backstabber.lobby.RoomPolicy;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
class MatchRepository {
    private final JdbcClient db;

    MatchRepository(JdbcClient db) {
        this.db = db;
    }

    void insert(UUID roomId, String state) {
        db.sql("insert into public.bs_matches (room_id, state) values (:roomId, cast(:state as jsonb))")
                .param("roomId", roomId).param("state", state).update();
    }

    boolean lockMemberRoom(UUID matchId, UUID userId) {
        return db.sql("""
                select r.id from public.bs_rooms r
                join public.bs_matches m on m.room_id = r.id
                join public.bs_room_members u on u.room_id = r.id
                where m.id = :matchId and u.user_id = :userId for update of r
                """).param("matchId", matchId).param("userId", userId).query(UUID.class).optional().isPresent();
    }

    Optional<MatchRow> findForMember(UUID matchId, UUID userId, boolean lock) {
        return db.sql("""
                select m.state, r.host_id, r.status, not exists (
                  select 1 from public.bs_room_members h where h.room_id = r.id and h.user_id = r.host_id
                  and h.last_seen > now() - make_interval(secs => :seconds)
                ) as host_abandoned
                from public.bs_matches m join public.bs_rooms r on r.id = m.room_id
                join public.bs_room_members u on u.room_id = r.id
                where m.id = :matchId and u.user_id = :userId
                """ + (lock ? "for update of m" : ""))
                .param("matchId", matchId).param("userId", userId).param("seconds", RoomPolicy.HOST_ABANDONMENT_SECONDS)
                .query((row, index) -> new MatchRow(row.getString("state"), row.getObject("host_id", UUID.class),
                        row.getString("status"), row.getBoolean("host_abandoned"))).optional();
    }

    Optional<PriorCommand> priorCommand(UUID matchId, UUID userId, String commandId) {
        return db.sql("""
                select fingerprint, result from public.bs_match_commands
                where match_id = :matchId and user_id = :userId and command_id = :commandId
                """).param("matchId", matchId).param("userId", userId).param("commandId", nodeText(commandId))
                .query((row, index) -> new PriorCommand(row.getString("fingerprint"), row.getString("result")))
                .optional();
    }

    void update(UUID id, String state) {
        db.sql("update public.bs_matches set state = cast(:state as jsonb) where id = :id")
                .param("id", id).param("state", state).update();
    }

    void record(UUID matchId, UUID userId, String commandId, String fingerprint, String result) {
        db.sql("""
                insert into public.bs_match_commands (match_id, user_id, command_id, fingerprint, result)
                values (:matchId, :userId, :commandId, :fingerprint, cast(:result as jsonb))
                """).param("matchId", matchId).param("userId", userId).param("commandId", nodeText(commandId))
                .param("fingerprint", fingerprint).param("result", result).update();
    }

    private static String nodeText(String text) {
        // PostgreSQL text receives UTF-8. Node replaces unpaired surrogates with U+FFFD.
        // The fingerprint independently preserves the original UTF-16 code units.
        var normalized = new StringBuilder(text.length());
        for (int index = 0; index < text.length(); index++) {
            char unit = text.charAt(index);
            if (Character.isHighSurrogate(unit) && index + 1 < text.length()
                    && Character.isLowSurrogate(text.charAt(index + 1))) {
                normalized.append(unit).append(text.charAt(++index));
            } else {
                normalized.append(Character.isSurrogate(unit) ? '\ufffd' : unit);
            }
        }
        return normalized.toString();
    }

    record MatchRow(String state, UUID hostId, String status, boolean hostAbandoned) {}

    record PriorCommand(String fingerprint, String result) {}
}
