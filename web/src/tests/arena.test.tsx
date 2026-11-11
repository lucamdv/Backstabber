// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GamePage from '../pages/GamePage';
import type { GameView } from '../game/application/contracts';

const magnata = { id: 'a', character: 'magnata' } as const;
const executor = { id: 'b', character: 'executor' } as const;
const sentinela = { id: 'c', character: 'sentinela' } as const;
const broker = { id: 'd', character: 'broker' } as const;
const players = [
  { id: 'ana', name: 'Ana', credits: 2, influence: 2 },
  { id: 'bia', name: 'Bia', credits: 2, influence: 2 },
];

function arena(overrides: Partial<GameView> = {}) {
  const view: GameView = {
    revision: 1, activeId: 'ana', players, deckCount: 11, history: [], cemetery: [],
    phase: { kind: 'action' }, hand: [], choices: [], privatePlayerId: 'ana',
    revealed: false, availableActions: ['income', 'tax'], targets: [],
    challenges: [], blocks: [], ...overrides,
  };
  const callbacks = {
    send: vi.fn(), onReveal: vi.fn(), onConceal: vi.fn(), onExit: vi.fn(), onRematch: vi.fn(),
  };
  const rendered = render(<GamePage showIntro={false} view={view} {...callbacks} />);
  return {
    ...callbacks,
    update: (next: Partial<GameView>) => rendered.rerender(<GamePage showIntro={false} view={{ ...view, ...next }} {...callbacks} />),
  };
}

describe('Arena React', () => {
  it('protege a mão até o jogador assumir o terminal e habilita apenas as ações disponíveis', () => {
    const { onReveal, update } = arena({ hand: [magnata, executor] });
    expect(screen.queryByRole('img', { name: 'Magnata' })).toBeNull();
    expect(screen.getByText('11 RESTANTES')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ACESSAR TERMINAL' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    update({ revealed: true });
    expect(screen.getByRole('img', { name: 'Magnata' })).toBeTruthy();
    expect(screen.getByText('Ana', { selector: '#scoreboard strong' })).toBeTruthy();
    expect((screen.getByRole('button', { name: /RENDA/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /^BACKSTAB/ }) as HTMLButtonElement).disabled).toBe(true);
    update({ revision: 2, activeId: 'bia', privatePlayerId: 'bia', revealed: false });
    expect(screen.queryByRole('img', { name: 'Magnata' })).toBeNull();
    expect(screen.getByRole('heading', { name: /Passe o dispositivo para Bia/ })).toBeTruthy();
  });

  it('envia a escolha de alvo, preserva o cancelamento e mostra apenas os alvos elegíveis', () => {
    const { send } = arena({ revealed: true, phase: { kind: 'target', action: 'steal' }, targets: ['bia'] });
    const modal = screen.getByRole('dialog', { name: /Alvo para/ });
    expect(within(modal).queryByRole('button', { name: 'Alvo: Ana' })).toBeNull();
    fireEvent.click(within(modal).getByRole('button', { name: 'Alvo: Bia' }));
    expect(send).toHaveBeenCalledWith({ type: 'select-target', playerId: 'ana', targetId: 'bia' });
    fireEvent.click(within(modal).getByRole('button', { name: /Cancelar/ }));
    expect(send).toHaveBeenLastCalledWith({ type: 'cancel-target', playerId: 'ana' });
  });

  it('exige proteção da mão ao retomar uma escolha de alvo salva', () => {
    const { update, onReveal } = arena({ phase: { kind: 'target', action: 'steal' }, targets: ['bia'] });
    expect(screen.queryByRole('button', { name: 'Alvo: Bia' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Passe o dispositivo para Ana' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ACESSAR TERMINAL' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    update({ revealed: true });
    expect(screen.getByRole('button', { name: 'Alvo: Bia' })).toBeTruthy();
  });

  it('identifica o declarante e envia a reação em nome do participante elegível', () => {
    const { send } = arena({
      phase: { kind: 'reaction', declaration: { action: 'assassinate', playerId: 'ana', targetId: 'bia' } },
      challenges: ['bia'], blocks: [{ playerId: 'bia', character: 'sentinela' }],
    });
    const modal = screen.getByRole('dialog', { name: 'Momento de Reação!' });
    expect(within(modal).getByRole('img', { name: 'Executor' })).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: /Bia - Bloquear/ }));
    expect(send).toHaveBeenCalledWith({ type: 'block', playerId: 'bia', character: 'sentinela' });
    fireEvent.click(within(modal).getByRole('button', { name: /Bia - Contestar/ }));
    expect(send).toHaveBeenLastCalledWith({ type: 'challenge', playerId: 'bia' });
  });

  it('mostra os versos até a vítima revelar suas influências e envia o id escolhido', () => {
    const { onReveal, send, update } = arena({
      phase: { kind: 'loss', victimId: 'bia', reason: 'execution' },
      privatePlayerId: 'bia', choices: [sentinela, broker],
    });
    const modal = screen.getByRole('dialog', { name: 'Bia, proteja sua mão' });
    expect(within(modal).queryByRole('button', { name: 'Perder Broker' })).toBeNull();
    expect(within(modal).getAllByRole('img', { name: 'Influência virada para baixo' })).toHaveLength(2);
    fireEvent.click(within(modal).getByRole('button', { name: 'VIRAR MINHAS CARTAS' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    update({ revealed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Perder Broker' }));
    expect(send).toHaveBeenCalledWith({ type: 'lose', playerId: 'bia', cardId: 'd' });
  });

  it('habilita a negociação somente com a quantidade correta e envia as cartas mantidas', () => {
    const { send } = arena({
      phase: { kind: 'negotiation', playerId: 'ana', keep: 2 },
      revealed: true, choices: [magnata, executor, sentinela, broker],
    });
    const confirm = screen.getByRole('button', { name: 'Confirmar Negociação' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Manter Broker' }));
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Manter Executor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manter Magnata' }));
    expect(screen.getByRole('button', { name: 'Manter Magnata' }).getAttribute('aria-pressed')).toBe('false');
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(send).toHaveBeenCalledWith({ type: 'negotiate', playerId: 'ana', keepIds: ['d', 'b'] });
  });

  it('mostra somente as influências finais do vencedor e oferece revanche e saída', () => {
    const { onExit, onRematch } = arena({ phase: { kind: 'finished', winnerId: 'ana', cards: [magnata] } });
    const modal = screen.getByRole('dialog', { name: 'VITÓRIA' });
    expect(within(modal).getByText('Ana')).toBeTruthy();
    expect(within(modal).getByRole('img', { name: 'Magnata' })).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Jogar novamente' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Voltar ao menu principal' }));
    expect(onRematch).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('exibe e fecha a pausa e o Oráculo sem deixar a mão exposta atrás dos modais', () => {
    const { onExit, onConceal } = arena({ revealed: true, hand: [magnata, executor] });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Oráculo' }));
    expect(screen.getByRole('dialog', { name: 'ORÁCULO' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Magnata' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Oráculo' }));
    expect(screen.getByRole('img', { name: 'Magnata' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu de pausa' }));
    expect(screen.getByRole('dialog', { name: 'PAUSA' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Retomar partida' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'PAUSA' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu de pausa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sair para o menu principal' }));
    expect(onConceal).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('mostra o resultado da contestação antes de abrir a perda protegida', () => {
    const { update } = arena({
      phase: { kind: 'loss', victimId: 'bia', reason: 'challenge', challenge: {
        truthful: true, challengerId: 'bia', declarerId: 'ana', character: 'magnata',
        declaration: { action: 'tax', playerId: 'ana', targetId: null },
      } },
      privatePlayerId: 'bia',
    });
    const modal = screen.getByRole('dialog', { name: 'Carta confirmada!' });
    expect(within(modal).getByRole('img', { name: 'Magnata' }).closest('.is-truth')).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Aplicar resultado' }));
    expect(screen.getByRole('dialog', { name: 'Bia, proteja sua mão' })).toBeTruthy();
    update({ revealed: true, choices: [sentinela, broker] });
    expect(screen.getByRole('button', { name: 'Perder Broker' })).toBeTruthy();
  });

  it('mantém o impacto do Backstab antes da perda e a derrota antes da vitória', () => {
    vi.useFakeTimers();
    try {
      const { update } = arena({
        phase: { kind: 'loss', victimId: 'bia', reason: 'backstab' },
        lastEvent: { kind: 'backstab', playerId: 'ana', targetId: 'bia' },
      });
      expect(screen.getByText('Ana rompeu a defesa de Bia')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'VIRAR MINHAS CARTAS' })).toBeNull();
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.getByRole('button', { name: 'VIRAR MINHAS CARTAS' })).toBeTruthy();

      update({
        revision: 2,
        phase: { kind: 'finished', winnerId: 'ana', cards: [magnata] },
        lastEvent: { kind: 'eliminated', playerId: 'bia' },
      });
      expect(screen.getByText('Bia perdeu todas as influências')).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'VITÓRIA' })).toBeNull();
      act(() => vi.advanceTimersByTime(1750));
      expect(screen.getByRole('dialog', { name: 'VITÓRIA' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
