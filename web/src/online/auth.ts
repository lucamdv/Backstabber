import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createOnlineApi } from './api';

let client: SupabaseClient | undefined;

function configuredClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return undefined;
  client ??= createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export function useOnlineAuth() {
  const [configuration] = useState(() => {
    try {
      return { supabase: configuredClient() };
    } catch {
      return { supabase: undefined };
    }
  });
  const { supabase } = configuration;
  const [session, setSession] = useState<Session | null>();
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let receivedEvent = false;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      receivedEvent = true;
      setSession(nextSession);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError('Não foi possível restaurar sua sessão. Entre novamente.');
      if (!receivedEvent) setSession(data.session);
    }).catch(() => {
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
    const redirect = new URL(window.location.href);
    redirect.hash = '';
    redirect.searchParams.set('online', '1');
    redirect.searchParams.delete('error');
    redirect.searchParams.delete('error_description');
    redirect.searchParams.delete('error_code');
    redirect.searchParams.delete('code');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirect.href },
      });
      if (error) setAuthError('O Google não pôde iniciar a autenticação.');
    } catch {
      setAuthError('O Google não pôde iniciar a autenticação.');
    }
  }

  async function signOut() {
    if (!supabase) return;
    setAuthError('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) setAuthError('Não foi possível encerrar a sessão. Tente novamente.');
    } catch {
      setAuthError('Não foi possível encerrar a sessão. Tente novamente.');
    }
  }

  return { supabase, api, session, authError, signIn, signOut };
}
