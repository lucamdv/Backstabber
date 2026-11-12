import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import { createMatch } from './match-store';
import { HOST_ABANDONMENT_SECONDS } from './room-policy';

type Input = Record<string, unknown>;
type RoomStatus = 'lobby' | 'started' | 'closed';

interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  showOnline: boolean;
}

interface Member extends Profile {
  ready: boolean;
  connected: boolean;
}

interface Room {
  id: string;
  code: string;
  hostId: string | null;
  capacity: number;
  status: RoomStatus;
  matchId: string | null;
  canStart: boolean;
  members: Member[];
}

interface LockedRoom {
  id: string;
  hostId: string | null;
  capacity: number;
  status: RoomStatus;
}

interface Invite {
  id: string;
  roomId: string;
  from: Profile;
  status: string;
  expiresAt: Date;
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const profileColumns = 'p.user_id id, p.username, p.display_name "displayName", p.avatar_url "avatarUrl", p.show_online "showOnline"';
const effectiveStatus = `case when r.host_id is null or (r.status = 'lobby' and r.expires_at <= now())
  then 'closed' else r.status end`;

function profileJson(alias: 'sender' | 'recipient') {
  return `jsonb_build_object('id', ${alias}.user_id, 'username', ${alias}.username,
    'displayName', ${alias}.display_name, 'avatarUrl', ${alias}.avatar_url, 'showOnline', ${alias}.show_online)`;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ApiError('INVALID_ID');
  return value.toLowerCase();
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ApiError('INVALID_BOOLEAN');
  return value;
}

function avatar(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.length <= 2048 && value.startsWith('https://')) {
    const url = URL.parse(value);
    if (url?.hostname && !url.username && !url.password) return value;
  }
  throw new ApiError('INVALID_AVATAR');
}

async function requireProfile(tx: PoolClient, user: string) {
  const result = await tx.query('select 1 from public.bs_profiles where user_id = $1', [user]);
  if (!result.rowCount) throw new ApiError('PROFILE_REQUIRED', 409);
}

async function writeProfile(tx: PoolClient, user: string, input: Input) {
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const name = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (!/^[a-z0-9_]{3,18}$/.test(username) || name.length < 1 || name.length > 40) {
    throw new ApiError('INVALID_PROFILE');
  }
  try {
    const { rows } = await tx.query<Profile>(`insert into public.bs_profiles as p
      (user_id, username, display_name, avatar_url, show_online) values ($1, $2, $3, $4, coalesce($5, false))
      on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name,
      avatar_url = excluded.avatar_url, show_online = coalesce($5, p.show_online)
      returning ${profileColumns}`, [
      user, username, name, avatar(input.avatarUrl), input.showOnline === undefined ? null : flag(input.showOnline),
    ]);
    return rows[0];
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw new ApiError('USERNAME_TAKEN', 409);
    }
    throw error;
  }
}

async function getFriends(tx: PoolClient, user: string) {
  const { rows: friends } = await tx.query<Profile & { online: boolean | null }>(`
    select ${profileColumns},
      case when p.show_online then coalesce(p.last_seen > now() - interval '45 seconds', false) end online
    from public.bs_friends f
    join public.bs_profiles p on p.user_id = case when f.user_a = $1 then f.user_b else f.user_a end
    where f.user_a = $1 or f.user_b = $1 order by p.username`, [user]);
  const { rows: requests } = await tx.query(`
    select f.id, ${profileJson('sender')} "from", ${profileJson('recipient')} "to", f.status
    from public.bs_friend_requests f
    join public.bs_profiles sender on sender.user_id = f.sender_id
    join public.bs_profiles recipient on recipient.user_id = f.recipient_id
    where f.status = 'pending' and (f.sender_id = $1 or f.recipient_id = $1)
    order by f.created_at desc, f.id`, [user]);
  return { friends, requests };
}

async function lockProfiles(tx: PoolClient, first: string, second: string) {
  const result = await tx.query(`select user_id from public.bs_profiles where user_id in ($1,$2)
    order by user_id for no key update`, [first, second]);
  if (result.rowCount !== 2) throw new ApiError('PROFILE_NOT_FOUND', 404);
}

async function areFriends(tx: PoolClient, first: string, second: string) {
  const result = await tx.query(`select 1 from public.bs_friends
    where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)`, [first, second]);
  return result.rowCount === 1;
}

async function sendFriendRequest(tx: PoolClient, user: string, target: string) {
  if (user === target) throw new ApiError('INVALID_FRIEND_TARGET');
  await lockProfiles(tx, user, target);
  if (await areFriends(tx, user, target)) throw new ApiError('ALREADY_FRIENDS', 409);
  const { rows } = await tx.query<{ id: string }>(`
    insert into public.bs_friend_requests (sender_id, recipient_id) values ($1,$2)
    on conflict do nothing returning id`, [user, target]);
  if (!rows[0]) throw new ApiError('FRIEND_REQUEST_EXISTS', 409);
  return rows[0];
}

async function respondFriendRequest(tx: PoolClient, user: string, id: string, accept: boolean) {
  const { rows: [request] } = await tx.query<{ sender_id: string }>(`select sender_id
    from public.bs_friend_requests where id = $1 and recipient_id = $2 and status = 'pending'`, [id, user]);
  if (!request) throw new ApiError('FRIEND_REQUEST_NOT_FOUND', 404);
  await lockProfiles(tx, request.sender_id, user);
  const status = accept ? 'accepted' : 'declined';
  const result = await tx.query(`update public.bs_friend_requests set status = $3
    where id = $1 and recipient_id = $2 and status = 'pending'`, [id, user, status]);
  if (!result.rowCount) throw new ApiError('FRIEND_REQUEST_NOT_FOUND', 404);
  if (accept) await tx.query(`insert into public.bs_friends (user_a, user_b)
    values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid)) on conflict do nothing`, [request.sender_id, user]);
  return { status };
}

function canStart(room: Pick<Room, 'status' | 'members'>) {
  return room.status === 'lobby' && room.members.length >= 2
    && room.members.every((member) => member.ready && member.connected);
}

async function readRooms(tx: PoolClient, user: string, id: string | null = null) {
  type Row = Omit<Room, 'members' | 'canStart'> & { member: Member };
  const { rows } = await tx.query<Row>(`
    select r.id, r.code, r.host_id "hostId", r.capacity, ${effectiveStatus} status, game.id "matchId",
      ${profileJson('sender')} || jsonb_build_object('ready', m.ready,
        'connected', m.last_seen > now() - interval '35 seconds') member
    from public.bs_room_members own
    join public.bs_rooms r on r.id = own.room_id
    join public.bs_room_members m on m.room_id = r.id
    join public.bs_profiles sender on sender.user_id = m.user_id
    left join public.bs_matches game on game.room_id = r.id
    where own.user_id = $1 and (($2::uuid is not null and r.id = $2)
      or ($2 is null and (${effectiveStatus}) <> 'closed'))
    order by r.created_at desc, r.id, m.joined_at, m.user_id`, [user, id]);
  const rooms = new Map<string, Room>();
  for (const { member, ...room } of rows) {
    const existing = rooms.get(room.id);
    if (existing) existing.members.push(member);
    else rooms.set(room.id, { ...room, members: [member], canStart: false });
  }
  return Array.from(rooms.values(), (room) => ({ ...room, canStart: canStart(room) }));
}

async function readRoom(tx: PoolClient, user: string, id: string) {
  const [room] = await readRooms(tx, user, id);
  if (!room) throw new ApiError('ROOM_NOT_FOUND', 404);
  return room;
}

async function lockRoom(tx: PoolClient, key: { id: string } | { code: string }) {
  const where = 'id' in key ? 'r.id = $1' : 'r.code = $1';
  const { rows: [room] } = await tx.query<LockedRoom>(`
    select r.id, r.host_id "hostId", r.capacity, ${effectiveStatus} status
    from public.bs_rooms r where ${where} for update`, ['id' in key ? key.id : key.code]);
  if (!room) throw new ApiError('ROOM_NOT_FOUND', 404);
  return room;
}

function requireLobby(room: LockedRoom) {
  if (room.status !== 'lobby') throw new ApiError('ROOM_NOT_OPEN', 409);
}

async function createRoom(tx: PoolClient, user: string, capacity: unknown) {
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 2 || capacity > 10) {
    throw new ApiError('INVALID_CAPACITY');
  }
  await requireProfile(tx, user);
  // Use a fresh random code if the unique index detects a collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomBytes(5).toString('hex').toUpperCase();
    const { rows: [room] } = await tx.query<{ id: string }>(`insert into public.bs_rooms (code, host_id, capacity)
      values ($1,$2,$3) on conflict (code) do nothing returning id`, [code, user, capacity]);
    if (room) {
      await tx.query('insert into public.bs_room_members (room_id, user_id) values ($1,$2)', [room.id, user]);
      return readRoom(tx, user, room.id);
    }
  }
  throw new ApiError('ROOM_CODE_UNAVAILABLE', 503);
}

async function addMember(tx: PoolClient, user: string, room: LockedRoom) {
  requireLobby(room);
  const { rows } = await tx.query<{ user_id: string }>('select user_id from public.bs_room_members where room_id = $1', [room.id]);
  if (rows.some((member) => member.user_id === user)) return readRoom(tx, user, room.id);
  if (rows.length >= room.capacity) throw new ApiError('ROOM_FULL', 409);
  await requireProfile(tx, user);
  await tx.query('insert into public.bs_room_members (room_id,user_id) values ($1,$2)', [room.id, user]);
  await tx.query('update public.bs_room_members set ready = false where room_id = $1 and ready', [room.id]);
  return readRoom(tx, user, room.id);
}

async function getInvites(tx: PoolClient, user: string) {
  const { rows } = await tx.query<Invite>(`
    select i.id, i.room_id "roomId", ${profileJson('sender')} "from", i.status, i.expires_at "expiresAt"
    from public.bs_invites i join public.bs_profiles sender on sender.user_id = i.sender_id
    join public.bs_rooms r on r.id = i.room_id
    where i.recipient_id = $1 and i.status = 'pending' and i.expires_at > now() and (${effectiveStatus}) = 'lobby'
    order by i.created_at desc, i.id`, [user]);
  return rows;
}

async function sendInvite(tx: PoolClient, user: string, room: LockedRoom, target: string) {
  requireLobby(room);
  if (!(await areFriends(tx, user, target))) throw new ApiError('FRIEND_REQUIRED', 403);
  const members = await tx.query<{ user_id: string }>('select user_id from public.bs_room_members where room_id = $1', [room.id]);
  if (members.rows.some((member) => member.user_id === target)) throw new ApiError('ALREADY_IN_ROOM', 409);
  if (members.rows.length >= room.capacity) throw new ApiError('ROOM_FULL', 409);
  await tx.query(`update public.bs_invites set status = 'expired' where room_id = $1
    and recipient_id = $2 and status = 'pending' and expires_at <= now()`, [room.id, target]);
  const { rows: [invite] } = await tx.query<{ id: string }>(`
    insert into public.bs_invites (room_id,sender_id,recipient_id) values ($1,$2,$3)
    on conflict do nothing returning id`, [room.id, user, target]);
  if (!invite) throw new ApiError('INVITE_EXISTS', 409);
  return invite;
}

async function respondInvite(tx: PoolClient, user: string, id: string, accept: boolean) {
  const { rows: [invite] } = await tx.query<{ room_id: string }>(`
    select room_id from public.bs_invites where id = $1 and recipient_id = $2`, [id, user]);
  if (!invite) throw new ApiError('INVITE_NOT_FOUND', 404);
  // Every path acquires the room lock before updating any invite in that room.
  const room = await lockRoom(tx, { id: invite.room_id });
  const status = accept ? 'accepted' : 'declined';
  const result = await tx.query(`
    update public.bs_invites set status = $3 where id = $1 and recipient_id = $2
    and status = 'pending' and expires_at > now()`, [id, user, status]);
  if (!result.rowCount) throw new ApiError('INVITE_NOT_FOUND', 404);
  return accept ? addMember(tx, user, room) : { status };
}

async function expireInvites(tx: PoolClient, id: string, sender: string | null = null) {
  await tx.query(`update public.bs_invites set status = 'expired'
    where room_id = $1 and status = 'pending' and ($2::uuid is null or sender_id = $2)`, [id, sender]);
}

async function leaveRoom(tx: PoolClient, user: string, room: LockedRoom) {
  requireLobby(room);
  await tx.query('delete from public.bs_room_members where room_id = $1 and user_id = $2', [room.id, user]);
  await tx.query('update public.bs_room_members set ready = false where room_id = $1 and ready', [room.id]);
  if (room.hostId === user) {
    const { rows: [member] } = await tx.query<{ user_id: string }>(`select user_id from public.bs_room_members
      where room_id = $1 order by joined_at, user_id limit 1`, [room.id]);
    await tx.query('update public.bs_rooms set host_id = $2, status = $3 where id = $1', [
      room.id, member?.user_id ?? null, member ? 'lobby' : 'closed',
    ]);
    if (!member) {
      await expireInvites(tx, room.id);
      return { ok: true };
    }
  }
  await expireInvites(tx, room.id, user);
  return { ok: true };
}

async function canCloseAbandonedRoom(tx: PoolClient, room: LockedRoom) {
  if (room.status !== 'started') return false;
  const hostPresent = await tx.query(`select 1 from public.bs_room_members
    where room_id = $1 and user_id = $2
      and last_seen > now() - make_interval(secs => $3::int)`, [room.id, room.hostId, HOST_ABANDONMENT_SECONDS]);
  return hostPresent.rowCount === 0;
}

async function mutateRoom(tx: PoolClient, user: string, id: string, operation: string, input: Input) {
  // Validate membership before taking the lock, and again after acquiring it.
  // This prevents outsiders from locking known room IDs and former members
  // from changing a room when their concurrent departure wins the lock.
  await readRoom(tx, user, id);
  const room = await lockRoom(tx, { id });
  const snapshot = await readRoom(tx, user, id);
  switch (operation) {
    case 'heartbeat':
      if (room.status === 'closed') return snapshot;
      await tx.query('update public.bs_room_members set last_seen = now() where room_id = $1 and user_id = $2', [id, user]);
      return readRoom(tx, user, id);
    case 'ready':
      requireLobby(room);
      await tx.query('update public.bs_room_members set ready = $3 where room_id = $1 and user_id = $2', [id, user, flag(input.ready)]);
      return readRoom(tx, user, id);
    case 'invite': return sendInvite(tx, user, room, uuid(input.userId));
    case 'leave': return leaveRoom(tx, user, room);
    case 'start':
      if (room.hostId !== user) throw new ApiError('HOST_REQUIRED', 403);
      if (room.status === 'started') return snapshot;
      requireLobby(room);
      if (!snapshot.canStart) throw new ApiError('ROOM_NOT_READY', 409);
      await createMatch(tx, room.id, snapshot.members.map((member) => ({ id: member.id, name: member.username })));
      await tx.query("update public.bs_rooms set status = 'started' where id = $1", [id]);
      await expireInvites(tx, id);
      return readRoom(tx, user, id);
    case 'close':
      if (room.hostId !== user && !(await canCloseAbandonedRoom(tx, room))) throw new ApiError('HOST_REQUIRED', 403);
      await tx.query("update public.bs_rooms set status = 'closed' where id = $1 and status <> 'closed'", [id]);
      await expireInvites(tx, id);
      return readRoom(tx, user, id);
    default: return undefined;
  }
}

export async function socialRoute(
  tx: PoolClient, user: string, method: string, path: string, input: Input, query = new URLSearchParams(),
): Promise<unknown> {
  if (method === 'GET' && path === '/profile') {
    const { rows } = await tx.query<Profile>(`select ${profileColumns} from public.bs_profiles p where p.user_id = $1`, [user]);
    return rows[0] ?? null;
  }
  if (method === 'PUT' && path === '/profile') return writeProfile(tx, user, input);
  if (method === 'POST' && path === '/profile/heartbeat') {
    await tx.query(`update public.bs_profiles set last_seen = now()
      where user_id = $1 and (last_seen is null or last_seen <= now() - interval '10 seconds')`, [user]);
    return { ok: true };
  }
  if (method === 'GET' && path === '/users') {
    const prefix = (query.get('username') ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,18}$/.test(prefix)) return [];
    const { rows } = await tx.query<Profile>(`select ${profileColumns} from public.bs_profiles p
      where p.user_id <> $1 and p.username like $2 order by p.username limit 20`, [user, prefix.replaceAll('_', '\\_') + '%']);
    return rows;
  }
  if (method === 'GET' && path === '/friends') return getFriends(tx, user);
  if (method === 'POST' && path === '/friends/requests') return sendFriendRequest(tx, user, uuid(input.userId));
  const friendResponse = /^\/friends\/requests\/([^/]+)\/respond$/.exec(path);
  if (method === 'POST' && friendResponse) return respondFriendRequest(tx, user, uuid(friendResponse[1]), flag(input.accept));
  const friend = /^\/friends\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && friend) {
    const target = uuid(friend[1]);
    await tx.query(`delete from public.bs_friends where user_a = least($1::uuid,$2::uuid)
      and user_b = greatest($1::uuid,$2::uuid)`, [user, target]);
    return { ok: true };
  }
  if (method === 'GET' && path === '/invites') return getInvites(tx, user);
  const invite = /^\/invites\/([^/]+)\/respond$/.exec(path);
  if (method === 'POST' && invite) return respondInvite(tx, user, uuid(invite[1]), flag(input.accept));
  if (method === 'GET' && path === '/rooms') return readRooms(tx, user);
  if (method === 'POST' && path === '/rooms') return createRoom(tx, user, input.capacity);
  if (method === 'POST' && path === '/rooms/join') {
    const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    if (!/^[0-9A-F]{10}$/.test(code)) throw new ApiError('INVALID_ROOM_CODE');
    return addMember(tx, user, await lockRoom(tx, { code }));
  }
  const room = /^\/rooms\/([^/]+)$/.exec(path);
  if (method === 'GET' && room) return readRoom(tx, user, uuid(room[1]));
  const roomMutation = /^\/rooms\/([^/]+)\/(heartbeat|ready|invite|leave|start|close)$/.exec(path);
  if (method === 'POST' && roomMutation) return mutateRoom(tx, user, uuid(roomMutation[1]), roomMutation[2], input);
  return undefined;
}
