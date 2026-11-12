import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createOnlineApi } from './api';
import { clearOnlineCallback, oauthCallbackError, oauthRedirect, onlineHash, readOnlineSection } from './routes';
import type { OnlineSection } from './routes';

let cachedClient: { url: string; key: string; value: SupabaseClient } | undefined;

type Configuration =
  | { status: 'missing' | 'invalid'; supabase?: undefined }
  | { status: 'ready'; supabase: SupabaseClient };

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
      cachedClient = { url, key, value: createClient(url, key, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }) };
    }
    return { status: 'ready', supabase: cachedClient.value };
  } catch {
    return { status: 'invalid' };
  }
}

export function useOnlineAuth(section: OnlineSection) {
  const [{ supabase, status: configuration }] = useState(configuredClient);
  const [session, setSession] = useState<Session | null>();
  const [authError, setAuthError] = useState(() => oauthCallbackError(window.location));
  const loggedIn = useRef(false);
  const signingOut = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    const query = new URLSearchParams(window.location.search);
    const callbackMessage = oauthCallbackError(window.location);
    const returning = query.has('code') || Boolean(callbackMessage);
    let receivedEvent = false;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      receivedEvent = true;
      if (event === 'SIGNED_OUT' && loggedIn.current && !signingOut.current) {
        setAuthError('Sua sessão expirou. Entre com o Google novamente.');
      }
      if (event === 'SIGNED_IN' && nextSession) setAuthError('');
      loggedIn.current = Boolean(nextSession);
      setSession(nextSession);
    });

    async function restore() {
      if (!supabase) return;
      const initial = await supabase.auth.initialize();
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      if (callbackMessage) setAuthError(callbackMessage);
      else if (initial.error || error || (returning && !data.session)) {
        setAuthError(returning ? 'O login com Google não foi concluído. Tente novamente.'
          : 'Não foi possível restaurar sua sessão. Entre novamente.');
      }
      if (!receivedEvent) {
        loggedIn.current = Boolean(data.session);
        setSession(data.session);
      }
      // The SDK must consume the PKCE code before it is removed from the URL.
      const destination = readOnlineSection(window.location);
      if (destination && (returning || query.has('online'))) {
        const url = new URL(window.location.href);
        clearOnlineCallback(url);
        url.hash = onlineHash(destination);
        history.replaceState(history.state, '', url);
      }
    }

    void restore().catch(() => {
      if (active) {
        setSession(null);
        setAuthError('Não foi possível restaurar sua sessão. Entre novamente.');
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const userId = session?.user.id;
  const api = useMemo(() => supabase && userId && createOnlineApi({
    baseUrl: import.meta.env.VITE_API_URL || '/api/v1',
    getToken: async () => {
      const current = (await supabase.auth.getSession()).data.session;
      return current?.user.id === userId ? current.access_token : null;
    },
    refreshToken: async () => {
      const current = (await supabase.auth.refreshSession()).data.session;
      return current?.user.id === userId ? current.access_token : null;
    },
  }), [supabase, userId]);

  async function signIn() {
    if (!supabase) return;
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: oauthRedirect(window.location.href, section) },
      });
      if (error) setAuthError('O Google não pôde iniciar a autenticação.');
    } catch {
      setAuthError('O Google não pôde iniciar a autenticação.');
    }
  }

  async function signOut() {
    if (!supabase || signingOut.current) return;
    signingOut.current = true;
    setAuthError('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) setAuthError('Não foi possível encerrar a sessão. Tente novamente.');
      else {
        loggedIn.current = false;
        setSession(null);
      }
    } catch {
      setAuthError('Não foi possível encerrar a sessão. Tente novamente.');
    } finally {
      signingOut.current = false;
    }
  }

  return { supabase, configuration, api, session, authError, signIn, signOut };
}
