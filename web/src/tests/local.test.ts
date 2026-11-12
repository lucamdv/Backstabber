import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalGameAdapter } from '../game/adapters/local';
import { loadGame, saveGame, saveKey } from '../game/adapters/persistence';
import type { GameCommand } from '../game/application/contracts';
import { projectGame } from '../game/application/projection';
import { characterNames, createGame } from '../game/core/engine';

const random = () => 0.999;
const initial = () => createGame(['Ada', 'Bia', 'Caio'], random);
beforeEach(() => localStorage.clear());

describe('mesa local', () => {
  it('cria identificadores em navegadores HTTP sem randomUUID', () => {
    const randomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues: randomValues });
    try {
      const adapter = new LocalGameAdapter(initial(), () => {}, random);
      expect(adapter.matchId).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('projeta apenas dados públicos e a mão autorizada', () => {
    const state = initial();
    const owner = projectGame(state, 'p1');
    expect(owner.hand).toEqual(state.players[0].cards);
    expect(owner.players.every(player => !('cards' in player))).toBe(true);
    expect(JSON.stringify(owner)).not.toContain(state.deck[0].id);
    expect(projectGame(state, 'p2').hand).toEqual([]);
    expect(projectGame(state, null).hand).toEqual([]);
  });

  it('esconde mãos no início e na troca, e aceita repetição idempotente', async () => {
    const state = initial();
    const adapter = new LocalGameAdapter(state, value => saveGame(localStorage, value), random);
    const command: GameCommand = { type: 'select-action', playerId: 'p1', action: 'income' };
    const message = { protocolVersion: 1, matchId: adapter.matchId, commandId: 'renda', expectedRevision: 0, command } as const;
    expect(adapter.getSnapshot().hand).toHaveLength(0);
    expect((await adapter.send(message)).ok).toBe(false);
    adapter.reveal();
    expect(adapter.getSnapshot().hand).toEqual(state.players[0].cards);
    expect(await adapter.send(message)).toEqual({ ok: true, revision: 1 });
    expect(await adapter.send(message)).toEqual({ ok: true, revision: 1 });
    expect(await adapter.send({ ...message, command: { ...command, action: 'tax' } }))
      .toEqual({ ok: false, revision: 1, error: 'INVALID_COMMAND' });
    expect(adapter.getSnapshot().hand).toHaveLength(0);
    expect(adapter.getSnapshot().activeId).toBe('p2');
    const restored = loadGame(localStorage).state!;
    expect(restored.revision).toBe(1);
    const recovered = new LocalGameAdapter(restored, () => {}, random);
    expect(recovered.getSnapshot().hand).toHaveLength(0);
    recovered.reveal();
    expect(recovered.getSnapshot().hand).toEqual(state.players[1].cards);
    expect(recovered.getSnapshot().players[0].credits).toBe(3);
  });

  it('recupera uma negociação incompleta sem expor as compras', async () => {
    const adapter = new LocalGameAdapter(initial(), value => saveGame(localStorage, value), random);
    let id = 0;
    const send = (command: GameCommand) => adapter.send({
      protocolVersion: 1, matchId: adapter.matchId, commandId: String(++id),
      expectedRevision: adapter.getSnapshot().revision, command,
    });
    adapter.reveal();
    await send({ type: 'select-action', action: 'negotiate', playerId: 'p1' });
    await send({ type: 'accept', playerId: 'p1' });
    const recovered = new LocalGameAdapter(loadGame(localStorage).state!, () => {}, random);
    expect(recovered.getSnapshot().phase.kind).toBe('negotiation');
    expect(recovered.getSnapshot().choices).toHaveLength(0);
    recovered.reveal();
    expect(recovered.getSnapshot().choices).toHaveLength(4);
  });

  it('importa estado estável v3 sem escrever nas chaves originais', () => {
    const state = initial();
    const cards = (source: typeof state.deck) => source.map(card => ({ personagem: characterNames[card.character] }));
    const raw = JSON.stringify({
      baralho: { totalCartas: 15, cartas: cards(state.deck) },
      jogadores: state.players.map(player => ({ nome: player.name, moedas: player.credits, cartas: cards(player.cards) })),
      turnoAtual: 1, acaoPendente: null,
    });
    localStorage.setItem('backstabber_jogo_v3', raw);
    expect(loadGame(localStorage).state?.activeId).toBe('p2');
    expect(localStorage.getItem('backstabber_jogo_v3')).toBe(raw);
    expect(localStorage.getItem(saveKey)).toBeNull();
  });

  it('informa erro de leitura e preserva o conteúdo incompatível', () => {
    localStorage.setItem(saveKey, '{');
    expect(loadGame(localStorage)).toEqual({ notice: 'Não foi possível ler o salvamento local.' });
    expect(localStorage.getItem(saveKey)).toBe('{');
  });

  it('preserva a criação interna e a recuperação de salvamentos solo das duas versões', () => {
    const solo = createGame(['Solo'], random);
    const [player] = solo.players;
    const legacyKey = 'backstabber_jogo_v3';
    const legacy = JSON.stringify({
      jogadores: [{
        nome: player.name,
        moedas: player.credits,
        cartas: player.cards.map(card => ({ personagem: characterNames[card.character] })),
      }],
      baralho: { cartas: solo.deck.map(card => ({ personagem: characterNames[card.character] })) },
      turnoAtual: 0,
    });
    localStorage.setItem(legacyKey, legacy);
    const migrated = loadGame(localStorage).state;
    expect(migrated?.players.map(saved => saved.name)).toEqual(['Solo']);
    expect(migrated?.players[0].cards.map(card => card.character)).toEqual(player.cards.map(card => card.character));
    expect(migrated?.deck).toHaveLength(13);

    saveGame(localStorage, solo);
    expect(loadGame(localStorage)).toEqual({ state: solo });
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
  });

  it('não oferece uma vitória encerrada nem reimporta uma partida antiga após a vitória', () => {
    const state = initial();
    const winner = state.players[0];
    for (const opponent of state.players.slice(1)) state.deck.push(...opponent.cards.splice(0));
    state.phase = { kind: 'finished', winnerId: winner.id, cards: winner.cards };
    localStorage.setItem('backstabber_jogo_v3', '{');
    saveGame(localStorage, state);
    expect(loadGame(localStorage)).toEqual({});
    expect(localStorage.getItem('backstabber_jogo_v3')).toBe('{');
  });
});
