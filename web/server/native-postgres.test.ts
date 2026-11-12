// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OnlineCommand, OnlineView, VoteChoice } from '../src/game/application/online-contracts';
import { ApiError } from './errors';
import { createApi } from './http';
import type { OnlineState } from './online-engine';

const nativeUrl = process.env.BACKSTABBER_NATIVE_PG_URL;
const identities = ['1', '2', '3', '4'].map(value => `b5000000-0000-0000-0000-00000000000${value}`);
const [host, target, challenger, observer] = identities;
const migrationPath = new URL('../../supabase/migrations/', import.meta.url);

function isolatedUrl(raw: string) {
  const url = URL.parse(raw);
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || url.username !== 'bs_homologation'
    || url.pathname !== '/backstabber_native' || url.search || url.hash) {
    throw new Error('Use a disposable loopback cluster with the bs_homologation role and backstabber_native database.');
  }
  return url;
}

type Room = { id: string; code: string; matchId: string | null; status: string;
  members: { id: string; ready: boolean }[] };
type Match = Room & { path: string; matchId: string };

describe.skipIf(!nativeUrl)('PostgreSQL nativo em dois pools HTTP independentes', () => {
  const name = 'backstabber_native_' + randomUUID().replaceAll('-', '');
  const applications = ['backstabber-native-first', 'backstabber-native-second'] as const;
  let administrative: Pool;
  let coordination: Pool;
  let clients: [Pool, Pool];
  let handlers: [ReturnType<typeof createApi>, ReturnType<typeof createApi>];
  let created = false;

  beforeAll(async () => {
    const controlUrl = isolatedUrl(nativeUrl!);
    administrative = new Pool({ connectionString: controlUrl.href, connectionTimeoutMillis: 3000, max: 1 });
    const version = await administrative.query<{ version: string }>("select current_setting('server_version') as version");
    expect(version.rows[0].version).toMatch(/^17\./);
    // The identifier is generated locally. The suite never applies fixtures to the control DB.
    await administrative.query(`create database ${name}`);
    created = true;
    controlUrl.pathname = '/' + name;
    const poolFor = (application_name: string, max: number) => new Pool({
      connectionString: controlUrl.href, application_name, max, connectionTimeoutMillis: 3000,
    });
    coordination = poolFor('backstabber-native-coordination', 2);
    clients = [poolFor(applications[0], 1), poolFor(applications[1], 1)];
    const first = await clients[0].query<{ pid: number }>('select pg_backend_pid() pid');
    const second = await clients[1].query<{ pid: number }>('select pg_backend_pid() pid');
    expect(first.rows[0].pid).not.toBe(second.rows[0].pid);
    console.info(`PostgreSQL ${version.rows[0].version}: backend PIDs ${first.rows[0].pid} and ${second.rows[0].pid}`);

    // Only the managed schemas are fixture substitutes. PostgreSQL, the app migration,
    // roles, transaction semantics, connection pools and HTTP handler are real.
    await coordination.query(`
      do $setup$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      end $setup$;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      create schema realtime;
      create table realtime.messages (
        topic text, extension text, payload jsonb, event text, private boolean
      );
      alter table realtime.messages enable row level security;
      grant usage on schema realtime to anon, authenticated;
      grant select, insert on realtime.messages to anon, authenticated;
      create function realtime.topic() returns text language sql stable as
        $$ select current_setting('realtime.topic', true) $$;
      create function realtime.send(jsonb, text, text, boolean)
      returns void language sql as
        $$ insert into realtime.messages values ($3, 'broadcast', $1, $2, $4) $$;
    `);
    const migrations = (await readdir(migrationPath)).filter(file => file.endsWith('.sql')).sort();
    expect(migrations).not.toHaveLength(0);
    for (const file of migrations) await coordination.query(await readFile(new URL(file, migrationPath), 'utf8'));
    const authenticateFixture = async (token: string) => {
      const actor = token.replace(/\.reconnected$/, '');
      if (!identities.includes(actor)) throw new ApiError('UNAUTHENTICATED', 401);
      return actor;
    };
    handlers = [
      createApi(() => clients[0].connect(), authenticateFixture),
      createApi(() => clients[1].connect(), authenticateFixture),
    ];
    for (const [index, id] of identities.entries()) {
      await coordination.query('insert into auth.users(id) values ($1)', [id]);
      await ok(id, '/profile', 'PUT', { username: `native${index}`, displayName: `Native ${index}` });
    }
  }, 30_000);

  afterAll(async () => {
    if (clients) await Promise.all(clients.map(client => client.end()));
    if (coordination) await coordination.end();
    if (administrative) {
      try {
        if (created) await administrative.query(`drop database ${name}`);
      } finally {
        await administrative.end();
      }
    }
  }, 30_000);

  const request = (actor: string, path: string, method = 'GET', payload?: unknown, pool: 0 | 1 = 0) =>
    handlers[pool](new Request(`http://backstabber.test/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }));
  async function ok<T = unknown>(actor: string, path: string, method = 'GET', payload?: unknown, pool: 0 | 1 = 0) {
    const response = await request(actor, path, method, payload, pool);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body as T;
  }

  async function waitForBlocked(expected: readonly string[]) {
    const deadline = Date.now() + 2200;
    while (Date.now() < deadline) {
      const { rows } = await coordination.query<{ application_name: string }>(`
        select application_name from pg_stat_activity
        where datname = current_database() and application_name = any($1::text[])
          and wait_event_type = 'Lock'`, [expected]);
      if (new Set(rows.map(row => row.application_name)).size === expected.length) return;
      await delay(15);
    }
    throw new Error('PostgreSQL did not observe all expected lock waiters.');
  }

  // Park both handlers on a real row lock before allowing either transaction to proceed.
  async function race(roomId: string, start: () => [Promise<Response>, Promise<Response>]) {
    const lock = await coordination.connect();
    let pending: Promise<Response[]>;
    try {
      await lock.query('begin');
      await lock.query('select id from public.bs_rooms where id = $1 for update', [roomId]);
      pending = Promise.all(start());
      await waitForBlocked(applications);
    } finally {
      await lock.query('rollback').finally(() => lock.release());
    }
    return pending;
  }

  const createRoom = (capacity: number) => ok<Room>(host, '/rooms', 'POST', { capacity });
  const join = (actor: string, room: Room) => ok<Room>(actor, '/rooms/join', 'POST', { code: room.code });
  const ready = (actor: string, room: Room) => ok<Room>(actor, `/rooms/${room.id}/ready`, 'POST', { ready: true });
  async function setupRoom(players: string[]): Promise<Match> {
    const room = await createRoom(players.length);
    for (const player of players.slice(1)) await join(player, room);
    for (const player of players) await ready(player, room);
    const started = await ok<Room>(host, `/rooms/${room.id}/start`, 'POST');
    expect(started.matchId).toBeTruthy();
    return { ...started, path: `/matches/${started.matchId}`, matchId: started.matchId! };
  }

  const view = (actor: string, match: Match) => ok<OnlineView>(actor, match.path);
  const envelope = (state: OnlineView, command: OnlineCommand, commandId = randomUUID()) => ({
    protocolVersion: 1, commandId, expectedRevision: state.revision, command,
  });
  const commandPath = (match: Match) => match.path + '/commands';
  async function submit(actor: string, match: Match, command: OnlineCommand) {
    await ok(actor, commandPath(match), 'POST', envelope(await view(actor, match), command));
  }
  function vote(state: OnlineView, choice: VoteChoice): OnlineCommand {
    expect(state.window).toBeDefined();
    return { type: 'vote', windowId: state.window!.id, choice };
  }
  async function stored(match: Match) {
    const { rows } = await coordination.query<{ state: OnlineState }>(
      'select state from public.bs_matches where id = $1', [match.matchId],
    );
    return rows[0].state;
  }

  it('reserva uma única última vaga e cria uma única partida em dois inícios simultâneos', async () => {
    const room = await createRoom(2);
    await ready(host, room);
    const joins = await race(room.id, () => [
      request(target, '/rooms/join', 'POST', { code: room.code }),
      request(challenger, '/rooms/join', 'POST', { code: room.code }, 1),
    ]);
    expect(joins.map(result => result.status).sort()).toEqual([200, 409]);
    const player = joins[0].ok ? target : challenger;
    const denied = joins[0].ok ? challenger : target;
    expect(await joins.find(result => !result.ok)?.json()).toEqual({ error: 'ROOM_FULL' });
    expect((await request(denied, `/rooms/${room.id}`)).status).toBe(404);
    const lobby = await ok<Room>(host, `/rooms/${room.id}`);
    expect(lobby.members).toEqual([{ id: host, ready: false }, { id: player, ready: false }].map(member => expect.objectContaining(member)));
    await ready(host, room);
    await ready(player, room);

    const starts = await race(room.id, () => [
      request(host, `/rooms/${room.id}/start`, 'POST'),
      request(host, `/rooms/${room.id}/start`, 'POST', undefined, 1),
    ]);
    expect(starts.map(result => result.status)).toEqual([200, 200]);
    const snapshots = await Promise.all(starts.map(result => result.json() as Promise<Room>));
    expect(snapshots[0]).toMatchObject({ status: 'started', matchId: expect.any(String) });
    expect(snapshots[0].matchId).toBe(snapshots[1].matchId);
    const matches = await coordination.query('select id from public.bs_matches where room_id = $1', [room.id]);
    expect(matches.rows).toEqual([{ id: snapshots[0].matchId }]);
  });

  it('deduplica o mesmo comando entre pools e rejeita o mesmo ID com outro conteúdo', async () => {
    const match = await setupRoom([host, target]);
    const initial = await view(host, match);
    const action = envelope(initial, { type: 'select-action', action: 'tax' });
    const replies = await race(match.id, () => [
      request(host, commandPath(match), 'POST', action),
      request(host, commandPath(match), 'POST', action, 1),
    ]);
    expect(replies.map(result => result.status)).toEqual([200, 200]);
    const responseBodies = await Promise.all(replies.map(result => result.json()));
    expect(responseBodies).toEqual(Array(2).fill({ ok: true, revision: initial.revision + 1 }));
    const conflict = await request(host, commandPath(match), 'POST', {
      ...action, command: { type: 'select-action', action: 'income' },
    }, 1);
    expect(conflict.status).toBe(400);
    expect(await conflict.json()).toEqual({ error: 'INVALID_COMMAND' });
    expect((await stored(match)).game.revision).toBe(initial.revision + 1);
    const records = await coordination.query('select command_id from public.bs_match_commands where match_id = $1', [match.matchId]);
    expect(records.rows).toEqual([{ command_id: action.commandId }]);
  });

  it.each([
    { rival: { kind: 'challenge' } as const, action: 'tax' as const },
    { rival: { kind: 'block', character: 'mercenario' } as const, action: 'steal' as const },
  ])('resolve prioridade $rival.kind, preserva revisão e retoma voto após reconexão', async ({ rival, action }) => {
    const match = await setupRoom(identities);
    await submit(host, match, { type: 'select-action', action, targetId: action === 'steal' ? target : undefined });
    const firstView = await view(target, match);
    const targetVote = vote(firstView, rival);
    const challengerVote = vote(firstView, { kind: 'challenge' });
    const responses = await race(match.id, () => [
      request(target, commandPath(match), 'POST', envelope(firstView, targetVote)),
      request(challenger, commandPath(match), 'POST', envelope(firstView, challengerVote), 1),
    ]);
    expect(responses.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await responses.find(result => !result.ok)?.json()).toEqual({ error: 'STALE_REVISION' });
    const [first, retry] = responses[0].ok ? [target, challenger] : [challenger, target];
    await coordination.query("update public.bs_room_members set last_seen = now() - interval '1 minute' where room_id = $1 and user_id = $2", [match.id, retry]);
    const pending = await view(observer, match);
    expect(pending.window?.responded).toEqual([first]);
    expect(JSON.stringify(pending)).not.toContain('"votes":');
    expect(JSON.stringify(pending)).not.toContain('"deck":');
    expect((await request('unrecognized-session', match.path)).status).toBe(401);
    const reconnected = retry + '.reconnected';
    await ok(reconnected, `/rooms/${match.id}/heartbeat`, 'POST', undefined, 1);
    const restored = await view(reconnected, match);
    expect(restored.window).toMatchObject({ id: firstView.window?.id, responded: [first] });
    await submit(reconnected, match, retry === target ? targetVote : challengerVote);
    expect((await view(observer, match)).window?.responded).toEqual([first, retry]);
    expect((await stored(match)).audit).toHaveLength(0);
    await submit(observer, match, vote(pending, { kind: 'accept' }));
    const after = await stored(match);
    expect(after.audit[0].priority?.playerId).toBe(rival.kind === 'block' ? challenger : first);
    expect(after.audit[0].votes.map(entry => entry.sequence)).toEqual([1, 2, 3]);
    expect(after.game.phase.kind).toBe('loss');
  });

  it('serializa a revanche concorrente e mantém perdas e mãos privadas até o fim', async () => {
    const match = await setupRoom([host, target]);
    // Seed legal preconditions close to victory; execute the remaining game via HTTP.
    const setup = await stored(match);
    setup.game.players[0].credits = 7;
    setup.game.deck.push(setup.game.players[1].cards.pop()!);
    await coordination.query('update public.bs_matches set state = $2 where id = $1', [match.matchId, setup]);
    await submit(host, match, { type: 'select-action', action: 'backstab', targetId: target });
    for (const actor of [host, target]) await submit(actor, match, vote(await view(actor, match), { kind: 'acknowledge' }));
    const victim = await view(target, match);
    const attacker = await view(host, match);
    expect(victim.choices).toHaveLength(1);
    expect(attacker.choices).toEqual([]);
    expect(JSON.stringify(attacker)).not.toContain(victim.choices[0].id);
    await submit(target, match, { type: 'lose', cardId: victim.choices[0].id });
    await submit(host, match, vote(await view(host, match), { kind: 'acknowledge' }));
    const finished = await view(host, match);
    expect(finished.phase.kind).toBe('finished');

    const replies = await race(match.id, () => [
      request(host, match.path + '/rematch', 'POST'),
      request(host, match.path + '/rematch', 'POST', undefined, 1),
    ]);
    expect(replies.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await replies.find(response => !response.ok)?.json()).toEqual({ error: 'INVALID_PHASE' });
    const reset = await view(target, match);
    expect(reset).toMatchObject({ round: 2, revision: finished.revision + 1, phase: { kind: 'action' } });
    expect(reset.hand).toHaveLength(2);
  });

  it('aplica RLS real aos tópicos privados e bloqueia a leitura direta das partidas', async () => {
    const match = await setupRoom([host, target]);
    const security = await coordination.query<{ enabled: boolean }>(`
      select c.relrowsecurity enabled from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'bs_%'`);
    expect(security.rows.length).toBeGreaterThanOrEqual(8);
    expect(security.rows.every(row => row.enabled)).toBe(true);
    const grants = await coordination.query<{ anon_read: boolean; authenticated_read: boolean }>(`
      select has_table_privilege('anon', 'public.bs_matches', 'SELECT') anon_read,
        has_table_privilege('authenticated', 'public.bs_matches', 'SELECT') authenticated_read`);
    expect(grants.rows).toEqual([{ anon_read: false, authenticated_read: false }]);
    async function authorizedQuery(actor: string, topic: string, sql: string, params: unknown[] = []) {
      const connection = await coordination.connect();
      try {
        await connection.query('begin');
        await connection.query('set local role authenticated');
        await connection.query("select set_config('request.jwt.claim.sub',$1,true), set_config('realtime.topic',$2,true)", [actor, topic]);
        return await connection.query(sql, params);
      } finally {
        await connection.query('rollback').finally(() => connection.release());
      }
    }
    const topic = `room:${match.id}`;
    const allowed = await authorizedQuery(host, topic, 'select topic, payload, event from realtime.messages');
    expect(allowed.rows.length).toBeGreaterThan(0);
    for (const row of allowed.rows) expect(row).toEqual({ topic, payload: { kind: 'room' }, event: 'invalidate' });
    expect((await authorizedQuery(observer, topic, 'select topic from realtime.messages')).rows).toEqual([]);
    await expect(authorizedQuery(host, topic, 'select state from public.bs_matches')).rejects.toMatchObject({ code: '42501' });
    const insert = 'insert into realtime.messages(topic,extension,private) values($1,$2,true)';
    await expect(authorizedQuery(host, topic, insert, [topic, 'presence'])).resolves.toMatchObject({ rowCount: 1 });
    await expect(authorizedQuery(observer, topic, insert, [topic, 'presence'])).rejects.toMatchObject({ code: '42501' });
    await expect(authorizedQuery(host, topic, insert, [topic, 'broadcast'])).rejects.toMatchObject({ code: '42501' });

    await ok(host, '/friends/requests', 'POST', { userId: observer });
    const personalTopic = `user:${observer}`;
    const social = await authorizedQuery(observer, personalTopic, 'select topic, payload, event from realtime.messages');
    expect(social.rows).toEqual([{ topic: personalTopic, payload: { kind: 'social' }, event: 'invalidate' }]);
    expect((await authorizedQuery(host, personalTopic, 'select topic from realtime.messages')).rows).toEqual([]);
  });

  it('retorna 503 em lock timeout e libera a transação para repetir o comando', async () => {
    const match = await setupRoom([host, target]);
    const initial = await view(host, match);
    const action = envelope(initial, { type: 'select-action', action: 'tax' });
    const lock = await coordination.connect();
    try {
      await lock.query('begin');
      await lock.query('select id from public.bs_rooms where id = $1 for update', [match.id]);
      const timedOut = await request(host, commandPath(match), 'POST', action, 1);
      expect(timedOut.status).toBe(503);
      expect(await timedOut.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
      expect((await stored(match)).game.revision).toBe(initial.revision);
      const pending = await coordination.query(`
        select pid from pg_stat_activity where datname = current_database()
          and application_name = $1 and state = 'idle in transaction'`, [applications[1]]);
      expect(pending.rows).toHaveLength(0);
    } finally {
      await lock.query('rollback').finally(() => lock.release());
    }
    await ok(host, commandPath(match), 'POST', action, 1);
    expect((await stored(match)).game.revision).toBe(initial.revision + 1);
  }, 10_000);

  it('retorna 503 ao abortar um deadlock e preserva o comando para nova tentativa', async () => {
    const match = await setupRoom([host, target]);
    const initial = await view(host, match);
    const action = envelope(initial, { type: 'select-action', action: 'tax' });
    const conflicting = await coordination.connect();
    try {
      // Deliberately reverse the app's canonical room-then-match lock order.
      // Let the HTTP connection detect the cycle first so it receives 40P01.
      await clients[1].query("set deadlock_timeout = '1s'");
      await conflicting.query('begin');
      await conflicting.query("set local deadlock_timeout = '2s'");
      await conflicting.query('select id from public.bs_matches where id = $1 for update', [match.matchId]);
      const pending = request(host, commandPath(match), 'POST', action, 1);
      await waitForBlocked([applications[1]]);
      const [response] = await Promise.all([
        pending, conflicting.query('select id from public.bs_rooms where id = $1 for update', [match.id]),
      ]);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
      expect((await stored(match)).game.revision).toBe(initial.revision);
    } finally {
      await conflicting.query('rollback').finally(() => conflicting.release());
      await clients[1].query('reset deadlock_timeout');
    }
    await ok(host, commandPath(match), 'POST', action, 1);
    expect((await stored(match)).game.revision).toBe(initial.revision + 1);
  }, 10_000);
});
