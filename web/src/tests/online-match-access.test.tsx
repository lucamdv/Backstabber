import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createOnlineGame, onlineView } from '../../server/online-engine';
import { OnlineMatch } from '../online/OnlineMatch';
import { OnlineApiError } from '../online/api';
import type { OnlineApi } from '../online/api';

it('remove a arena quando a API deixa de autorizar a leitura da partida', async () => {
  const game = createOnlineGame([{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bia' }], () => 0.999);
  const view = onlineView(game, 'a', 'a', false);
  let allowed = true;
  const api: OnlineApi = {
    async request<T>() {
      if (!allowed) throw new OnlineApiError(404, 'NOT_FOUND', 'fixture removed membership');
      return view as T;
    },
  };
  const props = { matchId: 'match', roomId: 'room', api, connectedIds: ['a', 'b'], onExit: () => {} };
  const page = render(<OnlineMatch {...props} matchInvalidation={0} />);
  await screen.findByRole('button', { name: /^RENDA/i });
  allowed = false;
  page.rerender(<OnlineMatch {...props} matchInvalidation={1} />);
  await screen.findByText('Partida indisponível.');
  expect(screen.queryByRole('button', { name: /^RENDA/i })).not.toBeInTheDocument();
  expect(page.container.querySelector('#player-hand')).toBeNull();
});

it('só confirma o retorno após um snapshot e distingue falhas de rede, API, Realtime e sessão', async () => {
  const game = createOnlineGame([{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bia' }], () => 0.999);
  const view = onlineView(game, 'a', 'a', false);
  let failure: Error | undefined;
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const api: OnlineApi = { async request<T>() { if (failure) throw failure; return view as T; } };
  const props = { matchId: 'match', roomId: 'room', api, connectedIds: ['a', 'b'], onExit: () => {} };
  try {
    const page = render(<OnlineMatch {...props} matchInvalidation={0} realtimeUnavailable />);
    await screen.findByText('Canal em tempo real instável');
    expect(screen.queryByText('Conexão interrompida')).toBeNull();
    online.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText('Sinal interrompido')).toBeVisible();
    online.mockReturnValue(true);
    failure = new OnlineApiError(503, 'SERVICE_UNAVAILABLE', 'fixture unavailable');
    act(() => { window.dispatchEvent(new Event('online')); });
    await screen.findByText('Serviço temporariamente indisponível');
    expect(screen.queryByText('Você voltou à rede')).toBeNull();
    failure = new TypeError('fixture transport failed');
    page.rerender(<OnlineMatch {...props} matchInvalidation={1} />);
    await screen.findByText('Conexão instável');
    failure = undefined;
    page.rerender(<OnlineMatch {...props} matchInvalidation={2} />);
    expect(await screen.findByText('Você voltou à rede')).toBeVisible();
    failure = new OnlineApiError(401, 'UNAUTHENTICATED', 'fixture expired');
    page.rerender(<OnlineMatch {...props} matchInvalidation={3} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('A sessão expirou.');
    expect(screen.queryByText('Você voltou à rede')).toBeNull();
  } finally { online.mockRestore(); }
});
