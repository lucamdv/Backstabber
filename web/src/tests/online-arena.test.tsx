// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArenaOnline } from '../online/ArenaOnline';
import type { OnlineView } from '../game/application/online-contracts';

const ana = { id: 'ana', name: 'Ana', credits: 2, influence: 2 };
const bia = { id: 'bia', name: 'Bia', credits: 5, influence: 2 };
const caio = { id: 'caio', name: 'Caio', credits: 2, influence: 2 };
const broker = { id: 'bia-broker', character: 'broker' } as const;
const magnata = { id: 'bia-magnata', character: 'magnata' } as const;
const executor = { id: 'offer-executor', character: 'executor' } as const;
const sentinela = { id: 'offer-sentinela', character: 'sentinela' } as const;

function fixture(overrides: Partial<OnlineView> = {}): OnlineView {
  return {
    viewerId: bia.id, revision: 4, round: 1, activeId: ana.id, players: [ana, bia, caio],
    deckCount: 9, history: [], cemetery: [], phase: { kind: 'action' }, hand: [broker, magnata],
    choices: [], privatePlayerId: bia.id, revealed: true, availableActions: [], targets: [],
    challenges: [], blocks: [], closed: false, canClose: false, canRematch: false, ...overrides,
  };
}

function setup(view: OnlineView) {
  const props = {
    send: vi.fn(), onExit: vi.fn(), onCloseMatch: vi.fn(), onRematch: vi.fn(),
    busy: false, connectedIds: ['ana', 'bia'],
  };
  const result = render(<ArenaOnline view={view} {...props} />);
  return { ...props, update: (next: Partial<OnlineView>) => result.rerender(<ArenaOnline view={{ ...view, ...next }} {...props} />) };
}

describe('arena online', () => {
  it('mantém o embaralhamento decorativo na rodada sem bloquear a primeira ação', () => {
    const { send, update } = setup(fixture({ activeId: 'bia', availableActions: ['income'] }));
    const deal = screen.getByTestId('online-deal');
    expect(deal).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: /RENDA/ }));
    expect(send).toHaveBeenCalledWith({ type: 'select-action', action: 'income' });
    update({ revision: 5 });
    expect(screen.getByTestId('online-deal')).toBe(deal);
    update({ history: [{ player: 'Ana', text: 'Renda' }] });
    expect(screen.queryByTestId('online-deal')).toBeNull();
  });

  it('abre o placar completo pela barra mobile e devolve o foco ao fechar', () => {
    setup(fixture());
    const toggle = screen.getByRole('button', { name: 'Mesa' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const panel = screen.getByRole('complementary', { name: 'Jogadores da mesa' });
    expect(within(panel).getByText('Desconectado')).toBeVisible();
    expect(within(panel).getByText('Caio')).toBeVisible();
    fireEvent.keyDown(within(panel).getByRole('button', { name: 'Fechar placar' }), { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('mantém as cartas próprias acessíveis fora do turno e no Oráculo', () => {
    const { update } = setup(fixture());
    expect(screen.getByText('Ana está tramando o próximo movimento…')).toBeVisible();
    expect(screen.getByText('Desconectado')).toBeVisible();
    expect(screen.queryByRole('button', { name: /RENDA/ })).toBeNull();
    const hand = screen.getByRole('group', { name: 'Minhas influências' });
    expect(within(hand).getByRole('img', { name: 'Broker' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Oráculo' }));
    expect(screen.getByRole('heading', { name: 'ORÁCULO' })).toBeVisible();
    expect(within(hand).getByRole('img', { name: 'Broker' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ACESSAR TERMINAL' })).toBeNull();

    update({
      phase: { kind: 'reaction', declaration: { action: 'tax', playerId: 'ana', targetId: null } },
      window: { id: 'new', kind: 'reaction', eligible: ['bia', 'caio'], responded: [],
        options: [{ kind: 'challenge' }], summary: 'Reaja à declaração' },
    });
    expect(screen.queryByRole('heading', { name: 'ORÁCULO' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Duvidar' })).toBeVisible();
    expect(within(hand).getByRole('img', { name: 'Broker' })).toBeVisible();
  });

  it('exibe a declaração e a espera sem divulgar o conteúdo das respostas', () => {
    const window = { id: 'r1', kind: 'reaction', eligible: ['bia', 'caio'], responded: [],
      options: [{ kind: 'accept' }, { kind: 'challenge' }], summary: 'Ana declarou Executor.' } as const;
    const { send, update } = setup(fixture({
      phase: { kind: 'reaction', declaration: { action: 'assassinate', playerId: 'ana', targetId: 'bia' } },
      window: { ...window, eligible: [...window.eligible], responded: [], options: [...window.options] },
    }));
    const decision = screen.getByRole('region', { name: 'A mesa exige uma resposta' });
    expect(screen.getByRole('img', { name: 'Executor' })).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Minhas influências' })).getByRole('img', { name: 'Broker' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Duvidar' }));
    expect(send).toHaveBeenCalledWith({ type: 'vote', windowId: 'r1', choice: { kind: 'challenge' } });
    update({ revision: 5, window: { ...window, eligible: ['bia', 'caio'], responded: ['bia'], options: [{ kind: 'challenge' }] } });
    expect(screen.getByRole('region', { name: 'A mesa exige uma resposta' })).toBe(decision);
    expect(screen.getByRole('progressbar', { name: 'Progresso das respostas' })).toHaveValue(1);
    expect(screen.getByText('Aguardando respostas — 1/2')).toBeVisible();
    expect(screen.getByText(/Sua decisão está selada/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Duvidar' })).toBeNull();
  });

  it('prioriza ciência coletiva sobre a decisão privada de perda de influência', () => {
    const { send, update } = setup(fixture({
      phase: { kind: 'loss', victimId: 'bia', reason: 'backstab' }, choices: [broker],
      lastEvent: { kind: 'backstab', playerId: 'ana', targetId: 'bia' },
      window: { id: 'ack', kind: 'acknowledge', eligible: ['ana', 'bia'], responded: ['ana'],
        options: [{ kind: 'acknowledge' }], summary: 'Backstab em Bia' },
    }));
    const impact = screen.getByTestId('online-backstab');
    expect(within(impact).getByText('BACKSTAB')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Perder Broker' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ciente / Continuar' }));
    expect(send).toHaveBeenCalledWith({ type: 'vote', windowId: 'ack', choice: { kind: 'acknowledge' } });
    update({ window: undefined });
    expect(screen.queryByTestId('online-backstab')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Perder Broker' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'lose', cardId: 'bia-broker' });
    update({ window: undefined, viewerId: 'ana' });
    expect(screen.queryByRole('button', { name: 'Perder Broker' })).toBeNull();
  });

  it('mostra o bloqueio e permite que só o participante elegível envie a resposta', () => {
    const { send, update } = setup(fixture({
      phase: { kind: 'block-reaction', declaration: { action: 'assassinate', playerId: 'ana', targetId: 'caio' },
        block: { playerId: 'caio', character: 'sentinela' } },
      window: { id: 'block-1', kind: 'block-reaction', eligible: ['ana', 'bia'], responded: [],
        options: [{ kind: 'accept' }, { kind: 'challenge' }], summary: 'Reaja ao bloqueio' },
    }));
    const panel = screen.getByRole('region', { name: 'Contestar defesa' });
    expect(within(panel).getByRole('img', { name: 'Executor' })).toBeVisible();
    expect(within(panel).getByRole('img', { name: 'Sentinela' })).toBeVisible();
    expect(within(panel).getByText('Alvo: Caio')).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', { name: 'Contestar bloqueio' }));
    expect(send).toHaveBeenCalledWith({ type: 'vote', windowId: 'block-1', choice: { kind: 'challenge' } });
    update({ viewerId: 'caio' });
    expect(screen.queryByRole('button', { name: 'Contestar bloqueio' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aceitar bloqueio' })).toBeNull();
  });

  it('envia uma ação com o alvo e sem identidade do autor no payload', () => {
    const { send } = setup(fixture({ activeId: 'bia', availableActions: ['steal'], targets: ['ana', 'caio'] }));
    fireEvent.click(screen.getByRole('button', { name: /EXTORQUIR/ }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Alvo: Bia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alvo: Caio' }));
    expect(send).toHaveBeenCalledWith({ type: 'select-action', action: 'steal', targetId: 'caio' });
  });

  it('exibe a oferta apenas para o Broker e envia a quantidade correta de cartas', () => {
    const { send, update } = setup(fixture({ activeId: 'bia', phase: { kind: 'negotiation', playerId: 'bia', keep: 2 },
      choices: [broker, magnata, executor, sentinela] }));
    const confirm = screen.getByRole('button', { name: 'Confirmar Negociação' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Manter Executor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manter Broker' }));
    fireEvent.click(confirm);
    expect(send).toHaveBeenCalledWith({ type: 'negotiate', keepIds: ['offer-executor', 'bia-broker'] });
    update({ viewerId: 'ana' });
    expect(screen.queryByRole('button', { name: 'Manter Executor' })).toBeNull();
    expect(screen.getByText('Aguardando a negociação de Bia.')).toBeVisible();
  });

  it('só oferece revanche ao anfitrião autorizado e separa saída de encerramento', () => {
    const { onExit, onCloseMatch, onRematch, update } = setup(fixture({
      phase: { kind: 'finished', winnerId: 'ana', cards: [] },
    }));
    expect(screen.getByRole('heading', { name: 'DERROTA' })).toBeVisible();
    expect(screen.getByText(/anfitrião pode iniciar a revanche/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Jogar revanche' })).toBeNull();
    update({ canRematch: true, canClose: true });
    fireEvent.click(screen.getByRole('button', { name: 'Jogar revanche' }));
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar partida' }));
    expect(onCloseMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar encerramento' }));
    expect(onCloseMatch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sair da arena' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onRematch).toHaveBeenCalledTimes(1);
  });

  it('mostra as cartas autorizadas da fase final mesmo com a mão do vencedor preenchida', () => {
    setup(fixture({ phase: { kind: 'finished', winnerId: 'bia', cards: [broker, magnata] } }));
    const victory = screen.getByRole('dialog', { name: 'VITÓRIA' });
    expect(within(victory).getByText('Bia')).toBeVisible();
    expect(within(victory).getByText('INFLUÊNCIAS RESTANTES')).toBeVisible();
    expect(within(victory).getByRole('img', { name: 'Broker' })).toBeVisible();
    expect(within(victory).getByRole('img', { name: 'Magnata' })).toBeVisible();
  });

  it('aguarda a ciência final e protege as cartas do vencedor na tela de outro jogador', () => {
    const phase = { kind: 'finished', winnerId: 'ana', cards: [executor] } as const;
    const { update } = setup(fixture({
      phase: { ...phase, cards: [executor] },
      window: { id: 'final', kind: 'acknowledge', eligible: ['ana'], responded: [], options: [], summary: 'Resultado final.' },
    }));
    expect(screen.queryByRole('heading', { name: 'VITÓRIA' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Minhas influências' })).getByRole('img', { name: 'Broker' })).toBeVisible();
    update({ window: undefined });
    const defeat = screen.getByRole('dialog', { name: 'DERROTA' });
    expect(within(defeat).getByText('Ana')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'VITÓRIA' })).toBeNull();
    expect(within(defeat).queryByRole('img', { name: 'Executor' })).toBeNull();
    expect(within(defeat).queryByRole('img', { name: 'Broker' })).toBeNull();
  });
});
