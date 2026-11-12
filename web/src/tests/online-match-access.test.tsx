import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
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
