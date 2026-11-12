import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useOnlineAuth } from '../online/auth';
import { OnlineHub } from '../online/OnlineHub';
import { oauthRedirect, readOnlineSection } from '../online/routes';

const createClient = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient }));

test('uses the stable Preview origin for the Google return, including room invites', () => {
  const stable = 'https://backstabber-homologacao-git-feat-b522fa-luca-monteiros-projects.vercel.app';
  const redirect = new URL(oauthRedirect(`${stable}/?sala=11111ABC12#/online`, 'rooms'));
  expect(redirect.origin).toBe(stable);
  expect(redirect.searchParams.get('sala')).toBe('11111ABC12');
  expect(readOnlineSection(redirect)).toBe('rooms');
  expect(oauthRedirect(`${stable}/#/amigos`, 'friends')).toBe(`${stable}/?online=amigos`);
});

function publicConfig(project = 'backstabber') {
  vi.stubEnv('VITE_SUPABASE_URL', `https://${project}.example.test`);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_key');
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
  createClient.mockReset();
});

test('keeps the return to local mode when public Supabase settings are absent', () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  render(<OnlineHub onExit={() => undefined} renderMatch={() => null} />);
  expect(screen.getByRole('status')).toHaveTextContent('Você pode continuar no modo local');
  expect(screen.getByRole('button', { name: 'Voltar ao menu local' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Entrar com Google' })).toBeNull();
  expect(createClient).not.toHaveBeenCalled();
});

test('rejects malformed or secret frontend keys without echoing them', () => {
  publicConfig();
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_fake_private_value');
  render(<OnlineHub onExit={() => undefined} renderMatch={() => null} />);
  expect(screen.getByRole('status')).toHaveTextContent('configuração pública do Supabase está inválida');
  expect(screen.queryByText(/fake_private_value/)).toBeNull();
  expect(createClient).not.toHaveBeenCalled();
});

test('starts Google PKCE from Amigos, restores the callback session and can sign out', async () => {
  publicConfig();
  const restored = { user: { id: 'eva' }, access_token: 'fake-access-token' };
  const auth = {
    initialize: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null as typeof restored | null }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  };
  createClient.mockReturnValue({ auth });
  window.history.replaceState(null, '', '/#/amigos');
  const initial = renderHook(() => useOnlineAuth('friends'));
  await waitFor(() => expect(initial.result.current.session).toBeNull());
  await act(async () => { await initial.result.current.signIn(); });
  expect(createClient).toHaveBeenCalledWith('https://backstabber.example.test', 'sb_publishable_test_key',
    { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google', options: { redirectTo: `${location.origin}/?online=amigos` },
  });
  initial.unmount();

  window.history.replaceState(null, '', '/?online=amigos&code=fake-oauth-code');
  auth.getSession.mockResolvedValueOnce({ data: { session: restored }, error: null });
  const callback = renderHook(() => useOnlineAuth('friends'));
  await waitFor(() => expect(callback.result.current.session?.user.id).toBe('eva'));
  expect(location.hash).toBe('#/amigos');
  expect(location.search).toBe('');
  await act(async () => { await callback.result.current.signOut(); });
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(callback.result.current.session).toBeNull();
});

test('keeps the invite on a Google cancellation and offers a clean retry', async () => {
  publicConfig('cancelled');
  const auth = {
    initialize: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  };
  createClient.mockReturnValue({ auth });
  window.history.replaceState(null, '', '/?online=salas&sala=11111ABC12&error=access_denied&error_description=internal-details');
  const hook = renderHook(() => useOnlineAuth('rooms'));
  await waitFor(() => expect(hook.result.current.session).toBeNull());
  expect(hook.result.current.authError).toMatch(/cancelado/);
  expect(hook.result.current.authError).not.toContain('internal-details');
  expect(location.search).toBe('?sala=11111ABC12');
  expect(location.hash).toBe('#/online');
  await act(async () => { await hook.result.current.signIn(); });
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google', options: { redirectTo: `${location.origin}/?sala=11111ABC12&online=salas` },
  });
});

test('drops the private session when Supabase reports an unsolicited sign-out', async () => {
  publicConfig('expired');
  const session = { user: { id: 'eva' }, access_token: 'fake-access-token' };
  let notify: (event: string, session: null) => void = () => undefined;
  const auth = {
    initialize: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((listener: typeof notify) => {
      notify = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  createClient.mockReturnValue({ auth });
  const hook = renderHook(() => useOnlineAuth('friends'));
  await waitFor(() => expect(hook.result.current.session?.user.id).toBe('eva'));
  act(() => { notify('SIGNED_OUT', null); });
  expect(hook.result.current.session).toBeNull();
  expect(hook.result.current.api).toBeUndefined();
  expect(hook.result.current.authError).toMatch(/sessão expirou/);
});
