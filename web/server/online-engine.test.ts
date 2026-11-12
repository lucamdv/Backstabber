// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { OnlineCommand, VoteChoice } from '../src/game/application/online-contracts';
import { createOnlineGame, onlineTransition, onlineView } from './online-engine';
import type { OnlineState } from './online-engine';

const random = () => 0.999;
const roster = ['Ada', 'Bia', 'Caio', 'Dani'].map((name, index) => ({ id: String(index), name }));
const start = (size = 4) => createOnlineGame(roster.slice(0, size), random);
function send(state: OnlineState, actor: string, command: OnlineCommand) {
  const result = onlineTransition(state, actor, command, state.game.revision, random);
  if (!result.ok) throw Error(result.error);
  return result.state;
}
const vote = (state: OnlineState, actor: string, choice: VoteChoice) =>
  send(state, actor, { type: 'vote', windowId: state.window!.id, choice });
function acknowledge(state: OnlineState) {
  if (state.window?.kind !== 'acknowledge') throw Error('Expected acknowledgement');
  return state.window.eligible.reduce((next, actor) => vote(next, actor, { kind: 'acknowledge' }), state);
}

describe('motor autoritativo online', () => {
  it('espera o último jogador, oculta escolhas e usa a primeira contestação', () => {
    let state = send(start(), '0', { type: 'select-action', action: 'tax' });
    const initialRevision = state.game.revision;
    state = vote(state, '2', { kind: 'challenge' });
    expect(onlineView(state, '3', '0', false).window).toMatchObject({ responded: ['2'] });
    expect(JSON.stringify(onlineView(state, '3', '0', false))).not.toContain('"votes"');
    expect(onlineTransition(state, '3', { type: 'vote', windowId: state.window!.id, choice: { kind: 'accept' } },
      initialRevision, random)).toEqual({ ok: false, error: 'STALE_REVISION' });
    expect(onlineTransition(state, '2', { type: 'vote', windowId: state.window!.id, choice: { kind: 'accept' } },
      state.game.revision, random)).toEqual({ ok: false, error: 'ALREADY_RESPONDED' });
    state = vote(state, '1', { kind: 'challenge' });
    expect(state.game.phase.kind).toBe('reaction');
    state = vote(state, '3', { kind: 'accept' });
    expect(state.audit[0].priority).toMatchObject({ playerId: '2', sequence: 1 });
    expect(state.game.phase.kind).toBe('loss');
  });

  it('prioriza contestação sobre bloqueio anterior e não revela oferta de terceiros', () => {
    const game = start(3);
    game.game.players[0].credits = 3;
    let state = send(game, '0', { type: 'select-action', action: 'assassinate', targetId: '1' });
    expect(state.game.players[0].credits).toBe(0);
    state = vote(state, '1', { kind: 'block', character: 'sentinela' });
    expect(state.window?.kind).toBe('reaction');
    state = vote(state, '2', { kind: 'challenge' });
    expect(state.audit[0].priority?.playerId).toBe('2');
    expect(state.game.phase.kind).toBe('loss');
    const view = onlineView(state, '1', '0', false);
    expect(view.hand).toEqual(state.game.players[1].cards);
    expect(view.choices).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(state.game.deck[0].id);
  });

  it('abre votação de bloqueio e exige resposta de todos menos o bloqueador', () => {
    const game = start();
    game.game.players[0].credits = 3;
    let state = send(game, '0', { type: 'select-action', action: 'assassinate', targetId: '1' });
    state = vote(state, '1', { kind: 'block', character: 'sentinela' });
    state = vote(state, '2', { kind: 'accept' });
    state = vote(state, '3', { kind: 'accept' });
    expect(state.window).toMatchObject({ kind: 'block-reaction', eligible: ['0', '2', '3'] });
    state = vote(state, '0', { kind: 'accept' });
    state = vote(state, '2', { kind: 'accept' });
    expect(state.window?.kind).toBe('block-reaction');
    state = vote(state, '3', { kind: 'accept' });
    expect(state.window?.kind).toBe('acknowledge');
    state = acknowledge(state);
    expect(state.game.activeId).toBe('1');
    expect(state.game.players[1].cards).toHaveLength(2);
  });

  it('mantém mãos privadas em qualquer turno e oferece cartas temporárias só ao Broker', () => {
    let state = send(start(3), '0', { type: 'select-action', action: 'negotiate' });
    state = vote(state, '1', { kind: 'accept' });
    state = vote(state, '2', { kind: 'accept' });
    expect(state.game.phase.kind).toBe('negotiation');
    const broker = onlineView(state, '0', '0', false);
    const opponent = onlineView(state, '1', '0', false);
    expect(broker.choices).toHaveLength(4);
    expect(opponent.hand).toHaveLength(2);
    expect(opponent.choices).toEqual([]);
    for (const card of broker.choices) expect(JSON.stringify(opponent)).not.toContain(card.id);
    const command = { type: 'negotiate', keepIds: broker.choices.slice(2).map(card => card.id) } as const;
    expect(onlineTransition(state, '1', command, state.game.revision, random))
      .toEqual({ ok: false, error: 'NOT_AUTHORIZED' });
    state = send(state, '0', command);
    expect(state.game.players[0].cards).toEqual(broker.choices.slice(2));
    expect(state.window?.kind).toBe('acknowledge');
  });

  it('exige ciência antes de passar turno após Renda', () => {
    let state = send(start(3), '0', { type: 'select-action', action: 'income' });
    expect(state.game.activeId).toBe('0');
    state = vote(state, '0', { kind: 'acknowledge' });
    state = vote(state, '1', { kind: 'acknowledge' });
    expect(state.game.activeId).toBe('0');
    expect(onlineView(state, '2', '0', false).availableActions).toEqual([]);
    state = vote(state, '2', { kind: 'acknowledge' });
    expect(state.game.activeId).toBe('1');
  });

  it('aguarda Backstab, limita perda à vítima e exclui eliminados da ciência', () => {
    const initial = start(2);
    initial.game.players[0].credits = 7;
    initial.game.deck.push(initial.game.players[1].cards.pop()!);
    let state = send(initial, '0', { type: 'select-action', action: 'backstab', targetId: '1' });
    expect(onlineView(state, '1', '0', false).choices).toEqual([]);
    state = acknowledge(state);
    const cardId = onlineView(state, '1', '0', false).choices[0].id;
    expect(onlineTransition(state, '0', { type: 'lose', cardId }, state.game.revision, random).ok).toBe(false);
    state = send(state, '1', { type: 'lose', cardId });
    expect(state.window?.eligible).toEqual(['0']);
    state = acknowledge(state);
    expect(onlineView(state, '0', '0', false).canRematch).toBe(true);
    expect(onlineView(state, '1', '0', false).phase).toMatchObject({ kind: 'finished', cards: [] });
  });
});
