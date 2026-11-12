import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../app/App';
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
  expect(await screen.findByRole('heading', { name: 'Preparação da mesa' })).toBeInTheDocument();
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
  await screen.findByRole('heading', { name: 'Preparação da mesa' });
  snapshot = { ...room, status: 'started', matchId: 'game-9' };
  await act(async () => { refresh.get(`room:${room.id}`)?.(); });
  expect(await screen.findByText('Partida game-9 · eva,rui')).toBeInTheDocument();
});

test('Amigos asks for login and a callback restores the Friends destination, including with an active match', async () => {
  useOnlineAuth.mockReturnValue({ supabase: {}, session: null, authError: '' });
  const app = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Amigos' }));
  expect(window.location.hash).toBe('#/amigos');
  expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeInTheDocument();
  app.unmount();

  window.history.replaceState(null, '', '/?online=amigos&code=example');
  connect(async path => path === '/rooms' ? [{ ...room, status: 'started', matchId: 'existing' }] : baseData(path));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Rede de contatos' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Preparação da mesa' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Amigos' })).toHaveAttribute('aria-current', 'page');
});

test('Jogar online opens the rooms destination and leaves local setup available from the menu', async () => {
  connect(async path => path === '/rooms' ? [] : baseData(path));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Jogar' }));
  expect(screen.getByRole('button', { name: 'ESTABELECER CONEXÃO' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Jogar online' }));
  expect(window.location.hash).toBe('#/online');
  expect(await screen.findByRole('heading', { name: 'Salas privadas' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Rede de contatos' })).toBeNull();
});

test('a first-time account creates its profile and lands directly in Friends', async () => {
  window.history.replaceState(null, '', '/#/amigos');
  const request = vi.fn(async (path: string, method?: string) => {
    if (path === '/profile') return method === 'PUT' ? me : null;
    if (path === '/rooms') return [];
    return baseData(path);
  });
  connect(request);
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Configure seu perfil' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Nome de usuário'), { target: { value: 'eva' } });
  fireEvent.change(screen.getByLabelText('Nome de exibição'), { target: { value: 'Eva' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
  expect(await screen.findByRole('heading', { name: 'Rede de contatos' })).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/profile', 'PUT', {
    username: 'eva', displayName: 'Eva', avatarUrl: null, showOnline: false,
  });
});

test('Friends distinguishes a connection failure from an empty list and allows retry', async () => {
  let failed = true;
  connect(async path => {
    if (path === '/rooms') return [];
    if (path === '/friends' && failed) throw new Error('unreachable');
    return baseData(path);
  });
  render(<OnlineHub section="friends" onExit={() => undefined} renderMatch={() => null} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível atualizar amigos e convites');
  expect(screen.queryByText('Sua rede está vazia')).toBeNull();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText('Sua rede está vazia')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
