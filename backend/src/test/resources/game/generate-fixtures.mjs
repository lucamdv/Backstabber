import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createOnlineGame, onlineTransition, onlineView } from '../../../../../web/server/online-engine.ts';
import { transition } from '../../../../../web/src/game/core/engine.ts';

const scenarios = [];
const accept = { kind: 'accept' };
const challenge = { kind: 'challenge' };
const acknowledge = { kind: 'acknowledge' };
const block = character => ({ kind: 'block', character });
const copy = state => JSON.parse(JSON.stringify(state));

function scenario(name, count, initialize = () => {}, play = () => {}) {
  const roster = Array.from({ length: count }, (_, index) => ({
    id: String.fromCharCode(97 + index),
    name: index === 0 ? '  Ada  ' : `Pessoa ${index + 1}`,
  }));
  const random = [];
  const seed = 0x6d2b79f5 ^ (scenarios.length + 1);
  let entropy = seed;
  function sample() {
    entropy ^= entropy << 13;
    entropy ^= entropy >>> 17;
    entropy ^= entropy << 5;
    const value = (entropy >>> 0) / 0x100000000;
    random.push(value);
    return value;
  }

  const stateAtCreation = createOnlineGame(roster, sample);
  const creation = { rngCalls: random.length, state: copy(stateAtCreation) };
  const hostId = roster[0].id;
  let state = copy(stateAtCreation);
  initialize(state);
  state = copy(state);

  function views(extras = false) {
    const requests = roster.map(({ id }) => ({ viewerId: id, hostId, closed: false, hostAbandoned: false }));
    if (extras) {
      requests.push(
        { viewerId: hostId, hostId, closed: true, hostAbandoned: true },
        { viewerId: roster[1].id, hostId, closed: false, hostAbandoned: true },
      );
    }
    return requests.map(request => {
      const { viewerId, hostId, closed, hostAbandoned } = request;
      const value = copy(onlineView(state, viewerId, hostId, closed, hostAbandoned));
      checkPrivacy(state, value);
      return { ...request, value };
    });
  }

  const initial = { state, views: views(true) };
  const steps = [];
  function step(label, actor, command, error, expectedRevision = state.game.revision) {
    const previous = copy(state);
    const beforeRandom = random.length;
    const result = copy(onlineTransition(state, actor, command, expectedRevision, sample));
    assert.deepEqual(state, previous, `Input mutation in ${name}: ${label}`);
    if (error) {
      assert.deepEqual(result, { ok: false, error }, `${name}: ${label}`);
      assert.equal(random.length, beforeRandom);
    } else {
      assert.equal(result.ok, true, `${name}: ${label} (${result.error})`);
      assert.equal(result.state.game.revision, expectedRevision + 1);
      state = copy(result.state);
    }
    steps.push({ label, actor, command, expectedRevision, rngCalls: random.length - beforeRandom, result,
      views: views(state.game.phase.kind === 'finished' || !!state.window) });
  }

  function vote(actor, choice, error, windowId = state.window?.id ?? 'missing', revision = state.game.revision) {
    step(`vote ${actor} ${choice.kind}`, actor, { type: 'vote', windowId, choice }, error, revision);
  }

  function drain(choice = accept) {
    const window = state.window;
    assert(window, `Missing window in ${name}`);
    for (const actor of window.eligible.filter(id => !window.votes.some(vote => vote.playerId === id))) {
      vote(actor, choice);
    }
  }

  function action(actor, action, targetId, error) {
    step(action, actor, targetId === undefined ? { type: 'select-action', action }
      : { type: 'select-action', action, targetId }, error);
  }

  function lose(actor, cardId = state.game.players.find(player => player.id === actor)?.cards[0]?.id, error) {
    step('lose influence', actor, { type: 'lose', cardId }, error);
  }

  play({ step, vote, drain, action, lose, current: () => state });
  scenarios.push({ name, roster, seed, random, creation, initial, steps });
}

function checkPrivacy(state, view) {
  const { game } = state;
  const json = JSON.stringify(view);
  for (const field of ['audit', 'continuation', 'votes', 'priority', 'deck', 'offer']) {
    assert(!json.includes(`"${field}":`), `Internal field exposed: ${field}`);
  }
  for (const player of game.players) {
    if (player.id === view.viewerId) {
      assert.deepEqual(view.hand, player.cards);
      assert.equal(view.revealed, true);
      continue;
    }
    for (const card of player.cards) assert(!json.includes(`"${card.id}"`), `Other hand leaked: ${card.id}`);
  }
  for (const card of game.deck) assert(!json.includes(`"${card.id}"`), `Deck leaked: ${card.id}`);
  const seesOffer = !view.closed && !state.window && game.phase.kind === 'negotiation'
    && game.phase.playerId === view.viewerId;
  for (const card of game.offer) assert.equal(json.includes(`"${card.id}"`), seesOffer);
}

function setCredits(state, id, amount) {
  state.game.players.find(player => player.id === id).credits = amount;
}

function hand(state, id, characters) {
  const player = state.game.players.find(candidate => candidate.id === id);
  state.game.deck.unshift(...player.cards);
  player.cards = characters.map(character => {
    const index = state.game.deck.findIndex(card => card.character === character);
    assert(index >= 0, `No ${character} available in the deck`);
    return state.game.deck.splice(index, 1)[0];
  });
}

for (const count of [2, 3, 4, 6, 7, 8, 9, 10]) scenario(`creation-${count}-players`, count);

scenario('full-game-from-initial-deal-to-victory', 2, undefined, ({ action, drain, lose, current, vote }) => {
  const taxTurn = () => {
    action('a', 'tax');
    drain();
    drain(acknowledge);
  };
  const opponentTurn = () => {
    action('b', 'income');
    drain(acknowledge);
  };
  for (let turn = 0; turn < 3; turn++) {
    taxTurn();
    opponentTurn();
  }
  assert.equal(current().game.players[0].credits, 11);
  action('a', 'tax', undefined, 'INVALID_COMMAND');
  action('a', 'backstab', 'b');
  drain(acknowledge);
  lose('b');
  drain(acknowledge);
  opponentTurn();
  taxTurn();
  opponentTurn();
  assert.equal(current().game.players[0].credits, 7);
  action('a', 'backstab', 'b');
  drain(acknowledge);
  lose('b');
  assert.equal(current().game.phase.kind, 'finished');
  vote('b', acknowledge, 'NOT_AUTHORIZED');
  drain(acknowledge);
  assert.equal(current().game.phase.winnerId, 'a');
});

scenario('collective-income-and-command-precedence', 3, undefined, ({ action, vote, drain, step }) => {
  vote('a', accept, 'INVALID_PHASE');
  action('b', 'income', undefined, 'NOT_AUTHORIZED');
  action('a', 'assassinate', 'b', 'INVALID_COMMAND');
  action('a', 'backstab', 'b', 'INVALID_COMMAND');
  action('a', 'steal', undefined, 'INVALID_COMMAND');
  action('a', 'steal', 'a', 'INVALID_COMMAND');
  action('a', 'steal', 'absent', 'INVALID_COMMAND');
  action('a', 'tax', 'b', 'INVALID_COMMAND');
  step('unknown actor and stale revision', 'absent', { type: 'select-action', action: 'income' }, 'STALE_REVISION', -1);
  action('a', 'income');
  action('b', 'income', undefined, 'INVALID_PHASE');
  vote('b', acknowledge, 'INVALID_PHASE', 'wrong-window');
  vote('c', accept, 'NOT_AUTHORIZED');
  vote('b', acknowledge);
  vote('b', acknowledge, 'ALREADY_RESPONDED');
  drain(acknowledge);
});

scenario('first-challenge-wins-truthful-tax', 4, state => {
  hand(state, 'a', ['magnata', 'broker']);
  hand(state, 'c', ['executor']);
}, ({ action, vote, drain, lose, current }) => {
  action('a', 'tax');
  vote('a', challenge, 'NOT_AUTHORIZED');
  vote('c', challenge);
  vote('d', accept, 'STALE_REVISION', undefined, current().game.revision - 1);
  vote('b', challenge);
  vote('d', accept);
  assert.equal(current().audit[0].priority.playerId, 'c');
  drain(acknowledge);
  lose('a', current().game.players[2].cards[0].id, 'NOT_AUTHORIZED');
  lose('c', 'not-a-card', 'INVALID_COMMAND');
  lose('c');
  assert.equal(current().game.players[0].credits, 5);
  drain(acknowledge);
});

scenario('challenge-outranks-earlier-block-and-cancels-bluff', 3, state => {
  hand(state, 'a', ['broker', 'magnata']);
  setCredits(state, 'a', 3);
}, ({ action, vote, drain, lose, current }) => {
  action('a', 'assassinate', 'b');
  assert.equal(current().game.players[0].credits, 0);
  vote('b', block('sentinela'));
  vote('c', challenge);
  assert.equal(current().audit[0].priority.playerId, 'c');
  drain(acknowledge);
  lose('a');
  drain(acknowledge);
  assert.equal(current().game.players[1].cards.length, 2);
});

scenario('patronage-block-first-vote-and-block-window', 4, undefined, ({ action, vote, drain, current }) => {
  action('a', 'patrocinio');
  vote('c', challenge, 'NOT_AUTHORIZED');
  vote('c', block('magnata'));
  vote('b', block('magnata'));
  vote('d', accept);
  assert.equal(current().audit[0].priority.playerId, 'c');
  vote('c', challenge, 'NOT_AUTHORIZED');
  drain();
  drain(acknowledge);
  assert.equal(current().game.players[0].credits, 2);
  action('b', 'patrocinio');
  drain();
  drain(acknowledge);
  assert.equal(current().game.players[1].credits, 4);
});

scenario('true-sentinel-block-replaces-card-and-cancels-executor', 3, state => {
  hand(state, 'b', ['sentinela', 'broker']);
  setCredits(state, 'a', 3);
}, ({ action, vote, drain, lose, current }) => {
  action('a', 'assassinate', 'b');
  vote('c', block('sentinela'), 'NOT_AUTHORIZED');
  vote('b', block('sentinela'));
  vote('c', accept);
  vote('c', challenge);
  vote('a', accept);
  drain(acknowledge);
  lose('c');
  drain(acknowledge);
  assert.equal(current().game.players[0].credits, 0);
  assert.equal(current().game.players[1].cards.length, 2);
});

scenario('false-sentinel-block-continues-executor', 3, state => {
  hand(state, 'b', ['magnata', 'broker']);
  setCredits(state, 'a', 3);
}, ({ action, vote, drain, lose, current }) => {
  action('a', 'assassinate', 'b');
  vote('b', block('sentinela'));
  drain();
  vote('a', challenge);
  drain();
  drain(acknowledge);
  lose('b');
  assert.equal(current().game.phase.reason, 'execution');
  drain(acknowledge);
  lose('b');
  drain(acknowledge);
  assert.equal(current().game.activeId, 'c');
  action('c', 'tax');
  vote('b', accept, 'NOT_AUTHORIZED');
  drain();
  drain(acknowledge);
});

scenario('winner-before-pending-executor', 2, state => {
  hand(state, 'a', ['executor', 'broker']);
  hand(state, 'b', ['magnata']);
  setCredits(state, 'a', 3);
}, ({ action, vote, drain, lose, current }) => {
  action('a', 'assassinate', 'b');
  vote('b', challenge);
  drain(acknowledge);
  lose('b');
  assert.equal(current().game.phase.kind, 'finished');
  assert.equal(current().game.continuation, null);
  drain(acknowledge);
});

scenario('steal-limited-to-target-balance-and-target-block-options', 3, state => {
  setCredits(state, 'b', 1);
  setCredits(state, 'c', 4);
}, ({ action, vote, drain, current }) => {
  action('a', 'steal', 'b');
  vote('c', block('broker'), 'NOT_AUTHORIZED');
  drain();
  drain(acknowledge);
  assert.equal(current().game.players[0].credits, 3);
  assert.equal(current().game.players[1].credits, 0);
  action('b', 'steal', 'c');
  drain();
  drain(acknowledge);
  assert.equal(current().game.players[1].credits, 2);
  action('c', 'steal', 'a');
  vote('a', block('broker'));
  drain();
  drain();
  drain(acknowledge);
  action('a', 'steal', 'b');
  vote('b', block('mercenario'));
  drain();
  drain();
  drain(acknowledge);
});

for (const keep of [1, 2]) {
  scenario(`broker-keeps-${keep}-private-influences`, 3, state => {
    hand(state, 'a', keep === 1 ? ['broker'] : ['broker', 'magnata']);
  }, ({ action, step, drain, current }) => {
    action('a', 'negotiate');
    drain();
    const { players, offer } = current().game;
    const own = players[0].cards.map(card => card.id);
    const desired = offer.slice(0, keep).reverse().map(card => card.id);
    step('non-Broker cannot choose', 'b', { type: 'negotiate', keepIds: desired }, 'NOT_AUTHORIZED');
    step('incomplete selection', 'a', { type: 'negotiate', keepIds: [] }, 'INVALID_COMMAND');
    step('duplicate selection', 'a', { type: 'negotiate', keepIds: [own[0], own[0]] }, 'INVALID_COMMAND');
    step('opponent card selection', 'a',
      { type: 'negotiate', keepIds: [players[1].cards[0].id, ...desired.slice(1)] }, 'INVALID_COMMAND');
    step('keep offer in original card order', 'a', { type: 'negotiate', keepIds: desired });
    drain(acknowledge);
    assert.equal(current().game.players[0].cards.length, keep);
  });
}

scenario('broker-unavailable-when-deck-is-insufficient', 2, state => {
  // Synthetic persisted state explicitly exercises availableCommands' defensive deck-size boundary.
  state.game.deck.splice(1);
}, ({ action }) => {
  action('a', 'negotiate', undefined, 'INVALID_COMMAND');
});

scenario('roundtrip-core-target-phase', 2, state => {
  // Online attacks atomically advance this phase, so obtain it from the actual core.
  const result = transition(state.game, { type: 'select-action', playerId: 'a', action: 'steal' }, 0);
  assert.equal(result.ok, true);
  state.game = result.state;
}, ({ action }) => {
  action('a', 'income', undefined, 'INVALID_PHASE');
});

const output = new URL('./parity-scenarios.json', import.meta.url);
const encoded = `{\n  "schemaVersion": 1,\n  "scenarios": [\n${scenarios.map(item => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]\n}\n`;
if (process.argv.includes('--check')) assert.equal(readFileSync(output, 'utf8').replaceAll('\r\n', '\n'), encoded);
else writeFileSync(output, encoded);
const steps = scenarios.flatMap(item => item.steps);
console.log(`${scenarios.length} scenarios, ${steps.length} commands, ${steps.filter(step => !step.result.ok).length} rejected.`);
