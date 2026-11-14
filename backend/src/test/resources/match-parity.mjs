import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(new URL('../../../../web/package.json', import.meta.url));
const { Pool } = require('pg');
const database = new URL(process.env.BACKSTABBER_PARITY_DATABASE_URL);
const java = new URL(process.env.BACKSTABBER_PARITY_JAVA_URL);
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && database.hostname === '127.0.0.1'
  && /^\/backstabber_java_[a-f0-9]{32}$/.test(database.pathname) && !database.search && !database.hash);
assert.ok(java.protocol === 'http:' && java.hostname === '127.0.0.1' && java.port && !java.username && !java.password);
const pool = new Pool({ connectionString: database.href });
const ids = {
  first: 'b6100000-0000-0000-0000-000000000001',
  second: 'b6100000-0000-0000-0000-000000000002',
  third: 'b6100000-0000-0000-0000-000000000006',
};
const originalRandomInt = crypto.randomInt;
crypto.randomInt = maximum => {
  assert.equal(maximum, 0x100000000);
  return 0x80000000;
};
syncBuiltinESMExports();
const { createApi } = await import('../../../../web/server/http.ts');
const node = createApi(() => pool.connect(), async token => ids[token]);
const requestNode = (path, options) => node(new Request('http://node.test/api/v1' + path, options));
const requestJava = (path, options) => fetch(new URL('/api/v1' + path, java), options);

async function scenario(request, exchange = request) {
  await pool.query('truncate auth.users, public.bs_rooms, realtime.messages cascade');
  await pool.query('insert into auth.users(id) select unnest($1::uuid[])', [Object.values(ids)]);
  const trace = [];
  const records = [];
  let match;
  let revision = 0;
  async function call(actor, method, path, body, status = 200, implementation = request) {
    const response = await implementation(path, {
      method, headers: { Authorization: 'Bearer ' + actor, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, status, method + ' ' + path + ' ' + JSON.stringify(result));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('vary'), 'Origin');
    trace.push([method, status, result]);
    return result;
  }
  async function stored() {
    const { rows: [row] } = await pool.query('select state from public.bs_matches where id = $1', [match]);
    return row.state;
  }
  const view = (actor, api = request) => call(actor, 'GET', '/matches/' + match, undefined, 200, api);
  const endpoint = () => '/matches/' + match + '/commands';
  const select = (action, targetId) => ({ type: 'select-action', action, targetId });
  async function apply(actor, command, implementation = request) {
    const commandId = revision === 0 ? 'command-\t-\u000f-😀-\u2028-\ud800' : 'command-' + (revision + 1);
    const extra = command.type === 'vote' ? { choice: { ...command.choice, ignored: false } } : {};
    const envelope = { expectedRevision: revision, commandId, command: { ...command, ...extra, ignored: 55 },
      protocolVersion: 1, extra: true };
    const result = await call(actor, 'POST', endpoint(), envelope, 200, implementation);
    assert.deepEqual(result, { ok: true, revision: ++revision });
    const { rows: [persisted] } = await pool.query(
      'select command_id, fingerprint, result from public.bs_match_commands where match_id = $1 and user_id = $2 and command_id = $3',
      [match, ids[actor], commandId]);
    assert.equal(persisted.command_id, Buffer.from(commandId, 'utf8').toString('utf8'));
    assert.equal(persisted.fingerprint,
      JSON.stringify({ protocolVersion: 1, commandId, expectedRevision: revision - 1, command }));
    assert.deepEqual(persisted.result, result);
    records.push(persisted);
    const state = await stored();
    assert.equal(state.game.revision, revision);
    trace.push(['JSONB', state]);
    return envelope;
  }
  const actorOf = id => Object.keys(ids).find(name => ids[name] === id);
  async function settle(kind = 'acknowledge', api = request) {
    const initial = (await stored()).window;
    if (!initial) return;
    for (const id of initial.eligible) {
      const actor = actorOf(id);
      const current = await view(actor, api);
      const choice = typeof kind === 'string' ? { kind } : kind;
      assert.ok(current.window.options.some(option => option.kind === choice.kind && option.character === choice.character));
      await apply(actor, { type: 'vote', windowId: current.window.id, choice }, api);
    }
  }

  for (const actor of Object.keys(ids)) {
    await call(actor, 'PUT', '/profile', { username: actor + '_profile', displayName: actor }, 200);
  }
  const room = await call('first', 'POST', '/rooms', { capacity: 2 });
  const roomPath = '/rooms/' + room.id;
  await call('second', 'POST', '/rooms/join', { code: room.code });
  await call('first', 'POST', roomPath + '/start', {}, 409);
  for (const actor of ['first', 'second']) await call(actor, 'POST', roomPath + '/ready', { ready: true });
  match = (await call('first', 'POST', roomPath + '/start', {})).matchId;
  assert.match(match, /^[a-f0-9-]{36}$/);
  await call('first', 'POST', roomPath + '/start', {});
  trace.push(['JSONB', await stored()]);
  assert.notDeepEqual((await view('first')).hand, (await view('second')).hand);
  await call('third', 'GET', '/matches/' + match, undefined, 404);
  await call('third', 'POST', endpoint(), {}, 404);
  await call('first', 'GET', endpoint(), undefined, 405);
  await call('first', 'GET', '/matches/%' + match.charCodeAt(0).toString(16) + match.slice(1), undefined, 404);
  await call('first', 'GET', '/matches/' + match + '/%63ommands', undefined, 404);
  await call('first', 'POST', endpoint(), { protocolVersion: '1' }, 400);
  for (const input of [
    { expectedRevision: 9007199254740992 },
    { command: { ...select('income'), targetId: null } },
    { command: { ...select('income'), playerId: ids.second } },
    { command: { type: 'negotiate', keepIds: ['a', 'b', 'c'] } },
    { command: { type: 'negotiate', keepIds: [3] } },
    { commandId: '😀'.repeat(41) },
  ]) {
    await call('first', 'POST', endpoint(),
      { protocolVersion: 1, commandId: 'bad', expectedRevision: 0, command: select('income'), ...input }, 400);
  }

  const firstEnvelope = await apply('first', select('negotiate'));
  assert.deepEqual(await view('first', exchange), await view('first'));
  assert.deepEqual(await call('first', 'POST', endpoint(),
    { ...firstEnvelope, command: select('negotiate'), extra: null }, 200, exchange), { ok: true, revision: 1 });
  await settle('accept', exchange);
  assert.deepEqual(await view('first', exchange), await view('first'));
  const offered = (await view('first')).choices;
  assert.equal(offered.length, 4);
  const guest = await view('second');
  assert.deepEqual(guest.choices, []);
  assert.ok(offered.every(card => !JSON.stringify(guest).includes(card.id)));
  await call('second', 'POST', endpoint(), {
    protocolVersion: 1, commandId: 'not-its-offer', expectedRevision: revision,
    command: { type: 'negotiate', keepIds: offered.slice(0, 2).map(card => card.id) },
  }, 403);
  await apply('first', { type: 'negotiate', keepIds: [offered[3].id, offered[0].id] });
  await settle();

  await apply('second', select('patrocinio'));
  await settle({ kind: 'block', character: 'magnata' });
  await settle('accept');
  if ((await stored()).window) await settle();

  await apply('first', select('tax'));
  await settle('challenge');
  await settle();
  const loss = (await stored()).game.phase;
  assert.equal(loss.kind, 'loss');
  const victim = actorOf(loss.victimId);
  const winner = victim === 'first' ? 'second' : 'first';
  await apply(victim, { type: 'lose', cardId: (await view(victim)).choices[0].id });
  await settle();

  for (let turns = 0; turns < 18; turns++) {
    const { game } = await stored();
    if (game.phase.kind === 'finished') break;
    const current = actorOf(game.activeId);
    const credits = game.players.find(player => player.id === game.activeId).credits;
    if (current === winner && credits >= 7) {
      await apply(winner, select('backstab', ids[victim]));
      await settle();
      await apply(victim, { type: 'lose', cardId: (await view(victim)).choices[0].id });
      await call('first', 'POST', '/matches/' + match + '/rematch', {}, 409);
      await settle();
    } else {
      await apply(current, select(current === winner ? 'tax' : 'income'));
      if (current === winner) await settle('accept');
      await settle();
    }
  }

  const finished = await stored();
  assert.equal(finished.game.phase.kind, 'finished');
  assert.equal(finished.game.phase.winnerId, ids[winner]);
  assert.deepEqual((await view(victim)).phase.cards, []);
  await call(victim, 'POST', endpoint(), {
    protocolVersion: 1, commandId: 'eliminated', expectedRevision: revision, command: select('income'),
  }, 403);
  await call('second', 'POST', '/matches/' + match + '/rematch', {}, 403);
  const fresh = await call('first', 'POST', '/matches/' + match + '/rematch', {});
  assert.equal(fresh.revision, ++revision);
  assert.equal(fresh.round, 2);
  const rematch = await stored();
  assert.deepEqual(rematch.audit, finished.audit);
  trace.push(['JSONB', rematch]);
  assert.deepEqual(await call('first', 'POST', endpoint(), firstEnvelope), { ok: true, revision: 1 });
  assert.deepEqual(await view('second'), await view('second', exchange));
  const { rows: effects } = await pool.query('select topic, event, private, payload, count(*)::int as count'
    + ' from realtime.messages group by topic, event, private, payload order by topic, event, private, payload');
  const { rows: count } = await pool.query('select count(*)::int from public.bs_match_commands where match_id = $1', [match]);
  assert.equal(count[0].count, records.length);
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, normalize(item)]));
    if (value === room.id) return '<room>';
    if (value === room.code) return '<code>';
    if (value === match) return '<match>';
    if (value === 'room:' + room.id) return 'room:<room>';
    return value;
  };
  return { trace: normalize(trace), records, effects: normalize(effects) };
}
try {
  const expected = await scenario(requestNode);
  assert.deepEqual(await scenario(requestJava), expected);
  assert.deepEqual(await scenario(requestNode, requestJava), expected);
  assert.deepEqual(await scenario(requestJava, requestNode), expected);
  console.log('Match Node ↔ Java: ' + expected.trace.filter(([kind]) => kind !== 'JSONB').length
    + ' HTTP responses per scenario, ' + expected.records.length + ' exact fingerprints, '
    + expected.trace.filter(([kind]) => kind === 'JSONB').length + ' exact JSONB states, '
    + expected.effects.length + ' invalidation groups, and two mixed-backend round trips');
} finally {
  crypto.randomInt = originalRandomInt;
  syncBuiltinESMExports();
  await pool.end();
}
