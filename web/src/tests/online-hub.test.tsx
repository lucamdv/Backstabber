import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createOnlineApi } from '../online/api';
import { Lobby } from '../online/Lobby';
import type { Room } from '../online/types';

const host = { id: 'a', username: 'eva', displayName: 'Eva', avatarUrl: null, showOnline: true };
const guest = { id: 'b', username: 'rui', displayName: 'Rui', avatarUrl: null, showOnline: true };

const room: Room = {
  id: 'room', code: 'ABC123', hostId: 'a', capacity: 4, status: 'lobby', matchId: null,
  canStart: true, members: [
    { ...host, ready: true, connected: true },
    { ...guest, ready: true, connected: true },
  ],
};

function actions() {
  return {
    onReady: vi.fn(), onStart: vi.fn(), onLeave: vi.fn(), onClose: vi.fn(),
    onCopy: vi.fn(), onInvite: vi.fn(),
  };
}

test('only lets the host start when the API permits and all participants are ready and connected', () => {
  const handlers = actions();
  const { rerender } = render(<Lobby {...handlers} room={room} userId={host.id} friends={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar partida' }));
  expect(handlers.onStart).toHaveBeenCalledTimes(1);
  rerender(<Lobby {...handlers} room={{ ...room, canStart: false }} userId={host.id} friends={[]} />);
  expect(screen.getByRole('button', { name: 'Iniciar partida' })).toBeDisabled();
  rerender(<Lobby {...handlers} room={room} userId={guest.id} friends={[]} />);
  expect(screen.queryByRole('button', { name: 'Iniciar partida' })).toBeNull();
});

test('unready member can opt in, and the room shows a disconnected member without permitting start', () => {
  const handlers = actions();
  const notReady = {
    ...room, members: [
      { ...host, ready: false, connected: true },
      { ...guest, ready: true, connected: false },
    ],
  };
  render(<Lobby {...handlers} room={notReady} userId={host.id} friends={[]} />);
  expect(screen.getByText('Desconectado')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Iniciar partida' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Estou pronto' }));
  expect(handlers.onReady).toHaveBeenCalledExactlyOnceWith(true);
});

test('sends only the session bearer and retries once with a fresh session after 401', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length === 1
      ? new Response('', { status: 401 })
      : Response.json({ ok: true });
  };
  const api = createOnlineApi({
    baseUrl: 'https://api.example.test/api/v1/',
    getToken: async () => 'expired', refreshToken: async () => 'renewed', fetch: request,
  });
  await expect(api.request('/rooms', 'POST', { capacity: 4 })).resolves.toEqual({ ok: true });
  expect(calls.map(call => call.url)).toEqual([
    'https://api.example.test/api/v1/rooms', 'https://api.example.test/api/v1/rooms',
  ]);
  expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer expired');
  expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer renewed');
  expect(calls[1].init?.body).toBe('{"capacity":4}');
});

test('an expired session with no replacement cannot submit an anonymous command', async () => {
  const request = vi.fn();
  const api = createOnlineApi({
    baseUrl: '/api/v1', getToken: async () => null, refreshToken: async () => null, fetch: request,
  });
  await expect(api.request('/rooms')).rejects.toMatchObject({ status: 401 });
  expect(request).not.toHaveBeenCalled();
});
