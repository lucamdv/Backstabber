// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { socialRoute } from './social';
import { createTestDatabase, transaction } from './test-db';

const alpha = '10000000-0000-0000-0000-000000000001';
const beta = '10000000-0000-0000-0000-000000000002';
const gamma = '10000000-0000-0000-0000-000000000003';

interface Room {
  id: string;
  code: string;
  status: string;
  canStart: boolean;
  matchId: string | null;
  members: { id: string; ready: boolean; connected: boolean }[];
}

describe('API social e lobby sobre a migração PostgreSQL', () => {
  let database: PGlite;
  const request = <T = unknown>(user: string, method: string, path: string, body: Record<string, unknown> = {}) => {
    const url = new URL(path, 'http://local.invalid');
    return transaction(database, async (tx) => await socialRoute(tx, user, method, url.pathname, body, url.searchParams) as T);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.query('insert into auth.users (id) values ($1),($2),($3)', [alpha, beta, gamma]);
    await request(alpha, 'PUT', '/profile', { username: 'alfa', displayName: 'Alfa', showOnline: true });
    await request(beta, 'PUT', '/profile', { username: 'beta', displayName: 'Beta', showOnline: false });
    await request(gamma, 'PUT', '/profile', { username: 'gama', displayName: 'Gama' });
  }, 60_000);

  afterAll(async () => { await database?.close(); });

  it('busca perfis sem expor atividade e protege o nome de usuário de duplicatas', async () => {
    await expect(request(alpha, 'GET', '/profile')).resolves.toMatchObject({ id: alpha, username: 'alfa' });
    await expect(request(beta, 'GET', '/users?username=al')).resolves.toEqual([
      { id: alpha, username: 'alfa', displayName: 'Alfa', avatarUrl: null, showOnline: true },
    ]);
    await expect(request(beta, 'PUT', '/profile', { username: 'alfa', displayName: 'Duplicado' })).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('aceita uma amizade apenas pela conta destinatária e protege convites', async () => {
    const { id } = await request<{ id: string }>(alpha, 'POST', '/friends/requests', { userId: beta });
    await expect(request(beta, 'POST', '/friends/requests', { userId: alpha })).rejects.toMatchObject({ code: 'FRIEND_REQUEST_EXISTS' });
    await expect(request(gamma, 'POST', `/friends/requests/${id}/respond`, { accept: true })).rejects.toMatchObject({ code: 'FRIEND_REQUEST_NOT_FOUND' });
    await request(beta, 'POST', `/friends/requests/${id}/respond`, { accept: true });
    const room = await request<Room>(alpha, 'POST', '/rooms', { capacity: 2 });
    await expect(request(alpha, 'POST', `/rooms/${room.id}/invite`, { userId: gamma })).rejects.toMatchObject({ code: 'FRIEND_REQUIRED' });
    const invite = await request<{ id: string }>(alpha, 'POST', `/rooms/${room.id}/invite`, { userId: beta });
    await expect(request(gamma, 'POST', `/invites/${invite.id}/respond`, { accept: true })).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    await expect(request(beta, 'GET', '/invites')).resolves.toMatchObject([{ id: invite.id, from: { id: alpha } }]);
    await expect(request<Room>(beta, 'POST', `/invites/${invite.id}/respond`, { accept: true })).resolves.toMatchObject({
      id: room.id, members: [{ id: alpha }, { id: beta }],
    });
  });

  it('serializa composição e prontidão, valida capacidade e inicia apenas pelo host', async () => {
    const room = await request<Room>(alpha, 'POST', '/rooms', { capacity: 2 });
    const route = `/rooms/${room.id}`;
    await request(alpha, 'POST', `${route}/ready`, { ready: true });
    const joined = await request<Room>(beta, 'POST', '/rooms/join', { code: room.code.toLowerCase() });
    expect(joined.members).toEqual([
      expect.objectContaining({ id: alpha, ready: false }),
      expect.objectContaining({ id: beta, ready: false }),
    ]);
    await expect(request<Room>(beta, 'POST', '/rooms/join', { code: room.code })).resolves.toMatchObject({ members: joined.members });
    await expect(request(gamma, 'POST', '/rooms/join', { code: room.code })).rejects.toMatchObject({ code: 'ROOM_FULL' });
    await request(alpha, 'POST', `${route}/ready`, { ready: true });
    await expect(request(alpha, 'POST', `${route}/start`)).rejects.toMatchObject({ code: 'ROOM_NOT_READY' });
    await expect(request<Room>(beta, 'POST', `${route}/ready`, { ready: true })).resolves.toMatchObject({ canStart: true });
    await expect(request(beta, 'POST', `${route}/start`)).rejects.toMatchObject({ code: 'HOST_REQUIRED' });
    await database.query("update public.bs_room_members set last_seen=now()-interval '1 minute' where room_id=$1 and user_id=$2", [room.id, beta]);
    await expect(request(alpha, 'POST', `${route}/start`)).rejects.toMatchObject({ code: 'ROOM_NOT_READY' });
    await request(beta, 'POST', `${route}/heartbeat`);
    const started = await request<Room>(alpha, 'POST', `${route}/start`);
    expect(started).toMatchObject({ status: 'started', matchId: expect.any(String) });
    const messages = await database.query<{ payload: unknown }>(
      "select payload from realtime.messages where topic=$1 and event='invalidate' and private", [`room:${room.id}`],
    );
    expect(messages.rows.length).toBeGreaterThan(0);
    expect(messages.rows.every(({ payload }) => Object.keys(payload as object).every((key) => key === 'kind'))).toBe(true);
  });

  it('rejeita acesso à sala e ao Broadcast de terceiros e nunca expõe as partidas pelo banco público', async () => {
    const room = await request<Room>(alpha, 'POST', '/rooms', { capacity: 2 });
    await expect(request(gamma, 'GET', `/rooms/${room.id}`)).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    await expect(request(gamma, 'POST', `/rooms/${room.id}/heartbeat`)).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });

    const readTopic = (user: string, topic: string) => transaction(database, async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('realtime.topic', $2, true)", [user, topic]);
      return tx.query<{ topic: string }>('select topic from realtime.messages');
    });
    const ownRoom = await readTopic(alpha, `room:${room.id}`);
    expect(ownRoom.rows.length).toBeGreaterThan(0);
    expect(ownRoom.rows.every((row) => row.topic === `room:${room.id}`)).toBe(true);
    expect((await readTopic(gamma, `room:${room.id}`)).rows).toEqual([]);
    expect((await readTopic(gamma, `user:${alpha}`)).rows).toEqual([]);
    const writeTopic = (user: string, extension: 'presence' | 'broadcast') => transaction(database, async (tx) => {
      await tx.query('set local role authenticated');
      const topic = `room:${room.id}`;
      await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('realtime.topic', $2, true)", [user, topic]);
      await tx.query('insert into realtime.messages (topic, extension, private) values ($1,$2,true)', [topic, extension]);
    });
    await expect(writeTopic(alpha, 'presence')).resolves.toBeUndefined();
    await expect(writeTopic(gamma, 'presence')).rejects.toMatchObject({ code: '42501' });
    await expect(writeTopic(alpha, 'broadcast')).rejects.toMatchObject({ code: '42501' });
    await expect(transaction(database, async (tx) => {
      await tx.query('set local role authenticated');
      return tx.query('select state from public.bs_matches');
    })).rejects.toMatchObject({ code: '42501' });
  });

  it('reinicia a prontidão ao sair e permite encerrar uma partida se o host ficar ausente', async () => {
    const room = await request<Room>(alpha, 'POST', '/rooms', { capacity: 3 });
    const route = `/rooms/${room.id}`;
    await request(beta, 'POST', '/rooms/join', { code: room.code });
    await request(gamma, 'POST', '/rooms/join', { code: room.code });
    await request(alpha, 'POST', `${route}/ready`, { ready: true });
    await request(beta, 'POST', `${route}/ready`, { ready: true });
    await request(gamma, 'POST', `${route}/leave`);
    await expect(request<Room>(alpha, 'GET', route)).resolves.toMatchObject({
      canStart: false, members: [{ id: alpha, ready: false }, { id: beta, ready: false }],
    });
    await request(alpha, 'POST', `${route}/ready`, { ready: true });
    await request(beta, 'POST', `${route}/ready`, { ready: true });
    const started = await request<Room>(alpha, 'POST', `${route}/start`);
    await expect(request(beta, 'POST', `${route}/close`)).rejects.toMatchObject({ code: 'HOST_REQUIRED' });
    await database.query("update public.bs_room_members set last_seen=now()-interval '6 minutes' where room_id=$1 and user_id=$2", [room.id, alpha]);
    await expect(request<Room>(beta, 'POST', `${route}/close`)).resolves.toMatchObject({ status: 'closed', matchId: started.matchId });
    await expect(request<Room[]>(alpha, 'GET', '/rooms')).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: room.id })]));
  });
});
