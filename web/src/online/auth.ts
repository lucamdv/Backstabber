import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { AuthView } from './AuthTerminal';
import { validNewPassword } from './auth-policy';
import { authFetch } from './auth-transport';
import { createOnlineApi } from './api';
import { clearOnlineCallback, oauthCallbackError, oauthRedirect, onlineHash, readOnlineSection } from './routes';
import type { OnlineSection } from './routes';

type AuthContext = { recoveryUser: string | null; passwordUpdateToken: string | null };
let cachedClient: { url: string; key: string; value: SupabaseClient; context: AuthContext } | undefined;

type Configuration =
  | { status: 'missing' | 'invalid'; supabase?: undefined; context?: undefined }
  | { status: 'ready'; supabase: SupabaseClient; context: AuthContext };

function isPublicKey(key: string) {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return false;
  try {
    // Legacy anon JWTs are public project identifiers, not user sessions.
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'anon';
  } catch {
    return false;
  }
}

function isServiceUrl(value: string) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || (loopback && url.protocol === 'http:'))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function configuredClient(): Configuration {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !key) return { status: 'missing' };
  if (!isServiceUrl(url) || !isPublicKey(key)) return { status: 'invalid' };
  try {
    if (!cachedClient || cachedClient.url !== url || cachedClient.key !== key) {
      const context: AuthContext = { recoveryUser: null, passwordUpdateToken: null };
      cachedClient = { url, key, context, value: createClient(url, key, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, debug: false },
        global: { fetch: authFetch(undefined, authorization => Boolean(context.passwordUpdateToken && authorization === `Bearer ${context.passwordUpdateToken}`)) },
      }) };
    }
    return { status: 'ready', supabase: cachedClient.value, context: cachedClient.context };
  } catch {
    return { status: 'invalid' };
  }
}

export function useOnlineAuth(section: OnlineSection) {
  const [{ supabase, context, status: configuration }] = useState(configuredClient);
  const [session, setSession] = useState<Session | null>();
  const [authError, setAuthError] = useState(() => oauthCallbackError(window.location));
  const [view, setView] = useState<AuthView>(() => context?.recoveryUser || new URLSearchParams(location.search).get('auth') === 'recovery' ? 'set-password' : 'login');
  const [notice, setNotice] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [recoveryAuthorized, setRecoveryAuthorized] = useState(Boolean(context?.recoveryUser));
  const recoveryUser = useRef<string | null>(context?.recoveryUser ?? null);
  const creatingAccount = useRef(false);
  const working = useRef(false);
  const nextSend = useRef(0);
  const loggedIn = useRef(false);
  const signingOut = useRef(false);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown(Math.max(0, Math.ceil((nextSend.current - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!supabase) return;
    const query = new URLSearchParams(window.location.search);
    const callbackMessage = oauthCallbackError(window.location);
    const returning = query.has('code') || Boolean(callbackMessage) || query.get('auth') === 'recovery';
    let receivedEvent = false;
    let active = true;
    function cleanCallback() {
      if (!returning && !query.has('online')) return;
      const url = new URL(window.location.href);
      const destination = readOnlineSection(window.location);
      clearOnlineCallback(url);
      url.hash = onlineHash(destination ?? section);
      history.replaceState(history.state, '', url);
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      receivedEvent = true;
      if (event === 'SIGNED_OUT' && loggedIn.current && !signingOut.current) {
        setAuthError('Sua sessão expirou. Entre novamente.');
      }
      if (event === 'SIGNED_IN' && nextSession) setAuthError('');
      if (event === 'PASSWORD_RECOVERY' && verified(nextSession)) {
        recoveryUser.current = nextSession!.user.id;
        if (context) context.recoveryUser = recoveryUser.current;
        setRecoveryAuthorized(true);
        setView('set-password');
        setAuthError('');
      }
      if (event === 'SIGNED_OUT' || (nextSession && recoveryUser.current && nextSession.user.id !== recoveryUser.current)) {
        recoveryUser.current = null;
        if (context) context.recoveryUser = null;
        setRecoveryAuthorized(false);
      }
      loggedIn.current = Boolean(nextSession);
      setSession(nextSession);
    });

    async function restore() {
      if (!supabase) return;
      const initial = await supabase.auth.initialize();
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      if (context?.recoveryUser && (!verified(data.session) || data.session?.user.id !== context.recoveryUser)) {
        context.recoveryUser = null;
        recoveryUser.current = null;
        setRecoveryAuthorized(false);
        setView('login');
      }
      if (callbackMessage) setAuthError(callbackMessage);
      else if (initial.error || error || (returning && !data.session)) {
        setAuthError(returning ? 'O acesso não foi concluído. O link pode ter expirado; tente novamente.'
          : 'Não foi possível restaurar sua sessão. Entre novamente.');
      }
      if (!receivedEvent) {
        loggedIn.current = Boolean(data.session);
        setSession(data.session);
      }
      // The SDK must consume the PKCE code before it is removed from the URL.
      cleanCallback();
    }

    void restore().catch(() => {
      if (active) {
        cleanCallback();
        setSession(null);
        setAuthError('Não foi possível restaurar sua sessão. Entre novamente.');
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase, context, section]);

  const userId = verified(session) && !creatingAccount.current && !recoveryAuthorized && view !== 'set-password' && view !== 'password-saved' ? session!.user.id : undefined;
  const api = useMemo(() => supabase && userId && createOnlineApi({
    baseUrl: import.meta.env.VITE_API_URL || '/api/v1',
    getToken: async () => {
      const current = (await supabase.auth.getSession()).data.session;
      return verified(current) && current?.user.id === userId ? current.access_token : null;
    },
    refreshToken: async () => {
      const current = (await supabase.auth.refreshSession()).data.session;
      return verified(current) && current?.user.id === userId ? current.access_token : null;
    },
  }), [supabase, userId]);

  async function signIn() {
    await run(async () => {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: oauthRedirect(window.location.href, section) },
      });
      if (error) setAuthError('O Google não pôde iniciar a autenticação.');
    }, 'O Google não pôde iniciar a autenticação.');
  }

  async function signOut() {
    if (!supabase || signingOut.current) return false;
    signingOut.current = true;
    setAuthError('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) { setAuthError('Não foi possível encerrar a sessão. Tente novamente.'); return false; }
      else {
        loggedIn.current = false;
        setSession(null);
        recoveryUser.current = null;
        if (context) context.recoveryUser = null;
        setRecoveryAuthorized(false);
        setView('login');
        setPendingEmail('');
        setNotice('');
        return true;
      }
    } catch {
      setAuthError('Não foi possível encerrar a sessão. Tente novamente.');
      return false;
    } finally {
      signingOut.current = false;
    }
  }

  async function run(operation: () => Promise<void>, fallback = 'Não foi possível concluir. Tente novamente.') {
    if (!supabase || working.current) return;
    working.current = true;
    setBusy(true);
    setAuthError('');
    setNotice('');
    try { await operation(); }
    catch { setAuthError(fallback); }
    finally { working.current = false; setBusy(false); }
  }

  function maySend() {
    if (Date.now() < nextSend.current) return false;
    nextSend.current = Date.now() + 60_000;
    setCooldown(60);
    return true;
  }

  function onNavigate(next: AuthView) {
    if (working.current) return;
    // A view name or URL parameter is never evidence of recovery authorization.
    if (next === 'set-password' && !recoveryUser.current) return;
    if (next === 'login' && (recoveryUser.current || view === 'set-password')) {
      void signOut();
      return;
    }
    setView(next);
    setAuthError('');
    setNotice('');
    if (next === 'signup' || next === 'login') setPendingEmail('');
  }

  async function onPasswordSignIn(email: string, password: string) {
    await run(async () => {
      const { data, error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (error.code === 'email_not_confirmed') {
          setPendingEmail(email.trim());
          setView('verify-email');
          setAuthError('Confirme seu email com o código recebido. Você pode solicitar outro código.');
        } else setAuthError('Não foi possível entrar. Confira suas credenciais ou solicite a recuperação de acesso.');
        return;
      }
      if (!verified(data.session)) { setAuthError('Confirme seu email para acessar a rede.'); return; }
      recoveryUser.current = null;
      if (context) context.recoveryUser = null;
      setRecoveryAuthorized(false);
      setSession(data.session);
      setView('login');
    });
  }

  async function onSignUp(email: string, password: string) {
    if (!validNewPassword(password)) { setAuthError('Complete todos os requisitos da nova senha.'); return; }
    await run(async () => {
      if (!maySend()) { setAuthError('Aguarde o intervalo de envio antes de tentar novamente.'); return; }
      creatingAccount.current = true;
      try {
        const { data, error } = await supabase!.auth.signUp({ email: email.trim(), password,
          options: { emailRedirectTo: oauthRedirect(location.href, section) } });
        if (error) { setAuthError('Não foi possível concluir o cadastro. Confira os requisitos ou solicite a recuperação de acesso.'); return; }
        if (data.session) {
          await supabase!.auth.signOut({ scope: 'local' });
          setSession(null);
          setAuthError('O cadastro exige confirmação de email. A configuração deste ambiente precisa ser corrigida.');
          return;
        }
        setPendingEmail(email.trim());
        setView('verify-email');
        setNotice('Confira o código recebido. Se você já tem uma conta, entre ou solicite a definição ou recuperação de senha.');
      } finally { creatingAccount.current = false; }
    });
  }

  async function onConfirmEmail(code: string) {
    if (!pendingEmail || !/^\d{6}$/.test(code)) { setAuthError('Digite o código de 6 dígitos recebido no seu email.'); return; }
    await run(async () => {
      const { data, error } = await supabase!.auth.verifyOtp({ email: pendingEmail, token: code, type: 'signup' });
      if (error || !verified(data.session)) { setAuthError('Código incorreto, expirado ou já utilizado. Confira o mais recente ou solicite outro.'); return; }
      setPendingEmail('');
      setSession(data.session);
      setView('login');
    });
  }

  async function onResend() {
    if (!pendingEmail) return;
    await run(async () => {
      if (!maySend()) return;
      const { error } = await supabase!.auth.resend({ type: 'signup', email: pendingEmail,
        options: { emailRedirectTo: oauthRedirect(location.href, section) } });
      if (error) { setAuthError('Não foi possível reenviar agora. Aguarde e tente novamente.'); return; }
      setNotice('Se houver uma confirmação pendente, você receberá um novo código.');
    });
  }

  async function onRequestPassword(email: string) {
    await run(async () => {
      if (!maySend()) return;
      const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: oauthRedirect(location.href, section, true) });
      // Do not distinguish existing/password/Google-only accounts.
      if (error && !['user_not_found', 'email_not_found'].includes(error.code ?? '')) {
        setAuthError('Não foi possível solicitar o email agora. Aguarde e tente novamente.'); return;
      }
      setNotice('Se este endereço estiver associado a uma conta, você receberá instruções para definir ou recuperar sua senha.');
    });
  }

  async function onSavePassword(password: string) {
    if (!recoveryUser.current || !validNewPassword(password)) { setAuthError('Abra um link de recuperação válido e complete os requisitos da senha.'); return; }
    await run(async () => {
      const expectedUser = recoveryUser.current;
      const current = (await supabase!.auth.getSession()).data.session;
      const { data: identity, error: identityError } = await supabase!.auth.getUser();
      if (identityError || !expectedUser || recoveryUser.current !== expectedUser || !verified(current) || current!.user.id !== expectedUser || identity.user?.id !== expectedUser
        || !identity.user.email_confirmed_at || identity.user.is_anonymous) {
        recoveryUser.current = null;
        if (context) context.recoveryUser = null;
        setRecoveryAuthorized(false);
        setAuthError('O link expirou ou a sessão mudou. Solicite outro link.');
        return;
      }
      // The shared SDK re-reads storage internally. Bind the outgoing PUT to the
      // already validated bearer, so another tab cannot redirect this mutation.
      if (context) context.passwordUpdateToken = current!.access_token;
      try {
        const { data, error } = await supabase!.auth.updateUser({ password });
        if (error || data.user.id !== expectedUser) { setAuthError('Não foi possível salvar. Confira os requisitos ou solicite outro link.'); return; }
      } finally { if (context) context.passwordUpdateToken = null; }
      const ended = await signOut();
      if (!ended) { setNotice('Senha salva. Encerre a sessão para entrar com a nova senha.'); return; }
      // Require a fresh login after defining a password; no account is recreated.
      setView('password-saved');
    });
  }

  return { supabase, configuration, api, session, authError, signIn, signOut,
    view, busy, notice, cooldown, pendingEmail, recoveryAuthorized,
    onNavigate, onGoogle: signIn, onPasswordSignIn, onSignUp, onConfirmEmail, onResend, onRequestPassword, onSavePassword };
}

function verified(session: Session | null | undefined): boolean {
  return Boolean(session?.user.id && !session.user.is_anonymous && session.user.email_confirmed_at
    && Number.isFinite(Date.parse(session.user.email_confirmed_at)));
}
