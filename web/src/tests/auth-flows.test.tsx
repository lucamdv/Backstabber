import { act, renderHook, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, expect, test, vi } from 'vitest';
import { useOnlineAuth } from '../online/auth';

const createClient = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient }));
const confirmed = { user: { id: 'same-uuid', email_confirmed_at: '2026-01-01T00:00:00Z' }, access_token: 'CANARY_ACCESS', refresh_token: 'CANARY_REFRESH' } as Session;
let project = 0;
function setup(session: Session | null = null) {
  vi.stubEnv('VITE_SUPABASE_URL', `https://auth${++project}.example.test`);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture');
  let listener: (event: AuthChangeEvent, session: Session | null) => void = () => undefined;
  const auth = {
    initialize: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: confirmed.user }, error: null })),
    onAuthStateChange: vi.fn((fn: typeof listener) => { listener = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    signUp: vi.fn(async () => ({ data: { user: confirmed.user, session: null as Session | null }, error: null as null | { code: string } })),
    signInWithPassword: vi.fn(async () => ({ data: { session: confirmed }, error: null as null | { code: string; message?: string } })),
    verifyOtp: vi.fn(async () => ({ data: { session: confirmed }, error: null as null | { code: string } })),
    resend: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null as null | { code: string } })),
    updateUser: vi.fn(async () => ({ data: { user: confirmed.user }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
  };
  createClient.mockReturnValue({ auth });
  const hook = renderHook(() => useOnlineAuth('rooms'));
  return { ...hook, auth, notify: (event: AuthChangeEvent, next: Session | null) => act(() => listener(event, next)) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

test('signup uses official confirmation, OTP consumes the original identity and has a resend cooldown', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.session).toBeNull());
  await act(async () => hook.result.current.onSignUp('player@example.test', 'Password1!'));
  expect(hook.auth.signUp).toHaveBeenCalledWith({ email: 'player@example.test', password: 'Password1!', options: { emailRedirectTo: `${location.origin}/?online=salas` } });
  expect(hook.result.current.view).toBe('verify-email');
  expect(hook.result.current.api).toBeUndefined();
  expect(hook.result.current.cooldown).toBeGreaterThan(0);
  await act(async () => hook.result.current.onResend());
  expect(hook.auth.resend).not.toHaveBeenCalled();
  await act(async () => hook.result.current.onConfirmEmail('123456'));
  expect(hook.auth.verifyOtp).toHaveBeenCalledWith({ email: 'player@example.test', token: '123456', type: 'signup' });
  expect(hook.result.current.session?.user.id).toBe('same-uuid');
  expect(hook.result.current.api).toBeTruthy();
});

test('password login preserves legacy passwords and never automatically sends email on failure', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.session).toBeNull());
  hook.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: confirmed }, error: { code: 'invalid_credentials', message: 'CANARY_PASSWORD' } });
  await act(async () => hook.result.current.onPasswordSignIn('player@example.test', 'old'));
  expect(hook.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'player@example.test', password: 'old' });
  expect(hook.result.current.authError).not.toContain('CANARY');
  expect(hook.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  expect(hook.auth.resend).not.toHaveBeenCalled();
  expect(hook.auth.signUp).not.toHaveBeenCalled();
});

test('does not enter multiplayer with an unverified or anonymous session', async () => {
  const hook = setup({ ...confirmed, user: { ...confirmed.user, email_confirmed_at: undefined, user_metadata: { email_verified: true } } });
  await waitFor(() => expect(hook.result.current.session).toBeDefined());
  expect(hook.result.current.api).toBeUndefined();
});

test('refuses silently autoconfirmed signup instead of pretending that an OTP was sent', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.session).toBeNull());
  hook.auth.signUp.mockResolvedValueOnce({ data: { user: confirmed.user, session: confirmed }, error: null });
  await act(async () => hook.result.current.onSignUp('player@example.test', 'Password1!'));
  expect(hook.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(hook.result.current.api).toBeUndefined();
  expect(hook.result.current.authError).toMatch(/confirmação de email/);
});

test('uses generic recovery responses and only sends on an explicit request', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.session).toBeNull());
  await act(async () => hook.result.current.onRequestPassword('absent@example.test'));
  expect(hook.auth.resetPasswordForEmail).toHaveBeenCalledWith('absent@example.test', { redirectTo: `${location.origin}/?online=salas&auth=recovery` });
  expect(hook.result.current.notice).toMatch(/^Se este endereço estiver associado/);
  await act(async () => hook.result.current.onRequestPassword('absent@example.test'));
  expect(hook.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
});

test('a query flag or ordinary Google session cannot authorize updating a password', async () => {
  window.history.replaceState(null, '', '/?online=salas&auth=recovery');
  const hook = setup(confirmed);
  await waitFor(() => expect(hook.result.current.session).toBeDefined());
  expect(hook.result.current.recoveryAuthorized).toBe(false);
  await act(async () => hook.result.current.onSavePassword('Password1!'));
  expect(hook.auth.updateUser).not.toHaveBeenCalled();
});

test('PASSWORD_RECOVERY opens the dedicated view, updates the same verified UUID and signs out', async () => {
  const hook = setup(confirmed);
  await waitFor(() => expect(hook.result.current.session).toBeDefined());
  hook.notify('PASSWORD_RECOVERY', confirmed);
  expect(hook.result.current.view).toBe('set-password');
  expect(hook.result.current.recoveryAuthorized).toBe(true);
  expect(hook.result.current.api).toBeUndefined();
  await act(async () => hook.result.current.onSavePassword('Password1!'));
  expect(hook.auth.updateUser).toHaveBeenCalledWith({ password: 'Password1!' });
  expect(hook.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(hook.result.current.view).toBe('password-saved');
  expect(hook.result.current.session).toBeNull();
});

test('a different current identity cannot use a previous recovery authorization', async () => {
  const hook = setup(confirmed);
  await waitFor(() => expect(hook.result.current.session).toBeDefined());
  hook.notify('PASSWORD_RECOVERY', confirmed);
  hook.auth.getSession.mockResolvedValueOnce({ data: { session: { ...confirmed, user: { ...confirmed.user, id: 'other-uuid' } } }, error: null });
  await act(async () => hook.result.current.onSavePassword('Password1!'));
  expect(hook.auth.updateUser).not.toHaveBeenCalled();
});

test('recovery authorization survives returning to the menu and remounting the same client', async () => {
  const hook = setup(confirmed);
  await waitFor(() => expect(hook.result.current.session).toBeDefined());
  hook.notify('PASSWORD_RECOVERY', confirmed);
  hook.unmount();
  const back = renderHook(() => useOnlineAuth('rooms'));
  await waitFor(() => expect(back.result.current.session?.user.id).toBe('same-uuid'));
  expect(back.result.current.recoveryAuthorized).toBe(true);
  expect(back.result.current.view).toBe('set-password');
  expect(back.result.current.api).toBeUndefined();
  back.unmount();
});

test('switching accounts while the identity check is awaited cancels the password update', async () => {
  const hook = setup(confirmed);
  await waitFor(() => expect(hook.result.current.session).toBeDefined());
  hook.notify('PASSWORD_RECOVERY', confirmed);
  hook.auth.getUser.mockImplementationOnce(async () => {
    hook.notify('SIGNED_IN', { ...confirmed, user: { ...confirmed.user, id: 'other-user' } });
    return { data: { user: confirmed.user }, error: null };
  });
  await act(async () => hook.result.current.onSavePassword('Password1!'));
  expect(hook.auth.updateUser).not.toHaveBeenCalled();
});

test('no console method receives canary credentials, codes, sessions, errors or callback URLs', async () => {
  const spies = ['log', 'info', 'debug', 'warn', 'error'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => undefined));
  const hook = setup();
  await waitFor(() => expect(hook.result.current.session).toBeNull());
  await act(async () => hook.result.current.onSignUp('canary@example.test', 'CANARY_Password1!'));
  await act(async () => hook.result.current.onConfirmEmail('654321'));
  await act(async () => hook.result.current.signOut());
  hook.auth.signInWithPassword.mockRejectedValueOnce(new Error('CANARY_PASSWORD CANARY_REFRESH'));
  await act(async () => hook.result.current.onPasswordSignIn('canary@example.test', 'CANARY_Password1!'));
  await act(async () => hook.result.current.onGoogle());
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
