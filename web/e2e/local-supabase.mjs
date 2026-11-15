import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const auth = 'http://127.0.0.1:54321';
const frontend = 'http://127.0.0.1:4253';
const api = 'http://127.0.0.1:18085/api/v1';
const key = process.env.BACKSTABBER_LOCAL_SUPABASE_KEY;
assert.ok(key, 'Set BACKSTABBER_LOCAL_SUPABASE_KEY from the local CLI status.');
if (!key.startsWith('sb_publishable_')) {
  const payload = String(key).split('.')[1];
  const claims = payload ? JSON.parse(Buffer.from(payload, 'base64url').toString()) : {};
  assert.equal(claims.role, 'anon', 'The browser must only use a publishable key.');
  assert.equal(claims.iss, 'supabase-demo', 'Expected a local default CLI key.');
}
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => globalThis.fetch(input, { ...init, redirect: 'error' }) },
};
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const tokens = await Promise.all(['a', 'b', 'c'].map(async (label) => {
  const username = 'local_' + label + suffix;
  const client = createClient(auth, key, options);
  const email = username + '@example.com';
  const password = randomUUID();
  const signup = await client.auth.signUp({ email, password });
  assert.ifError(signup.error);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.ok(data.session);
  assert.equal((await client.auth.getUser()).data.user.id, data.user.id);
  await client.realtime.setAuth(data.session.access_token);
  return { label, username, session: data.session, client };
}));
assert.equal(new Set(tokens.map(t => t.session.user.id)).size, 3);

async function request(player, method, path, body, status = 200) {
  const response = await globalThis.fetch(api + path, {
    method, redirect: 'error', headers: { 'Content-Type': 'application/json',
      ...(player ? { Authorization: 'Bearer ' + player.session.access_token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, method + ' ' + path);
  return response.json();
}

const [a, b, c] = tokens;
const id = player => player.session.user.id;
for (const player of tokens) {
  assert.equal(await request(player, 'GET', '/profile'), null);
  const profile = await request(player, 'PUT', '/profile', {
    username: player.username, displayName: 'Local ' + player.label.toUpperCase(), showOnline: true,
  });
  assert.equal(profile.id, id(player));
}

async function channel(player, topic, expected) {
  const messages = [];
  const subscription = player.client.channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'invalidate' }, payload => messages.push(payload.payload));
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timeout for ' + expected)), 12_000);
    subscription.subscribe(state => {
      if (state === 'SUBSCRIBED' || state === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        resolve(state);
      }
    });
  });
  assert.equal(status, expected);
  return messages;
}

async function waitForPayload(messages, kind) {
  const deadline = Date.now() + 12_000;
  while (messages.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const payload = messages.shift();
  assert.ok(payload, 'Expected an invalidation from the local database.');
  // Realtime may attach its own message identifier to a database broadcast.
  const { id: messageId, ...invalidation } = payload;
  if (messageId !== undefined) assert.match(messageId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(invalidation, { kind });
}

try {
  const socialMessages = await channel(b, 'user:' + id(b), 'SUBSCRIBED');
  await channel(c, 'user:' + id(b), 'CHANNEL_ERROR');
  const friendship = await request(a, 'POST', '/friends/requests', { userId: id(b) });
  await waitForPayload(socialMessages, 'social');
  await request(b, 'POST', '/friends/requests/' + friendship.id + '/respond', { accept: true });
  const room = await request(a, 'POST', '/rooms', { capacity: 2 });
  const roomPath = '/rooms/' + room.id;
  await channel(c, 'room:' + room.id, 'CHANNEL_ERROR');
  const messages = await channel(a, 'room:' + room.id, 'SUBSCRIBED');
  const invite = await request(a, 'POST', roomPath + '/invite', { userId: id(b) });
  await request(b, 'POST', '/invites/' + invite.id + '/respond', { accept: true });
  await waitForPayload(messages, 'room');
  for (const player of [a, b]) await request(player, 'POST', roomPath + '/ready', { ready: true });
  const started = await request(a, 'POST', roomPath + '/start', {});
  const match = '/matches/' + started.matchId;
  const view = actor => request(actor, 'GET', match);
  const before = await view(a);
  const guest = await view(b);
  assert.equal(before.hand.length, 2);
  assert.equal(guest.hand.length, 2);
  assert.ok(before.hand.every(card => guest.hand.every(other => card.id !== other.id)));
  assert.ok(!('deck' in before) && !('audit' in before) && before.players.every(player => !('cards' in player)));
  await request(c, 'GET', match, undefined, 404);
  await request(c, 'POST', match + '/commands', {}, 404);
  const directRead = await a.client.from('bs_matches').select('id').eq('id', started.matchId);
  assert.equal(directRead.error?.code, '42501', 'The authenticated browser role must not read stored match state.');
  await request(null, 'GET', match, undefined, 401);
  const act = async (actor, command) => {
    const snapshot = await view(actor);
    return request(actor, 'POST', match + '/commands', {
      protocolVersion: 1, commandId: randomUUID(), expectedRevision: snapshot.revision, command,
    });
  };
  const vote = async (actor, choice) => {
    const snapshot = await view(actor);
    assert.ok(snapshot.window.options.some(option => option.kind === choice.kind && option.character === choice.character));
    return act(actor, { type: 'vote', windowId: snapshot.window.id, choice });
  };
  await act(a, { type: 'select-action', action: 'patrocinio' });
  await vote(b, { kind: 'block', character: 'magnata' });
  assert.equal((await view(a)).window.kind, 'block-reaction');
  await vote(a, { kind: 'accept' });
  assert.equal((await view(a)).players.find(player => player.id === id(a)).credits, 2);
  const actors = new Map(tokens.map(player => [id(player), player]));
  async function answerWindow(choice) {
    const snapshot = await view(a);
    if (!snapshot.window) return;
    for (const playerId of snapshot.window.eligible) {
      if (!snapshot.window.responded.includes(playerId)) await vote(actors.get(playerId), choice);
    }
  }
  await answerWindow({ kind: 'acknowledge' });
  await act(b, { type: 'select-action', action: 'negotiate' });
  await answerWindow({ kind: 'accept' });
  const broker = await view(b);
  assert.equal(broker.choices.length, 4);
  assert.deepEqual((await view(a)).choices, []);
  await act(b, { type: 'negotiate', keepIds: broker.choices.slice(0, 2).map(card => card.id) });
  await answerWindow({ kind: 'acknowledge' });

  for (let turn = 0; turn < 30; turn++) {
    const snapshot = await view(a);
    if (snapshot.phase.kind === 'finished') break;
    const player = snapshot.players.find(entry => entry.id === snapshot.activeId);
    const actor = actors.get(player.id);
    const rival = actor === a ? b : a;
    if (player.credits >= 7) {
      await act(actor, { type: 'select-action', action: 'backstab', targetId: id(rival) });
      await answerWindow({ kind: 'acknowledge' });
      const loss = await view(rival);
      assert.equal(loss.phase.kind, 'loss');
      assert.ok(loss.choices.length > 0);
      assert.deepEqual((await view(actor)).choices, []);
      await act(rival, { type: 'lose', cardId: loss.choices[0].id });
    } else {
      await act(actor, { type: 'select-action', action: actor === a ? 'tax' : 'income' });
      if (actor === a) await answerWindow({ kind: 'accept' });
    }
    await answerWindow({ kind: 'acknowledge' });
  }
  const finished = await view(a);
  assert.equal(finished.phase.kind, 'finished');
  assert.ok(!finished.window);
  const rematch = await request(a, 'POST', match + '/rematch', {});
  assert.equal(rematch.round, 2);
  assert.equal(rematch.revision, finished.revision + 1);
  await request(a, 'POST', roomPath + '/close', {});
  assert.equal((await view(b)).closed, true);
  // The UI test uses fresh profiles without pre-existing relationships.
  await request(a, 'DELETE', '/friends/' + id(b));

  await mkdir('.auth', { recursive: true });
  for (const player of tokens) {
    const storage = { cookies: [], origins: [{ origin: frontend,
      localStorage: [{ name: 'sb-127-auth-token', value: JSON.stringify(player.session) }] }] };
    await writeFile('.auth/' + player.label + '.json', JSON.stringify(storage), { flag: 'wx' });
  }
  const args = tokens.map(player => player.username).join(',');
  process.stdout.write(args + '\n');
} finally {
  await Promise.all(tokens.map(async player => {
    await player.client.removeAllChannels();
    player.client.realtime.disconnect();
  }));
}
