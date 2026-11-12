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

const callbackFields = ['code', 'error', 'error_code', 'error_description'] as const;

export function clearOnlineCallback(url: URL) {
  url.searchParams.delete('online');
  for (const key of callbackFields) url.searchParams.delete(key);
}

export function oauthRedirect(href: string, section: OnlineSection) {
  const url = new URL(href);
  clearOnlineCallback(url);
  url.hash = '';
  url.searchParams.set('online', section === 'friends' ? 'amigos' : 'salas');
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
