import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApi } from '../../../../web/server/http.ts';

const require = createRequire(new URL('../../../../web/package.json', import.meta.url));
const { Pool } = require('pg');
const database = new URL(process.env.BACKSTABBER_PARITY_DATABASE_URL);
const java = new URL(process.env.BACKSTABBER_PARITY_JAVA_URL);
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && database.hostname === '127.0.0.1'
  && /^\/backstabber_java_[a-f0-9]{32}$/.test(database.pathname) && !database.search && !database.hash,
  'Expected a disposable, randomly named PostgreSQL database on loopback.');
assert.ok(java.protocol === 'http:' && java.hostname === '127.0.0.1' && java.port && !java.username && !java.password,
  'Expected the Spring HTTP test server on loopback.');
const pool = new Pool({ connectionString: database.href });
const ids = {
  first: 'b6100000-0000-0000-0000-000000000001',
  second: 'b6100000-0000-0000-0000-000000000002',
  third: 'b6100000-0000-0000-0000-000000000006',
  missing: 'b6100000-0000-0000-0000-000000000003',
};
const node = createApi(() => pool.connect(), token => ids[token]);

async function scenario(backend) {
  await pool.query('truncate auth.users, public.bs_rooms, realtime.messages cascade');
  await pool.query('insert into auth.users(id) select unnest($1::uuid[])', [Object.values(ids)]);
  const trace = [];
  const variables = new Map();
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, normalize(item)]));
    return variables.has(value) ? variables.get(value) : value;
  };
  async function call(actor, method, path, input, status, bind = {}) {
    const headers = { 'Content-Type': 'application/json', ...(actor ? { Authorization: 'Bearer ' + actor } : {}) };
    const options = { method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) };
    const response = await backend('/api/v1' + path, options);
    assert.equal(response.status, status, method + ' ' + path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('vary'), 'Origin');
    const body = await response.json();
    for (const [field, label] of Object.entries(bind)) {
      const value = body[field];
      const format = field === 'code' ? /^[0-9A-F]{10}$/ : /^[0-9a-f-]{36}$/;
      assert.match(value, format);
      variables.set(value, label);
    }
    if (path === '/invites' && body.length) {
      for (const invite of body) {
        assert.match(invite.expiresAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        const remaining = Date.parse(invite.expiresAt) - Date.now();
        assert.ok(remaining > 840_000 && remaining <= 900_000);
        variables.set(invite.expiresAt, 'expires-in-15m');
      }
    }
    trace.push([method, normalize(body)]);
    return body;
  }
  for (const actor of ['first', 'second', 'third']) {
    await call(actor, 'PUT', '/profile', { username: ` ${actor.toUpperCase()}_profile `, displayName: actor,
      avatarUrl: null, showOnline: actor === 'second' }, 200);
  }
  await call(null, 'GET', '/profile', undefined, 401);
  await call('missing', 'GET', '/profile', undefined, 200);
  await call('second', 'PUT', '/profile', { username: 'first_profile', displayName: 'duplicate' }, 409);
  await call('second', 'PUT', '/profile', { username: 'second_profile', displayName: 'second', showOnline: 'true' }, 400);
  await call('second', 'POST', '/profile/heartbeat', { userId: ids.first }, 200);
  await call('first', 'GET', '/users?username=SECOND_', undefined, 200);
  const friend = await call('first', 'POST', '/friends/requests', { userId: ids.second }, 200, { id: 'request' });
  await call('second', 'POST', '/friends/requests', { userId: ids.first }, 409);
  await call('first', 'GET', '/friends', undefined, 200);
  await call('third', 'POST', `/friends/requests/${friend.id}/respond`, { accept: true }, 404);
  await call('second', 'POST', `/friends/requests/${friend.id}/respond`, { accept: true }, 200);
  await call('first', 'GET', '/friends', undefined, 200);
  await call('second', 'GET', '/friends', undefined, 200);
  const room = await call('first', 'POST', '/rooms', { capacity: 3 }, 200, { id: 'room', code: 'code' });
  const path = '/rooms/' + room.id;
  await call('third', 'GET', path, undefined, 404);
  await call('third', 'POST', path + '/ready', { ready: true }, 404);
  await call('first', 'POST', path + '/ready', { ready: true }, 200);
  await call('first', 'POST', path + '/invite', { userId: ids.third }, 403);
  const invite = await call('first', 'POST', path + '/invite', { userId: ids.second }, 200, { id: 'invite' });
  await call('second', 'GET', '/invites', undefined, 200);
  await call('third', 'POST', `/invites/${invite.id}/respond`, { accept: true }, 404);
  await call('second', 'POST', `/invites/${invite.id}/respond`, { accept: true }, 200);
  await call('second', 'POST', path + '/ready', { ready: true }, 200);
  await call('second', 'POST', '/rooms/join', { code: room.code.toLowerCase() }, 200);
  await call('first', 'POST', path + '/ready', { ready: true }, 200);
  await call('second', 'POST', path + '/heartbeat', {}, 200);
  await call('first', 'GET', '/rooms', undefined, 200);
  await call('first', 'POST', path + '/leave', {}, 200);
  await call('first', 'POST', path + '/close', {}, 404);
  await call('second', 'POST', path + '/close', {}, 200);
  await call('second', 'DELETE', '/friends/' + ids.first, undefined, 200);
  await call('first', 'GET', '/friends', undefined, 200);
  const { rows } = await pool.query(`select topic, event, private, payload, count(*)::int as count
    from realtime.messages group by topic, event, private, payload`);
  const effects = rows.map(row => ({ ...row, topic: row.topic === 'room:' + room.id ? 'room:<id>' : row.topic }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { trace, effects };
}

try {
  const expected = await scenario((path, options) => node(new Request('http://node.test' + path, options)));
  const actual = await scenario((path, options) => fetch(new URL(path, java), options));
  assert.deepEqual(actual, expected);
  console.log(`Node ↔ Java: ${expected.trace.length} respostas HTTP e ${expected.effects.length} grupos de invalidação idênticos`);
} finally {
  await pool.end();
}
