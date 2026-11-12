// @vitest-environment jsdom
import { useSyncExternalStore } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalGameAdapter } from '../game/adapters/local';
import { loadGame, saveGame, saveKey } from '../game/adapters/persistence';
import type { GameCommand } from '../game/application/contracts';
import { createGame } from '../game/core/engine';
import GamePage from '../pages/GamePage';

// Leave the deck in its original order so the expected cards are reproducible.
const random = () => 0.999;
const initial = () => createGame(['Ada', 'Bia', 'Caio'], random);

beforeEach(() => {
  localStorage.removeItem(saveKey);
});

function mountMesa(state = initial()) {
  const adapter = new LocalGameAdapter(state, next => saveGame(localStorage, next), random);
  const commands: GameCommand[] = [];
  const send = (command: GameCommand) => {
    commands.push(command);
    void adapter.send({
      protocolVersion: 1, matchId: adapter.matchId, commandId: String(commands.length),
      expectedRevision: adapter.getSnapshot().revision, command,
    });
  };
  const onRematch = vi.fn();
  const onExit = vi.fn();
  function Mesa() {
    const view = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
    return <GamePage showIntro={false} view={view} send={send}
      onReveal={() => adapter.reveal()} onConceal={() => adapter.conceal()}
      onRematch={onRematch} onExit={onExit} />;
  }
  const rendered = render(<Mesa />);
  return { ...rendered, adapter, commands, onRematch, onExit };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));
const reveal = () => click(/acessar terminal/i);
const accept = () => click(/ninguém se opõe/i);
const lost = () => screen.queryAllByRole('button', { name: /^perder /i });

describe('Paridade de comandos e privacidade da apresentação local', () => {
  it('preserva alvos elegíveis, cancelamento por Escape, aceitação e passagem após Renda', () => {
    const state = initial();
    state.deck.push(...state.players[2].cards.splice(0));
    const mesa = mountMesa(state);
    expect(screen.queryByRole('img', { name: 'Broker' })).toBeNull();
    reveal();
    expect(mesa.adapter.getSnapshot().hand).toEqual(state.players[0].cards);

    click(/^extorquir\b/i);
    expect(screen.queryByRole('button', { name: /alvo: caio/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /alvo: ada/i })).toBeNull();
    fireEvent.keyDown(button(/cancelar operação/i), { key: 'Escape' });
    expect(mesa.adapter.getSnapshot()).toMatchObject({ phase: { kind: 'action' }, revealed: true, activeId: 'p1' });
    click(/^extorquir\b/i);
    click(/alvo: bia/i);
    expect(mesa.adapter.getSnapshot().hand).toEqual([]);
    accept();

    expect(loadGame(localStorage).state).toMatchObject({ revision: 5, activeId: 'p2', players: [{ credits: 4 }, { credits: 0 }, { credits: 2 }] });
    reveal();
    click(/^renda\b/i);
    expect(mesa.adapter.getSnapshot()).toMatchObject({ revision: 6, activeId: 'p1', hand: [] });
    expect(screen.queryByRole('button', { name: /acessar terminal/i })).toBeNull();
    click(/^continuar$/i);
    expect(button(/acessar terminal/i)).toBeVisible();
    expect(mesa.commands).toEqual([
      { type: 'select-action', playerId: 'p1', action: 'steal' },
      { type: 'cancel-target', playerId: 'p1' },
      { type: 'select-action', playerId: 'p1', action: 'steal' },
      { type: 'select-target', playerId: 'p1', targetId: 'p2' },
      { type: 'accept', playerId: 'p1' },
      { type: 'select-action', playerId: 'p2', action: 'income' },
    ]);
  });

  it('mantém o bloqueio e a aceitação únicos, atribuídos aos participantes originais', () => {
    const mesa = mountMesa();
    reveal();
    click(/^patrocínio\b/i);
    expect(screen.queryAllByRole('button', { name: /contestar!/i })).toHaveLength(0);
    click(/caio - bloquear \(magnata\)/i);
    expect(button(/ada - contestar/i)).toBeVisible();
    expect(button(/bia - contestar/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /caio - contestar/i })).toBeNull();
    accept();
    expect(mesa.commands).toEqual([
      { type: 'select-action', playerId: 'p1', action: 'patrocinio' },
      { type: 'block', playerId: 'p3', character: 'magnata' },
      { type: 'accept', playerId: 'p1' },
    ]);
    expect(loadGame(localStorage).state).toMatchObject({ revision: 3, activeId: 'p2', players: [{ credits: 2 }, { credits: 2 }, { credits: 2 }] });
    expect(mesa.adapter.getSnapshot().hand).toEqual([]);
    expect(button(/acessar terminal/i)).toBeVisible();
  });

  it.each([
    { truthful: true, victim: 'p2', credits: 5, title: /carta confirmada/i },
    { truthful: false, victim: 'p1', credits: 2, title: /blefe descoberto/i },
  ])('mantém aplicação manual e perda protegida da contestação verdadeira=$truthful', ({ truthful, victim, credits, title }) => {
    vi.useFakeTimers();
    try {
      const state = initial();
      const proofIndex = state.deck.findIndex(card => card.id === 'magnata-2');
      if (truthful) {
        const [proof] = state.deck.splice(proofIndex, 1);
        const [returned] = state.players[0].cards.splice(0, 1, proof);
        state.deck.unshift(returned);
      }
      const mesa = mountMesa(state);
      reveal();
      click(/^taxar\b/i);
      click(/bia - contestar/i);
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
      expect(screen.queryByRole('button', { name: /virar minhas cartas/i })).toBeNull();
      expect(mesa.adapter.getSnapshot()).toMatchObject({
        revision: 2, phase: { kind: 'loss', victimId: victim, challenge: { truthful } }, choices: [], hand: [],
      });
      const challenged = loadGame(localStorage).state!;
      expect(challenged.deck.map(card => card.id)).toContain('magnata-2');
      if (truthful) expect(challenged.players[0].cards).toContainEqual(state.deck.at(-1));
      click(/aplicar resultado/i);
      if (!truthful) act(() => vi.advanceTimersByTime(450));
      expect(mesa.commands).toHaveLength(2);
      expect(mesa.adapter.getSnapshot().revision).toBe(2);
      expect(lost()).toHaveLength(0);
      expect(screen.queryByRole('img', { name: 'Broker' })).toBeNull();
      click(/virar minhas cartas/i);
      const choice = mesa.adapter.getSnapshot().choices[0];
      expect(lost()).toHaveLength(2);
      fireEvent.click(lost()[0]);
      expect(mesa.commands).toEqual([
        { type: 'select-action', playerId: 'p1', action: 'tax' },
        { type: 'challenge', playerId: 'p2' },
        { type: 'lose', playerId: victim, cardId: choice.id },
      ]);
      const saved = loadGame(localStorage).state;
      expect(saved?.players[0].credits).toBe(credits);
      expect(saved?.players.find(player => player.id === victim)?.cards).toHaveLength(1);
      expect(saved?.cemetery).toEqual([choice.character]);
      expect(saved?.deck).toContainEqual(choice);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retoma a negociação salva sem expor a oferta e envia somente as escolhas confirmadas', () => {
    const mesa = mountMesa();
    reveal();
    click(/^negociar\b/i);
    accept();
    expect(mesa.commands).toEqual([
      { type: 'select-action', playerId: 'p1', action: 'negotiate' },
      { type: 'accept', playerId: 'p1' },
    ]);
    const saved = loadGame(localStorage).state!;
    expect(saved.phase).toMatchObject({ kind: 'negotiation', playerId: 'p1', keep: 2 });
    expect(saved.offer).toHaveLength(2);
    mesa.unmount();

    const recovered = mountMesa(saved);
    expect(recovered.adapter.getSnapshot().choices).toEqual([]);
    expect(screen.queryAllByRole('button', { name: /^manter /i })).toHaveLength(0);
    expect(screen.queryByRole('img', { name: 'Mercenário' })).toBeNull();
    reveal();
    const choices = recovered.adapter.getSnapshot().choices;
    expect(choices).toEqual([...saved.players[0].cards, ...saved.offer]);
    const confirm = button(/confirmar negociação/i);
    const cards = screen.getAllByRole('button', { name: /^manter /i });
    expect(confirm).toBeDisabled();
    fireEvent.click(cards[3]);
    fireEvent.click(cards[1]);
    fireEvent.click(cards[2]);
    expect(cards[2]).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(cards[1]);
    expect(confirm).toBeDisabled();
    fireEvent.click(cards[0]);
    fireEvent.click(confirm);

    expect(recovered.commands).toEqual([{ type: 'negotiate', playerId: 'p1', keepIds: [choices[3].id, choices[0].id] }]);
    const completed = loadGame(localStorage).state!;
    expect(completed.players[0].cards).toEqual([choices[0], choices[3]]);
    expect(completed.offer).toEqual([]);
    expect(completed.activeId).toBe('p2');
    expect(recovered.adapter.getSnapshot().hand).toEqual([]);
    expect(button(/acessar terminal/i)).toBeVisible();
  });

  it('conserva a ordem Backstab, perda, eliminação e vitória no adaptador real', () => {
    vi.useFakeTimers();
    try {
      const state = createGame(['Ada', 'Bia'], random);
      state.players[0].credits = 7;
      state.deck.push(state.players[1].cards.pop()!);
      const mesa = mountMesa(state);
      reveal();
      click(/^backstab\b/i);
      click(/alvo: bia/i);
      expect(mesa.adapter.getSnapshot()).toMatchObject({
        phase: { kind: 'loss', reason: 'backstab', victimId: 'p2' }, players: [{ credits: 0 }, { influence: 1 }],
      });
      expect(screen.queryByRole('button', { name: /virar minhas cartas/i })).toBeNull();
      act(() => vi.advanceTimersByTime(2500));
      click(/virar minhas cartas/i);
      const influence = mesa.adapter.getSnapshot().choices[0];
      fireEvent.click(lost()[0]);
      expect(mesa.adapter.getSnapshot()).toMatchObject({
        phase: { kind: 'finished', winnerId: 'p1' }, lastEvent: { kind: 'eliminated', playerId: 'p2' },
      });
      expect(screen.queryByRole('button', { name: /jogar novamente/i })).toBeNull();
      act(() => vi.advanceTimersByTime(1750));
      click(/jogar novamente/i);
      expect(mesa.onRematch).toHaveBeenCalledTimes(1);
      expect(mesa.commands).toEqual([
        { type: 'select-action', playerId: 'p1', action: 'backstab' },
        { type: 'select-target', playerId: 'p1', targetId: 'p2' },
        { type: 'lose', playerId: 'p2', cardId: influence.id },
      ]);
      expect(loadGame(localStorage).state).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
