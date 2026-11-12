import { availableCommands, createGame, transition } from '../src/game/core/engine';
import type { GameState } from '../src/game/core/engine';
import type { GameCommand } from '../src/game/application/contracts';
import type { OnlineCommand, OnlineView, OnlineWindow, VoteChoice } from '../src/game/application/online-contracts';

export type Participant = { id: string; name: string };
type Vote = { playerId: string; choice: VoteChoice; sequence: number };
type WindowState = Omit<OnlineWindow, 'options' | 'responded'> & {
  votes: Vote[];
  priority?: Vote;
  nextActiveId?: string;
};
export type OnlineState = { game: GameState; round: number; window: WindowState | null; audit: WindowState[] };
type Random = () => number;
type Result = { ok: true; state: OnlineState } | { ok: false; error: string };

export function createOnlineGame(players: Participant[], random?: Random): OnlineState {
  if (players.length < 2 || new Set(players.map(player => player.id)).size !== players.length) {
    throw Error('Invalid roster');
  }
  const game = createGame(players.map(player => player.name), random);
  game.players.forEach((player, index) => { player.id = players[index].id; });
  game.activeId = game.players[0].id;
  return { game, round: 1, window: null, audit: [] };
}

function choicesFor(state: OnlineState, playerId: string): VoteChoice[] {
  const window = state.window;
  if (!window || !window.eligible.includes(playerId) || window.votes.some(vote => vote.playerId === playerId)) return [];
  if (window.kind === 'acknowledge') return [{ kind: 'acknowledge' }];
  const options = availableCommands(state.game);
  const choices: VoteChoice[] = [{ kind: 'accept' }];
  if (options.challenges.includes(playerId)) choices.push({ kind: 'challenge' });
  for (const block of options.blocks) {
    if (block.playerId === playerId) choices.push({ kind: 'block', character: block.character });
  }
  return choices;
}

function openWindow(state: OnlineState, kind: OnlineWindow['kind'], summary: string) {
  const phase = state.game.phase;
  const eligible = state.game.players.filter(player => player.cards.length > 0
    && (kind === 'acknowledge' || player.id !== (phase.kind === 'block-reaction' ? phase.block.playerId : state.game.activeId)))
    .map(player => player.id);
  if (eligible.length) {
    state.window = { id: `${state.round}:${state.audit.length + 1}`, kind, eligible, votes: [], summary };
  }
}

function applyCore(state: OnlineState, command: GameCommand, random: Random): string | undefined {
  const result = transition(state.game, command, state.game.revision, random);
  if (!result.ok) return result.error;
  state.game = result.state;
}

function afterCore(state: OnlineState, command: GameCommand, previousActiveId: string) {
  const { phase, lastEvent, history } = state.game;
  if (phase.kind === 'reaction' || phase.kind === 'block-reaction') {
    openWindow(state, phase.kind, phase.kind === 'reaction' ? 'Reaja à declaração' : 'Reaja ao bloqueio');
  } else if (phase.kind === 'loss' && (phase.challenge || lastEvent?.kind === 'backstab')) {
    const summary = phase.challenge
      ? phase.challenge.truthful ? 'Carta comprovada. O contestador perde influência.' : 'Blefe descoberto. O declarante perde influência.'
      : 'Backstab declarado. A vítima perderá uma influência.';
    openWindow(state, 'acknowledge', summary);
  } else if (command.type === 'lose' || command.type === 'negotiate' || phase.kind === 'action') {
    const record = history[0];
    openWindow(state, 'acknowledge', record ? `${record.player} · ${record.text}` : 'Resultado da jogada');
    if (state.window && state.game.activeId !== previousActiveId) {
      state.window.nextActiveId = state.game.activeId;
      state.game.activeId = previousActiveId;
    }
  }
}

function closeWindow(state: OnlineState, random: Random) {
  const window = state.window!;
  const priority = window.votes.find(vote => vote.choice.kind === 'challenge')
    ?? window.votes.find(vote => vote.choice.kind === 'block');
  state.audit.push({ ...window, priority });
  state.window = null;
  if (window.kind === 'acknowledge') {
    if (window.nextActiveId) state.game.activeId = window.nextActiveId;
    return;
  }
  const command: GameCommand = priority?.choice.kind === 'block'
    ? { type: 'block', playerId: priority.playerId, character: priority.choice.character }
    : priority ? { type: 'challenge', playerId: priority.playerId }
      : { type: 'accept', playerId: state.game.activeId };
  const previousActiveId = state.game.activeId;
  const error = applyCore(state, command, random);
  if (error) throw Error(`Window resolution invariant: ${error}`);
  afterCore(state, command, previousActiveId);
}

export function onlineTransition(
  state: OnlineState, playerId: string, command: OnlineCommand, expectedRevision: number, random: Random = Math.random,
): Result {
  if (expectedRevision !== state.game.revision) return { ok: false, error: 'STALE_REVISION' };
  if (!state.game.players.some(player => player.id === playerId && player.cards.length > 0)) {
    return { ok: false, error: 'NOT_AUTHORIZED' };
  }
  const next = structuredClone(state);
  if (command.type === 'vote') {
    const window = next.window;
    if (!window || window.id !== command.windowId) return { ok: false, error: 'INVALID_PHASE' };
    if (window.votes.some(vote => vote.playerId === playerId)) return { ok: false, error: 'ALREADY_RESPONDED' };
    const choice = choicesFor(next, playerId).find(option => option.kind === command.choice.kind
      && (option.kind !== 'block' || (command.choice.kind === 'block' && option.character === command.choice.character)));
    if (!choice) return { ok: false, error: 'NOT_AUTHORIZED' };
    window.votes.push({ playerId, choice, sequence: window.votes.length + 1 });
    if (window.votes.length === window.eligible.length) closeWindow(next, random);
  } else {
    if (next.window) return { ok: false, error: 'INVALID_PHASE' };
    const core = { ...command, playerId };
    const error = applyCore(next, core, random);
    if (error) return { ok: false, error };
    if (core.type === 'select-action' && next.game.phase.kind === 'target') {
      if (!core.targetId) return { ok: false, error: 'INVALID_COMMAND' };
      const select: GameCommand = { type: 'select-target', targetId: core.targetId, playerId };
      const error = applyCore(next, select, random);
      if (error) return { ok: false, error };
      afterCore(next, select, state.game.activeId);
    } else {
      if (core.type === 'select-action' && core.targetId !== undefined) return { ok: false, error: 'INVALID_COMMAND' };
      afterCore(next, core, state.game.activeId);
    }
  }
  next.game.revision = state.game.revision + 1;
  return { ok: true, state: next };
}

export function onlineView(state: OnlineState, viewerId: string, hostId: string, closed: boolean, hostAbandoned = false): OnlineView {
  const { game, window } = state;
  const viewer = game.players.find(player => player.id === viewerId);
  if (!viewer) throw Error('Viewer is not a participant');
  const phase = game.phase.kind === 'finished' && game.phase.winnerId !== viewerId
    ? { ...game.phase, cards: [] } : game.phase;
  const options = availableCommands(game);
  const hand = viewer.cards;
  const active = !closed && !window && game.activeId === viewerId;
  const mayChoose = !closed && !window;
  return structuredClone({
    revision: game.revision, round: state.round, activeId: game.activeId, viewerId,
    closed, canClose: !closed && (hostId === viewerId || hostAbandoned),
    canRematch: !closed && !window && phase.kind === 'finished' && hostId === viewerId,
    phase, history: game.history, cemetery: game.cemetery, deckCount: game.deck.length,
    lastEvent: game.lastEvent,
    players: game.players.map(({ id, name, credits, cards }) => ({ id, name, credits, influence: cards.length })),
    hand, revealed: true, privatePlayerId: viewerId,
    choices: mayChoose && phase.kind === 'loss' && phase.victimId === viewerId ? hand
      : mayChoose && phase.kind === 'negotiation' && phase.playerId === viewerId ? [...hand, ...game.offer] : [],
    availableActions: active ? options.availableActions : [],
    targets: active ? game.players.filter(player => player.id !== viewerId && player.cards.length > 0).map(player => player.id) : [],
    blocks: [], challenges: [],
    window: window ? {
      id: window.id, kind: window.kind, eligible: window.eligible, summary: window.summary,
      responded: window.votes.map(vote => vote.playerId),
      options: closed ? [] : choicesFor(state, viewerId),
    } : undefined,
  });
}
