import { actions, characters } from '../application/contracts.js';
import type {
  Action, AvailableCommands, Block, Card, Character, CommandError, Declaration,
  GameCommand, GameEvent, HistoryEntry, Phase, PlayerId,
} from '../application/contracts.js';
import { deckSizeFor, validateNames } from './setup.js';

export type Player = { id: PlayerId; name: string; credits: number; cards: Card[] };
export type GameState = {
  revision: number;
  activeId: PlayerId;
  players: Player[];
  deck: Card[];
  phase: Phase;
  continuation: Declaration | null;
  offer: Card[];
  history: HistoryEntry[];
  cemetery: Character[];
  lastEvent?: GameEvent;
};
type Random = () => number;
type Transition = { ok: true; state: GameState } | { ok: false; error: CommandError };
const claims: Partial<Record<Action, Character>> = {
  tax: 'magnata', steal: 'mercenario', assassinate: 'executor', negotiate: 'broker',
};
const targeted: Action[] = ['steal', 'assassinate', 'backstab'];
const labels: Record<Action, string> = {
  income: 'Renda', patrocinio: 'Patrocínio', tax: 'Taxar', steal: 'Extorquir',
  assassinate: 'Executar', backstab: 'Backstab', negotiate: 'Negociar',
};
export const characterNames: Record<Character, string> = {
  magnata: 'Magnata', executor: 'Executor', sentinela: 'Sentinela', mercenario: 'Mercenário', broker: 'Broker',
};

function shuffle(cards: Card[], random: Random) {
  for (let index = cards.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
}

export function createGame(names: readonly string[], random: Random = Math.random): GameState {
  const error = validateNames(names);
  if (error) throw Error(error);
  const copies = deckSizeFor(names.length) / characters.length;
  const deck = characters.flatMap(character =>
    Array.from({ length: copies }, (_, i) => ({ id: `${character}-${i}`, character })));
  shuffle(deck, random);
  const players = names.map((name, index) => ({
    id: `p${index + 1}`, name: name.trim(), credits: 2, cards: [deck.pop()!, deck.pop()!],
  }));
  return { revision: 0, activeId: players[0].id, players, deck, phase: { kind: 'action' },
    continuation: null, offer: [], history: [], cemetery: [] };
}

function player(state: GameState, id: PlayerId) {
  return state.players.find(candidate => candidate.id === id);
}

function log(state: GameState, name: string, text: string) {
  state.history = [{ player: name, text }, ...state.history].slice(0, 5);
}

function advance(state: GameState) {
  const current = state.players.findIndex(entry => entry.id === state.activeId);
  const next = state.players.slice(current + 1).concat(state.players.slice(0, current + 1))
    .find(entry => entry.cards.length > 0);
  if (!next) throw Error('Partida sem jogadores ativos.');
  state.activeId = next.id;
  state.phase = { kind: 'action' };
  state.continuation = null;
  state.offer = [];
}

export function availableCommands(state: GameState): AvailableCommands {
  const available: AvailableCommands = { availableActions: [], targets: [], challenges: [], blocks: [] };
  const phase = state.phase;
  const others = state.players.filter(entry => entry.id !== state.activeId && entry.cards.length);
  const credits = player(state, state.activeId)?.credits ?? 0;
  if (phase.kind === 'action') {
    available.availableActions = credits >= 10 && others.length ? ['backstab'] : actions.filter(action => {
      if (targeted.includes(action) && !others.length) return false;
      if (action === 'assassinate') return credits >= 3;
      if (action === 'backstab') return credits >= 7;
      if (action === 'negotiate') return state.deck.length >= 2;
      return true;
    });
  }
  if (phase.kind === 'target') available.targets = others.map(entry => entry.id);
  if (phase.kind === 'reaction') {
    const { action, targetId } = phase.declaration;
    if (claims[action]) available.challenges = others.map(entry => entry.id);
    for (const { id } of others) {
      if (action === 'patrocinio') available.blocks.push({ playerId: id, character: 'magnata' });
      if (id !== targetId) continue;
      if (action === 'assassinate') available.blocks.push({ playerId: id, character: 'sentinela' });
      if (action === 'steal') available.blocks.push(
        { playerId: id, character: 'mercenario' }, { playerId: id, character: 'broker' });
    }
  }
  if (phase.kind === 'block-reaction') {
    available.challenges = state.players.filter(entry => entry.cards.length && entry.id !== phase.block.playerId)
      .map(entry => entry.id);
  }
  return available;
}

function declare(state: GameState, actor: Player, action: Action, targetId: PlayerId | null) {
  const declaration = { action, playerId: actor.id, targetId };
  log(state, actor.name, targetId ? `${labels[action]} → ${player(state, targetId)?.name}` : labels[action]);
  if (action === 'income') {
    actor.credits++;
    state.lastEvent = { kind: 'income', playerId: actor.id };
    advance(state);
  } else if (action === 'backstab' && targetId) {
    actor.credits -= 7;
    state.lastEvent = { kind: 'backstab', playerId: actor.id, targetId };
    state.phase = { kind: 'loss', victimId: targetId, reason: 'backstab' };
  } else {
    if (action === 'assassinate') actor.credits -= 3;
    state.phase = { kind: 'reaction', declaration };
  }
}

function resolveAction(state: GameState, declaration: Declaration) {
  const actor = player(state, declaration.playerId)!;
  const target = declaration.targetId ? player(state, declaration.targetId) : undefined;
  state.continuation = null;
  log(state, actor.name, `${labels[declaration.action]}: ação efetuada.`);
  switch (declaration.action) {
    case 'patrocinio': actor.credits += 2; break;
    case 'tax': actor.credits += 3; break;
    case 'steal':
      if (target?.cards.length) {
        const amount = Math.min(2, target.credits);
        target.credits -= amount;
        actor.credits += amount;
      }
      break;
    case 'assassinate':
      if (target?.cards.length) {
        state.phase = { kind: 'loss', victimId: target.id, reason: 'execution' };
        return;
      }
      break;
    case 'negotiate':
      state.offer = [state.deck.pop()!, state.deck.pop()!];
      state.phase = { kind: 'negotiation', playerId: actor.id, keep: actor.cards.length };
      return;
  }
  advance(state);
}

function challenge(state: GameState, challenger: Player, declaration: Declaration, block: Block | undefined, random: Random) {
  const character = block?.character ?? claims[declaration.action]!;
  const declarer = player(state, block?.playerId ?? declaration.playerId)!;
  const index = declarer.cards.findIndex(card => card.character === character);
  const truthful = index >= 0;
  log(state, challenger.name, `Contestou ${block ? 'o bloqueio' : 'a ação'} de ${declarer.name}.`);
  if (truthful) {
    const replacement = state.deck.pop()!;
    const [proof] = declarer.cards.splice(index, 1);
    declarer.cards.push(replacement);
    state.deck.push(proof);
    shuffle(state.deck, random);
  }
  state.continuation = truthful === !block ? declaration : null;
  state.phase = {
    kind: 'loss', victimId: truthful ? challenger.id : declarer.id, reason: 'challenge',
    challenge: { truthful, challengerId: challenger.id, declarerId: declarer.id, character, declaration, block },
  };
}

function lose(state: GameState, victim: Player, cardId: string, random: Random) {
  const [card] = victim.cards.splice(victim.cards.findIndex(entry => entry.id === cardId), 1);
  state.cemetery.push(card.character);
  state.deck.push(card);
  shuffle(state.deck, random);
  log(state, victim.name, `Perdeu influência: ${characterNames[card.character]}`);
  if (!victim.cards.length) {
    log(state, 'SISTEMA', `${victim.name} foi eliminado!`);
    state.lastEvent = { kind: 'eliminated', playerId: victim.id };
  }
  const survivors = state.players.filter(entry => entry.cards.length);
  if (survivors.length === 1) {
    state.phase = { kind: 'finished', winnerId: survivors[0].id, cards: survivors[0].cards };
    state.continuation = null;
  } else if (state.continuation) {
    resolveAction(state, state.continuation);
  } else {
    advance(state);
  }
}

function validate(state: GameState, command: GameCommand): CommandError | null {
  const actor = player(state, command.playerId);
  if (!actor?.cards.length) return 'NOT_AUTHORIZED';
  const active = actor.id === state.activeId;
  const phase = state.phase;
  const options = availableCommands(state);
  switch (command.type) {
    case 'select-action':
      if (phase.kind !== 'action') return 'INVALID_PHASE';
      return !active ? 'NOT_AUTHORIZED' : options.availableActions.includes(command.action) ? null : 'INVALID_COMMAND';
    case 'select-target':
    case 'cancel-target':
      if (phase.kind !== 'target') return 'INVALID_PHASE';
      if (!active) return 'NOT_AUTHORIZED';
      return command.type === 'cancel-target' || options.targets.includes(command.targetId) ? null : 'INVALID_COMMAND';
    case 'accept':
      if (phase.kind !== 'reaction' && phase.kind !== 'block-reaction') return 'INVALID_PHASE';
      return active ? null : 'NOT_AUTHORIZED';
    case 'block':
      if (phase.kind !== 'reaction') return 'INVALID_PHASE';
      return options.blocks.some(block => block.playerId === actor.id && block.character === command.character) ? null : 'NOT_AUTHORIZED';
    case 'challenge':
      if (phase.kind !== 'reaction' && phase.kind !== 'block-reaction') return 'INVALID_PHASE';
      return options.challenges.includes(actor.id) ? null : 'NOT_AUTHORIZED';
    case 'lose':
      if (phase.kind !== 'loss') return 'INVALID_PHASE';
      if (actor.id !== phase.victimId) return 'NOT_AUTHORIZED';
      return actor.cards.some(card => card.id === command.cardId) ? null : 'INVALID_COMMAND';
    case 'negotiate': {
      if (phase.kind !== 'negotiation') return 'INVALID_PHASE';
      if (actor.id !== phase.playerId) return 'NOT_AUTHORIZED';
      const ids = command.keepIds;
      const cards = [...actor.cards, ...state.offer];
      return Array.isArray(ids) && ids.length === phase.keep && new Set(ids).size === ids.length
        && ids.every(id => cards.some(card => card.id === id)) ? null : 'INVALID_COMMAND';
    }
    default: return 'INVALID_COMMAND';
  }
}

export function transition(state: GameState, command: GameCommand, expectedRevision: number, random: Random = Math.random): Transition {
  if (state.revision !== expectedRevision) return { ok: false, error: 'STALE_REVISION' };
  if (!command || typeof command !== 'object') return { ok: false, error: 'INVALID_COMMAND' };
  const error = validate(state, command);
  if (error) return { ok: false, error };
  const next = structuredClone(state);
  const actor = player(next, command.playerId)!;
  const phase = next.phase;
  delete next.lastEvent;
  next.revision++;
  switch (command.type) {
    case 'select-action':
      if (targeted.includes(command.action)) next.phase = { kind: 'target', action: command.action };
      else declare(next, actor, command.action, null);
      break;
    case 'select-target':
      if (phase.kind === 'target') declare(next, actor, phase.action, command.targetId);
      break;
    case 'cancel-target': next.phase = { kind: 'action' }; break;
    case 'accept':
      if (phase.kind === 'reaction') resolveAction(next, phase.declaration);
      if (phase.kind === 'block-reaction') {
        log(next, 'SISTEMA', 'Bloqueio aceito. Ação cancelada.');
        advance(next);
      }
      break;
    case 'block':
      if (phase.kind === 'reaction') {
        next.phase = { kind: 'block-reaction', declaration: phase.declaration,
          block: { playerId: actor.id, character: command.character } };
        log(next, actor.name, `Bloqueou com ${characterNames[command.character]}.`);
      }
      break;
    case 'challenge':
      if (phase.kind === 'reaction' || phase.kind === 'block-reaction') {
        challenge(next, actor, phase.declaration, phase.kind === 'block-reaction' ? phase.block : undefined, random);
      }
      break;
    case 'lose': lose(next, actor, command.cardId, random); break;
    case 'negotiate': {
      const cards = [...actor.cards, ...next.offer];
      const keep = new Set(command.keepIds);
      actor.cards = cards.filter(card => keep.has(card.id));
      for (const card of cards) {
        if (keep.has(card.id)) continue;
        next.deck.push(card);
        shuffle(next.deck, random);
      }
      log(next, actor.name, 'Concluiu a negociação do Broker.');
      advance(next);
      break;
    }
  }
  return { ok: true, state: next };
}
