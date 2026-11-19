import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { log } from 'node:console';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

// This fixture deliberately accepts only the local CLI stack and local Java APIs.
const auth = 'http://127.0.0.1:54321';
const apis = { staging: 'http://127.0.0.1:18085/api/v1', productionFixture: 'http://127.0.0.1:18086/api/v1' };
const databaseUrl = new URL(process.env.BACKSTABBER_LOCAL_DATABASE_URL ?? '');
assert.equal(databaseUrl.protocol, 'postgresql:');
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.port, '54322');
assert.equal(databaseUrl.pathname, '/postgres');
assert.equal(databaseUrl.search, '');
assert.equal(databaseUrl.hash, '');
const stagingUrl = new URL(process.env.BACKSTABBER_LOCAL_STAGING_DATABASE_URL ?? '');
assert.equal(stagingUrl.protocol, 'postgresql:');
assert.equal(stagingUrl.hostname, '127.0.0.1');
assert.equal(stagingUrl.port, '54322');
assert.equal(stagingUrl.pathname, '/postgres');
assert.equal(stagingUrl.username, 'bs_staging_app');
assert.equal(stagingUrl.search, '');
assert.equal(stagingUrl.hash, '');
const key = process.env.BACKSTABBER_LOCAL_SUPABASE_KEY;
assert.ok(key, 'Set only the public key returned by the local CLI.');
if (!key.startsWith('sb_publishable_')) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString());
  assert.equal(claims.role, 'anon');
  assert.equal(claims.iss, 'supabase-demo');
}
const db = new Client({ connectionString: databaseUrl.toString() });
const stagingDb = new Client({ connectionString: stagingUrl.toString() });
const players = [];
const clients = [];
const createdUsers = [];
const createdRooms = { public: [], staging: [] };
const tables = ['bs_profiles', 'bs_friend_requests', 'bs_friends', 'bs_rooms',
  'bs_room_members', 'bs_invites', 'bs_matches', 'bs_match_commands'];
async function fingerprints() {
  const digests = [];
  for (const table of tables) {
    const result = await db.query(`select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as digest from public.${table} t`);
    digests.push(result.rows[0].digest);
  }
  return digests;
}
async function request(scope, player, method, path, body, expected = 200) {
  const response = await globalThis.fetch(apis[scope] + path, {
    method, redirect: 'error', signal: globalThis.AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json',
      ...(player ? { Authorization: 'Bearer ' + player.session.access_token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, scope + ' ' + method + ' ' + path);
  return response.json();
}
async function channel(player, topic, expected) {
  const events = [];
  const subscription = player.client.channel(topic, { config: {
    private: true, presence: { key: player.session.user.id },
  } }).on('broadcast', { event: 'invalidate' }, message => events.push(message.payload));
  // Match useRoomRealtime: presence authorization is requested on room joins.
  if (topic.startsWith('room:') || topic.startsWith('hml:room:')) {
    subscription.on('presence', { event: 'sync' }, () => undefined);
  }
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local channel authorization timeout')), 15000);
    subscription.subscribe(status => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        resolve(status);
      }
    });
  });
  assert.equal(result, expected, 'Private channel authorization');
  if (expected === 'CHANNEL_ERROR') await player.client.removeChannel(subscription);
  return { events, subscription };
}
async function presence(sender, observer, userId) {
  const acknowledgements = [];
  const observed = () => {
    const values = observer.presenceState()[userId];
    return Array.isArray(values) && values.some(value => value.connected === true);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const acknowledgement = await sender.track({ connected: true });
    acknowledgements.push(acknowledgement);
    const end = Date.now() + 5000;
    while (!observed() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
    if (observed()) break;
    if (acknowledgement !== 'timed out') break;
  }
  log('Staging presence acknowledgement: ' + acknowledgements.join(','));
  assert.equal(observed(), true, 'Authorized peer must observe staging presence and connected metadata');
}
async function event(events, kind) {
  const end = Date.now() + 15000;
  while (!events.length && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(events.length, 'Expected local invalidation');
  const { id: transportId, ...payload } = events.shift();
  if (transportId !== undefined) assert.equal(typeof transportId, 'string');
  assert.deepEqual(payload, { kind });
}
let connected = false;
let stagingConnected = false;
let before;
try {
  await db.connect();
  connected = true;
  await stagingDb.connect();
  stagingConnected = true;
  before = await fingerprints();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  for (const label of ['a', 'b', 'c']) {
    const client = createClient(auth, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => globalThis.fetch(input, { ...init, redirect: 'error' }) },
    });
    clients.push(client);
    const credentials = { email: 'staging_' + label + suffix + '@example.com', password: randomUUID() };
    const signup = await client.auth.signUp(credentials);
    assert.equal(Boolean(signup.error), false, 'Local signup failed');
    assert.ok(signup.data.user?.id, 'Local signup did not return an identity');
    createdUsers.push(signup.data.user.id);
    const login = await client.auth.signInWithPassword(credentials);
    assert.equal(Boolean(login.error), false, 'Local login failed');
    assert.ok(login.data.session);
    assert.equal(login.data.session.user.id, signup.data.user.id);
    await client.realtime.setAuth(login.data.session.access_token);
    players.push({ client, session: login.data.session, username: label + suffix });
  }
  const [a, b, c] = players;
  const id = player => player.session.user.id;
  for (const player of players) {
    await request('productionFixture', player, 'PUT', '/profile',
      { username: 'prod_' + player.username, displayName: 'Public fixture', showOnline: false });
    assert.equal(await request('staging', player, 'GET', '/profile'), null);
    await request('staging', player, 'PUT', '/profile',
      { username: 'hml_' + player.username, displayName: 'Staging fixture', showOnline: false });
    assert.equal((await request('productionFixture', player, 'GET', '/profile')).username, 'prod_' + player.username);
  }
  log('Shared local Auth: three identities; public and staging profiles isolated');

  const stagingUser = await channel(a, 'hml:user:' + id(a), 'SUBSCRIBED');
  const publicUser = await channel(a, 'user:' + id(a), 'SUBSCRIBED');
  await channel(c, 'hml:user:' + id(a), 'CHANNEL_ERROR');
  const friendship = await request('staging', b, 'POST', '/friends/requests', { userId: id(a) });
  await event(stagingUser.events, 'social');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(publicUser.events.length, 0, 'Staging social updates leaked to public topics');
  await request('staging', a, 'POST', '/friends/requests/' + friendship.id + '/respond', { accept: true });
  await event(stagingUser.events, 'social');
  await new Promise(resolve => setTimeout(resolve, 600));
  stagingUser.events.length = 0;
  await request('productionFixture', b, 'POST', '/friends/requests', { userId: id(a) });
  await event(publicUser.events, 'social');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(stagingUser.events.length, 0, 'Public social updates leaked to staging topics');

  const publicRoom = await request('productionFixture', a, 'POST', '/rooms', { capacity: 2 });
  createdRooms.public.push(publicRoom.id);
  const room = await request('staging', a, 'POST', '/rooms', { capacity: 2 });
  createdRooms.staging.push(room.id);
  assert.notEqual(room.code, publicRoom.code);
  await request('staging', b, 'POST', '/rooms/join', { code: publicRoom.code }, 404);
  await request('productionFixture', b, 'POST', '/rooms/join', { code: room.code }, 404);
  await channel(a, 'room:' + room.id, 'CHANNEL_ERROR');
  await channel(a, 'hml:room:' + publicRoom.id, 'CHANNEL_ERROR');
  await channel(c, 'hml:room:' + room.id, 'CHANNEL_ERROR');
  const stageRoomChannel = await channel(a, 'hml:room:' + room.id, 'SUBSCRIBED');
  const publicRoomChannel = await channel(a, 'room:' + publicRoom.id, 'SUBSCRIBED');
  const invite = await request('staging', a, 'POST', '/rooms/' + room.id + '/invite', { userId: id(b) });
  await request('staging', b, 'POST', '/invites/' + invite.id + '/respond', { accept: true });
  const guestRoomChannel = await channel(b, 'hml:room:' + room.id, 'SUBSCRIBED');
  await presence(stageRoomChannel.subscription, guestRoomChannel.subscription, id(a));
  await event(stageRoomChannel.events, 'room');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(publicRoomChannel.events.length, 0, 'Staging lobby updates leaked to public room');
  log('Private Realtime: hml and legacy channels isolated; outsider subscriptions denied');

  for (const player of [a, b]) await request('staging', player, 'POST', '/rooms/' + room.id + '/ready', { ready: true });
  const started = await request('staging', a, 'POST', '/rooms/' + room.id + '/start', {});
  const matchPath = '/matches/' + started.matchId;
  const own = await request('staging', a, 'GET', matchPath);
  const guest = await request('staging', b, 'GET', matchPath);
  assert.equal(own.hand.length, 2);
  assert.equal(guest.hand.length, 2);
  assert.ok(own.hand.every(card => guest.hand.every(other => other.id !== card.id)));
  assert.ok(!('deck' in own) && !('audit' in own) && own.players.every(player => !('cards' in player)));
  await request('staging', c, 'GET', matchPath, undefined, 404);
  await request('staging', c, 'POST', matchPath + '/commands', {}, 404);
  await request('productionFixture', a, 'GET', matchPath, undefined, 404);
  await request('staging', null, 'GET', matchPath, undefined, 401);
  await request('staging', a, 'POST', matchPath + '/commands', {
    protocolVersion: 1, commandId: randomUUID(), expectedRevision: own.revision,
    command: { type: 'select-action', action: 'income' },
  });
  assert.equal((await stagingDb.query('select count(*)::int n from bs_staging.bs_match_commands where match_id=$1', [started.matchId])).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from public.bs_matches where id=$1', [started.matchId])).rows[0].n, 0);
  log('Java staging: friendship, invite, lobby, private match and persisted command passed');
} finally {
  const networkCleanup = await Promise.allSettled(clients.map(async client => {
    try {
      await client.removeAllChannels();
      await client.auth.signOut({ scope: 'local' });
    } finally {
      client.realtime.disconnect();
    }
  }));
  const cleanupErrors = [];
  async function attempt(cleanup) {
    try { await cleanup(); } catch (error) { cleanupErrors.push(error); }
  }
  if (stagingConnected && createdUsers.length) await attempt(() => stagingDb.query(
    'delete from bs_staging.bs_rooms where id = any($1::uuid[]) or host_id = any($2::uuid[])',
    [createdRooms.staging, createdUsers]));
  if (connected && createdUsers.length) {
    await attempt(() => db.query('delete from public.bs_rooms where id = any($1::uuid[]) or host_id = any($2::uuid[])',
      [createdRooms.public, createdUsers]));
    // Only UUIDs created by this local fixture are eligible for cleanup.
    await attempt(() => db.query('delete from auth.users where id = any($1::uuid[])', [createdUsers]));
  }
  if (before) await attempt(async () => {
    assert.deepEqual(await fingerprints(), before, 'Public game data changed after local fixture cleanup');
  });
  await Promise.allSettled([db.end(), stagingDb.end()]);
  assert.equal(cleanupErrors.length, 0, 'Local database cleanup failed');
  assert.equal(networkCleanup.every(result => result.status === 'fulfilled'), true,
    'Network cleanup failed after database restoration');
  log('Cleanup passed; all eight public game table fingerprints preserved');
}
