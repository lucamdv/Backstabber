import { describe, expect, it } from 'vitest';
import { createGame, transition } from '../game/core/engine';
import type { GameCommand } from '../game/application/contracts';

const random = () => 0.999;
const initial = () => createGame(['Ada', 'Bia', 'Caio'], random);
type State = ReturnType<typeof initial>;
const play = (state: State, command: GameCommand) => {
  const result = transition(state, command, state.revision, random);
  if (!result.ok) throw Error(result.error);
  return result.state;
};

describe('motor local', () => {
  it.each([[1, 15], [6, 15], [7, 20], [8, 20], [9, 25], [10, 25]])('distribui o baralho de %i jogadores', (n, total) => {
    const game = createGame(Array.from({ length: n }, (_, i) => 'P' + i), random);
    expect(game.deck.length).toBe(total - n * 2);
    expect(game.players.every(player => player.cards.length === 2 && player.credits === 2)).toBe(true);
    const cards = [...game.deck, ...game.players.flatMap(player => player.cards)];
    for (const character of new Set(cards.map(card => card.character))) {
      expect(cards.filter(card => card.character === character)).toHaveLength(total / 5);
    }
  });

  it('avança após Renda e rejeita replay da revisão anterior', () => {
    const state = initial();
    const command = { type: 'select-action', action: 'income', playerId: 'p1' } as const;
    const next = play(state, command);
    expect(next.players[0].credits).toBe(3);
    expect(next.activeId).toBe('p2');
    expect(state.players[0].credits).toBe(2);
    expect(transition(next, command, state.revision, random).ok).toBe(false);
  });

  it('cobra Executor antes do bloqueio do alvo', () => {
    const state = initial();
    state.players[0].credits = 3;
    let next = play(state, { type: 'select-action', action: 'assassinate', playerId: 'p1' });
    expect(transition(next, { type: 'select-target', playerId: 'p1', targetId: 'p1' }, next.revision, random).ok).toBe(false);
    next = play(next, { type: 'select-target', playerId: 'p1', targetId: 'p2' });
    expect(next.players[0].credits).toBe(0);
    expect(transition(next, { type: 'block', playerId: 'p3', character: 'sentinela' }, next.revision, random).ok).toBe(false);
    next = play(next, { type: 'block', playerId: 'p2', character: 'sentinela' });
    next = play(next, { type: 'accept', playerId: 'p1' });
    expect(next.players[1].cards).toHaveLength(2);
    expect(next.phase.kind).toBe('action');
  });

  it('obriga Backstab a partir de 10 créditos e devolve a influência perdida', () => {
    const state = initial();
    state.players[0].credits = 10;
    expect(transition(state, { type: 'select-action', action: 'income', playerId: 'p1' }, 0, random).ok).toBe(false);
    let next = play(state, { type: 'select-action', action: 'backstab', playerId: 'p1' });
    next = play(next, { type: 'select-target', targetId: 'p2', playerId: 'p1' });
    const card = next.players[1].cards[0];
    expect(next.players[0].credits).toBe(3);
    next = play(next, { type: 'lose', cardId: card.id, playerId: 'p2' });
    expect(next.deck).toContainEqual(card);
    expect(next.cemetery).toEqual([card.character]);
  });

  it('negocia duas compras sem alterar a contagem de influências', () => {
    let state = play(initial(), { type: 'select-action', action: 'negotiate', playerId: 'p1' });
    state = play(state, { type: 'accept', playerId: 'p1' });
    expect(state.phase.kind).toBe('negotiation');
    const keepIds = state.offer.map(card => card.id);
    let draws = 0;
    const result = transition(state, { type: 'negotiate', playerId: 'p1', keepIds }, state.revision, () => {
      draws++;
      return random();
    });
    if (!result.ok) throw Error(result.error);
    const next = result.state;
    expect(draws).toBe(2 * state.deck.length + 1);
    expect(next.players[0].cards.map(card => card.id)).toEqual(expect.arrayContaining(keepIds));
    expect(next.activeId).toBe('p2');
  });

  it('aceita Patrocínio e limita o roubo ao saldo do alvo', () => {
    let state = play(initial(), { type: 'select-action', action: 'patrocinio', playerId: 'p1' });
    state = play(state, { type: 'accept', playerId: 'p1' });
    expect(state.players[0].credits).toBe(4);
    state.players[2].credits = 1;
    state = play(state, { type: 'select-action', action: 'steal', playerId: 'p2' });
    state = play(state, { type: 'select-target', targetId: 'p3', playerId: 'p2' });
    state = play(state, { type: 'accept', playerId: 'p2' });
    expect(state.players[1].credits).toBe(3);
    expect(state.players[2].credits).toBe(0);
  });

  it('troca a carta comprovada antes de a devolver e aplica Taxa após a perda', () => {
    const state = initial();
    const proofIndex = state.deck.findIndex(card => card.character === 'magnata');
    [state.players[0].cards[0], state.deck[proofIndex]] = [state.deck[proofIndex], state.players[0].cards[0]];
    const proof = state.players[0].cards[0];
    const replacement = state.deck.at(-1);
    let next = play(state, { type: 'select-action', action: 'tax', playerId: 'p1' });
    next = play(next, { type: 'challenge', playerId: 'p2' });
    expect(next.phase).toMatchObject({ kind: 'loss', victimId: 'p2', challenge: { truthful: true } });
    expect(next.players[0].cards).toContainEqual(replacement);
    expect(next.deck).toContainEqual(proof);
    next = play(next, { type: 'lose', cardId: next.players[1].cards[0].id, playerId: 'p2' });
    expect(next.players[0].credits).toBe(5);
  });

  it('cancela Taxa quando o blefe é descoberto', () => {
    let state = play(initial(), { type: 'select-action', action: 'tax', playerId: 'p1' });
    state = play(state, { type: 'challenge', playerId: 'p2' });
    expect(state.phase).toMatchObject({ kind: 'loss', victimId: 'p1', challenge: { truthful: false } });
    state = play(state, { type: 'lose', cardId: state.players[0].cards[0].id, playerId: 'p1' });
    expect(state.players[0].credits).toBe(2);
    expect(state.activeId).toBe('p2');
  });

  it.each([true, false])('resolve contestação de bloqueio (verdadeiro=%s)', truthful => {
    const state = initial();
    const index = state.deck.findIndex(card => card.character === 'magnata');
    if (truthful) [state.players[1].cards[0], state.deck[index]] = [state.deck[index], state.players[1].cards[0]];
    let next = play(state, { type: 'select-action', action: 'patrocinio', playerId: 'p1' });
    next = play(next, { type: 'block', character: 'magnata', playerId: 'p2' });
    next = play(next, { type: 'challenge', playerId: 'p1' });
    const victim = truthful ? next.players[0] : next.players[1];
    expect(next.phase).toMatchObject({ kind: 'loss', victimId: victim.id, challenge: { truthful } });
    next = play(next, { type: 'lose', cardId: victim.cards[0].id, playerId: victim.id });
    expect(next.players[0].credits).toBe(truthful ? 2 : 4);
  });

  it('pula eliminados e termina com as influências restantes do vencedor', () => {
    const state = initial();
    state.players[0].credits = 14;
    state.players.slice(1).forEach(player => state.deck.push(player.cards.pop()!));
    const backstab = (game: State, targetId: string) => {
      let next = play(game, { type: 'select-action', action: 'backstab', playerId: 'p1' });
      next = play(next, { type: 'select-target', playerId: 'p1', targetId });
      const target = next.players.find(player => player.id === targetId)!;
      return play(next, { type: 'lose', cardId: target.cards[0].id, playerId: targetId });
    };
    let next = backstab(state, 'p2');
    expect(next.activeId).toBe('p3');
    next = play(next, { type: 'select-action', action: 'income', playerId: 'p3' });
    next = backstab(next, 'p3');
    expect(next.phase).toEqual({ kind: 'finished', winnerId: 'p1', cards: next.players[0].cards });
  });
});
