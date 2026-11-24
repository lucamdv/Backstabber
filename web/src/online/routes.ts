export type OnlineSection = 'friends' | 'rooms';

export function onlineHash(section: OnlineSection): string {
  return section === 'friends' ? '#/amigos' : '#/online';
}

export function readOnlineSection(location: Pick<Location, 'hash' | 'search'>): OnlineSection | null {
  if (location.hash === '#/amigos') return 'friends';
  if (location.hash === '#/online') return 'rooms';
  const query = new URLSearchParams(location.search);
  if (query.get('online') === 'amigos') return 'friends';
  if (query.get('online') === 'salas' || query.get('online') === '1' || query.has('sala')) return 'rooms';
  return null;
}

const callbackFields = ['code', 'error', 'error_code', 'error_description', 'token_hash', 'type',
  'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'expires_in',
  'expires_at', 'token_type', 'sb_flow_id', 'flow_id'] as const;

export function clearOnlineCallback(url: URL) {
  url.searchParams.delete('online');
  url.searchParams.delete('auth');
  for (const key of callbackFields) url.searchParams.delete(key);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (callbackFields.some(key => fragment.has(key))) url.hash = '';
}

export function oauthRedirect(href: string, section: OnlineSection, recovery = false) {
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid auth origin');
  }
  const invite = url.searchParams.get('sala');
  // Return to the caller's origin/path, never to a supplied redirect URL.
  url.search = '';
  if (invite && /^[a-f0-9]{10}$/i.test(invite)) url.searchParams.set('sala', invite);
  url.hash = '';
  url.searchParams.set('online', section === 'friends' ? 'amigos' : 'salas');
  if (recovery) url.searchParams.set('auth', 'recovery');
  return url.href;
}

export function oauthCallbackError(location: Pick<Location, 'hash' | 'search'>) {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const reason = query.get('error_code') ?? query.get('error')
    ?? fragment.get('error_code') ?? fragment.get('error');
  if (!reason) return '';
  if (reason === 'access_denied' || reason === 'user_cancelled') {
    return 'O login com Google foi cancelado ou o acesso não foi autorizado.';
  }
  return 'O login com Google não foi concluído. Tente novamente.';
}
