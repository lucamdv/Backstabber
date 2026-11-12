import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { OnlineHub } from '../online/OnlineHub';
import type { Room } from '../online/types';

const useOnlineAuth = vi.hoisted(() => vi.fn());
vi.mock('../online/auth', () => ({ useOnlineAuth }));

const me = { id: 'eva', username: 'eva', displayName: 'Eva', avatarUrl: null, showOnline: false };
const guest = { id: 'rui', username: 'rui', displayName: 'Rui', avatarUrl: null, showOnline: false };
const room: Room = {
  id: 'first-room', code: '00000ABC12', hostId: me.id, capacity: 4, status: 'lobby',
  matchId: null, canStart: true, members: [
    { ...me, ready: true, connected: true }, { ...guest, ready: true, connected: true },
  ],
};

function connect(request: (path: string, method?: string, body?: unknown) => Promise<unknown>) {
  const invalidations = new Map<string, () => void>();
  const client = {
    channel: (topic: string) => ({
      on(type: string, _filter: unknown, handler: () => void) {
        if (type === 'broadcast') invalidations.set(topic, handler);
        return this;
      },
      subscribe() { return this; },
    }),
    removeChannel: vi.fn(),
  };
  useOnlineAuth.mockReturnValue({
    supabase: client,
    api: { request },
    session: { user: { id: me.id, user_metadata: {} } },
    authError: '',
  });
  return invalidations;
}

function baseData(path: string) {
  switch (path) {
    case '/profile': return me;
    case '/friends': return { friends: [], requests: [] };
    case '/invites': return [];
    case '/profile/heartbeat': return { ok: true };
    default: return undefined;
  }
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  useOnlineAuth.mockReset();
});

test('a shared room link prefills the code even with an existing room, then enters the authorized room', async () => {
  window.history.replaceState(null, '', '/?sala=11111ABC12#/online');
  const other = { ...room, id: 'invited-room', code: '11111ABC12' };
  const request = vi.fn(async (path: string) => {
    if (path === '/rooms') return [room];
    if (path === '/rooms/join' || path === `/rooms/${other.id}/heartbeat`) return other;
    return baseData(path);
  });
  connect(request);
  render(<OnlineHub onExit={() => undefined} renderMatch={() => null} />);
  expect(await screen.findByLabelText('Código de convite')).toHaveValue(other.code);
  fireEvent.click(screen.getByRole('button', { name: 'Entrar por código' }));
  expect(await screen.findByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/rooms/join', 'POST', { code: other.code });
  expect(screen.getByText(other.code, { selector: 'strong' })).toBeInTheDocument();
});

test('a room broadcast reloads the server snapshot before mounting the match for a participant', async () => {
  let snapshot = room;
  const refresh = connect(async path => {
    if (path === '/rooms') return [snapshot];
    if (path === `/rooms/${room.id}/heartbeat`) return snapshot;
    return baseData(path);
  });
  render(<OnlineHub onExit={() => undefined} renderMatch={({ matchId, connectedIds }) => (
    <output>Partida {matchId} · {connectedIds.join(',')}</output>
  )} />);
  await screen.findByRole('heading', { name: 'Lobby' });
  snapshot = { ...room, status: 'started', matchId: 'game-9' };
  await act(async () => { refresh.get(`room:${room.id}`)?.(); });
  expect(await screen.findByText('Partida game-9 · eva,rui')).toBeInTheDocument();
});
