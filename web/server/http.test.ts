// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { OnlineCommand, OnlineView } from '../src/game/application/online-contracts';
import { createApi, supabaseAuthenticator } from './http';
import type { OnlineState } from './online-engine';
import { createTestDatabase } from './test-db';

const ids = ['1', '2', '3', '4'].map(last => `10000000-0000-0000-0000-00000000000${last}`);
const [ada, bia, caio, outsider] = ids;
let database: PGlite;
let queue = Promise.resolve();
const connect = async () => {
  // PGlite has one physical connection. Keep transactions separate when two
  // independent HTTP requests enter the handler concurrently.
  const turn = queue;
  let release!: () => void;
  queue = new Promise(resolve => { release = resolve; });
  await turn;
  return { query: database.query.bind(database), release } as unknown as PoolClient;
};
const fakeAuth = (async (_url, options) => {
  const token = new Headers(options?.headers).get('Authorization')?.slice(7) ?? '';
  const id = token.replace(/^session\./, '').replace(/\.reconnected$/, '');
  return ids.includes(id) ? Response.json({ id }) : Response.json({}, { status: 401 });
}) as typeof fetch;
const api = createApi(connect, supabaseAuthenticator('https://supabase.test', 'test-publishable', fakeAuth));
const apiSecondInstance = createApi(connect, supabaseAuthenticator('https://supabase.test', 'test-publishable', fakeAuth));
const request = (actor: string, path: string, method = 'GET', payload?: unknown, handler = api) =>
  handler(new Request(`http://backstabber.test/api/v1${path}`, {
    method, headers: { Authorization: `Bearer session.${actor}`, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }));
async function ok<T = unknown>(actor: string, path: string, method = 'GET', payload?: unknown) {
  const response = await request(actor, path, method, payload);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as T;
}

beforeAll(async () => {
  database = await createTestDatabase();
  for (const [index, id] of ids.entries()) {
    await database.query('insert into auth.users(id) values($1)', [id]);
    await ok(id, '/profile', 'PUT', { username: 'player' + index, displayName: 'Player ' + index });
  }
}, 60_000);
afterAll(async () => { await database?.close(); });

async function setupRoom(players: string[]) {
  const room = await ok<{ id: string; code: string }>(players[0], '/rooms', 'POST', { capacity: players.length });
  for (const actor of players.slice(1)) await ok(actor, '/rooms/join', 'POST', { code: room.code });
  for (const actor of players) await ok(actor, `/rooms/${room.id}/ready`, 'POST', { ready: true });
  const started = await ok<{ matchId: string }>(players[0], `/rooms/${room.id}/start`, 'POST');
  return { ...room, matchId: started.matchId, path: '/matches/' + started.matchId };
}

let sequence = 0;
function envelope(view: OnlineView, command: OnlineCommand, commandId = `test-${++sequence}`) {
  return { protocolVersion: 1, commandId, expectedRevision: view.revision, command };
}
async function submit(actor: string, path: string, command: OnlineCommand) {
  const view = await ok<OnlineView>(actor, path);
  await ok(actor, path + '/commands', 'POST', envelope(view, command));
}
async function acknowledge(actor: string, path: string) {
  const view = await ok<OnlineView>(actor, path);
  await ok(actor, path + '/commands', 'POST', envelope(view,
    { type: 'vote', windowId: view.window!.id, choice: { kind: 'acknowledge' } }));
}

it('autoriza sessões, sincroniza três participantes e retoma um voto pendente', async () => {
  const { id, path } = await setupRoom([ada, bia, caio]);
  expect((await request('expired', path)).status).toBe(401);
  expect((await request(outsider, path)).status).toBe(404);
  const start = await ok<OnlineView>(ada, path);
  expect(start.hand).toHaveLength(2);
  expect(start.activeId).toBe(ada);
  const impersonation = await request(bia, path + '/commands', 'POST', {
    ...envelope(start, { type: 'select-action', action: 'tax' }),
    command: { type: 'select-action', action: 'tax', playerId: ada },
  });
  expect(impersonation.status).toBe(400);
  await submit(ada, path, { type: 'select-action', action: 'tax' });
  const [first, second] = await Promise.all([ok<OnlineView>(bia, path), ok<OnlineView>(caio, path)]);
  expect(first.window?.id).toBe(second.window?.id);
  expect(first.window?.eligible).toEqual([bia, caio]);
  expect(first.hand).toHaveLength(2);
  for (const card of first.hand) expect(JSON.stringify(second)).not.toContain(card.id);
  expect(JSON.stringify(second)).not.toContain('"deck":');
  const vote = envelope(first, { type: 'vote', windowId: first.window!.id, choice: { kind: 'accept' } });
  const attempts = await Promise.all([
    request(bia, path + '/commands', 'POST', vote),
    request(bia, path + '/commands', 'POST', vote, apiSecondInstance),
  ]);
  const replies = await Promise.all(attempts.map(response => response.json()));
  expect(replies).toEqual([{ ok: true, revision: first.revision + 1 }, { ok: true, revision: first.revision + 1 }]);
  await database.query("update public.bs_room_members set last_seen = now() - interval '1 minute' where room_id=$1 and user_id=$2", [id, caio]);
  const pending = await ok<OnlineView>(ada, path);
  expect(pending.phase.kind).toBe('reaction');
  expect(pending.window?.responded).toEqual([bia]);
  const caioVote = { type: 'vote', windowId: first.window!.id, choice: { kind: 'challenge' } } as const;
  const stale = await request(caio, path + '/commands', 'POST', envelope(second, caioVote));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'STALE_REVISION' });
  const reconnected = caio + '.reconnected';
  await ok(reconnected, `/rooms/${id}/heartbeat`, 'POST');
  const restored = await ok<OnlineView>(reconnected, path);
  expect(restored.window).toMatchObject({ id: first.window?.id, responded: [bia] });
  expect(restored.hand).toEqual(second.hand);
  await ok(reconnected, path + '/commands', 'POST', envelope(restored, caioVote));
  const result = await ok<OnlineView>(bia, path);
  expect(result.phase.kind).toBe('loss');
  expect(result.window?.kind).toBe('acknowledge');
  expect(result.choices).toEqual([]);
});

it('resolve perda exclusiva até a vitória e inicia nova rodada pelo anfitrião', async () => {
  const { path } = await setupRoom([ada, bia]);
  const confirm = async () => {
    await acknowledge(ada, path);
    await acknowledge(bia, path);
  };
  const taxAndIncome = async () => {
    await submit(ada, path, { type: 'select-action', action: 'tax' });
    const reaction = await ok<OnlineView>(bia, path);
    await submit(bia, path, { type: 'vote', windowId: reaction.window!.id, choice: { kind: 'accept' } });
    await confirm();
    await submit(bia, path, { type: 'select-action', action: 'income' });
    await confirm();
  };
  await taxAndIncome();
  await taxAndIncome();
  await submit(ada, path, { type: 'select-action', action: 'backstab', targetId: bia });
  await confirm();
  const firstLoss = await ok<OnlineView>(bia, path);
  expect(firstLoss.choices).toHaveLength(2);
  await submit(bia, path, { type: 'lose', cardId: firstLoss.choices[0].id });
  await confirm();
  await submit(bia, path, { type: 'select-action', action: 'income' });
  await confirm();
  await taxAndIncome();
  await taxAndIncome();
  await submit(ada, path, { type: 'select-action', action: 'backstab', targetId: bia });
  await confirm();
  const victim = await ok<OnlineView>(bia, path);
  const winner = await ok<OnlineView>(ada, path);
  expect(victim.choices).toHaveLength(1);
  expect(winner.choices).toHaveLength(0);
  const loss = { type: 'lose', cardId: victim.choices[0].id } as const;
  expect((await request(ada, path + '/commands', 'POST', envelope(winner, loss))).status).toBe(403);
  await submit(bia, path, loss);
  await acknowledge(ada, path);
  const finished = await ok<OnlineView>(bia, path);
  expect(finished.phase).toEqual({ kind: 'finished', winnerId: ada, cards: [] });
  expect((await request(bia, path + '/rematch', 'POST')).status).toBe(403);
  const rematch = await ok<OnlineView>(ada, path + '/rematch', 'POST');
  expect(rematch).toMatchObject({ round: 2, phase: { kind: 'action' } });
  expect(rematch.revision).toBeGreaterThan(finished.revision);
  expect((await ok<OnlineView>(bia, path)).hand).toHaveLength(2);
}, 30_000);

it('serializa duas contestações concorrentes e audita a prioridade confirmada', async () => {
  const { matchId, path } = await setupRoom(ids);
  await submit(ada, path, { type: 'select-action', action: 'tax' });
  const view = await ok<OnlineView>(bia, path);
  const command = { type: 'vote', windowId: view.window!.id, choice: { kind: 'challenge' } } as const;
  const responses = await Promise.all([
    request(bia, path + '/commands', 'POST', envelope(view, command)),
    request(caio, path + '/commands', 'POST', envelope(view, command), apiSecondInstance),
  ]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const [first, second] = responses[0].ok ? [bia, caio] : [caio, bia];
  await submit(second, path, command);
  expect((await ok<OnlineView>(outsider, path)).window?.responded).toEqual([first, second]);
  await submit(outsider, path, { ...command, choice: { kind: 'accept' } });
  const { rows: [saved] } = await database.query<{ state: OnlineState }>(
    'select state from public.bs_matches where id = $1', [matchId]);
  expect(saved.state.audit[0].priority).toMatchObject({ playerId: first, sequence: 1 });
});
