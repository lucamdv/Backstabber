package com.backstabber.lobby;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class RoomRepository {
    private static final String ROOM_COLUMNS = "r.id, r.host_id, r.capacity, "
            + RoomPolicy.EFFECTIVE_STATUS_SQL + " as status";
    private static final String SNAPSHOTS = """
            select %s, r.code, game.id as match_id, p.user_id, p.username, p.display_name,
              p.avatar_url, p.show_online, m.ready, m.last_seen > now() - interval '35 seconds' as connected
            from public.bs_room_members own
            join public.bs_rooms r on r.id = own.room_id
            join public.bs_room_members m on m.room_id = r.id
            join public.bs_profiles p on p.user_id = m.user_id
            left join public.bs_matches game on game.room_id = r.id
            where own.user_id = :userId and %s
            order by r.created_at desc, r.id, m.joined_at, m.user_id
            """;
    private final JdbcClient db;

    RoomRepository(JdbcClient db) {
        this.db = db;
    }

    List<RoomSnapshot> snapshots(UUID userId, UUID roomId) {
        String filter = roomId == null ? "(" + RoomPolicy.EFFECTIVE_STATUS_SQL + ") <> 'closed'" : "r.id = :roomId";
        var query = db.sql(SNAPSHOTS.formatted(ROOM_COLUMNS, filter)).param("userId", userId);
        if (roomId != null) query.param("roomId", roomId);
        return query.query(rows -> {
            var rooms = new LinkedHashMap<UUID, SnapshotRows>();
            while (rows.next()) {
                UUID id = rows.getObject("id", UUID.class);
                var room = rooms.get(id);
                if (room == null) {
                    room = new SnapshotRows(roomRow(rows), rows.getString("code"),
                            rows.getObject("match_id", UUID.class), new ArrayList<>());
                    rooms.put(id, room);
                }
                room.members().add(new RoomSnapshot.Member(rows.getObject("user_id", UUID.class),
                        rows.getString("username"), rows.getString("display_name"), rows.getString("avatar_url"),
                        rows.getBoolean("show_online"), rows.getBoolean("ready"), rows.getBoolean("connected")));
            }
            return rooms.values().stream().map(SnapshotRows::snapshot).toList();
        });
    }

    Optional<LockedRoom> lockById(UUID roomId) {
        return db.sql("select " + ROOM_COLUMNS + " from public.bs_rooms r where r.id = :id for update")
                .param("id", roomId).query((row, index) -> roomRow(row)).optional();
    }

    Optional<LockedRoom> lockByCode(String code) {
        return db.sql("select " + ROOM_COLUMNS + " from public.bs_rooms r where r.code = :code for update")
                .param("code", code).query((row, index) -> roomRow(row)).optional();
    }

    boolean isMember(UUID userId, UUID roomId) {
        return db.sql("select exists (select 1 from public.bs_room_members where room_id = :roomId and user_id = :userId)")
                .param("roomId", roomId).param("userId", userId).query(Boolean.class).single();
    }

    boolean hasProfile(UUID userId) {
        return db.sql("select exists (select 1 from public.bs_profiles where user_id = :userId)")
                .param("userId", userId).query(Boolean.class).single();
    }

    Optional<UUID> insert(String code, UUID hostId, int capacity) {
        return db.sql("""
                insert into public.bs_rooms (code, host_id, capacity) values (:code, :hostId, :capacity)
                on conflict (code) do nothing returning id
                """).param("code", code).param("hostId", hostId).param("capacity", capacity)
                .query(UUID.class).optional();
    }

    List<UUID> memberIds(UUID roomId) {
        return db.sql("select user_id from public.bs_room_members where room_id = :id order by joined_at, user_id")
                .param("id", roomId).query(UUID.class).list();
    }

    void addMember(UUID userId, UUID roomId) {
        db.sql("insert into public.bs_room_members (room_id, user_id) values (:roomId, :userId)")
                .param("roomId", roomId).param("userId", userId).update();
    }

    void deleteMember(UUID userId, UUID roomId) {
        db.sql("delete from public.bs_room_members where room_id = :roomId and user_id = :userId")
                .param("roomId", roomId).param("userId", userId).update();
    }

    void resetReadiness(UUID roomId) {
        db.sql("update public.bs_room_members set ready = false where room_id = :id and ready")
                .param("id", roomId).update();
    }

    void heartbeat(UUID userId, UUID roomId) {
        db.sql("update public.bs_room_members set last_seen = now() where room_id = :roomId and user_id = :userId")
                .param("roomId", roomId).param("userId", userId).update();
    }

    void ready(UUID userId, UUID roomId, boolean ready) {
        db.sql("update public.bs_room_members set ready = :ready where room_id = :roomId and user_id = :userId")
                .param("ready", ready).param("roomId", roomId).param("userId", userId).update();
    }

    void transferHost(UUID roomId, UUID newHost) {
        db.sql("update public.bs_rooms set host_id = :host, status = :status where id = :id")
                .param("host", newHost).param("status", newHost == null ? "closed" : "lobby").param("id", roomId).update();
    }

    boolean hostPresent(LockedRoom room) {
        return db.sql("""
                select exists (select 1 from public.bs_room_members
                  where room_id = :roomId and user_id = :hostId
                  and last_seen > now() - make_interval(secs => :seconds))
                """).param("roomId", room.id()).param("hostId", room.hostId())
                .param("seconds", RoomPolicy.HOST_ABANDONMENT_SECONDS).query(Boolean.class).single();
    }

    void markStarted(UUID roomId) {
        db.sql("update public.bs_rooms set status = 'started' where id = :id").param("id", roomId).update();
    }

    void close(UUID roomId) {
        db.sql("update public.bs_rooms set status = 'closed' where id = :id and status <> 'closed'")
                .param("id", roomId).update();
    }

    void expireInvites(UUID roomId, UUID sender) {
        String filter = sender == null ? "" : " and sender_id = :sender";
        var query = db.sql("update public.bs_invites set status = 'expired' where room_id = :id and status = 'pending'" + filter)
                .param("id", roomId);
        if (sender != null) query.param("sender", sender);
        query.update();
    }

    private static LockedRoom roomRow(ResultSet row) throws SQLException {
        return new LockedRoom(row.getObject("id", UUID.class), row.getObject("host_id", UUID.class),
                row.getInt("capacity"), row.getString("status"));
    }

    private record SnapshotRows(LockedRoom room, String code, UUID matchId, List<RoomSnapshot.Member> members) {
        RoomSnapshot snapshot() {
            return new RoomSnapshot(room.id(), code, room.hostId(), room.capacity(), room.status(), matchId,
                    RoomPolicy.canStart(room.status(), members), List.copyOf(members));
        }
    }
}
