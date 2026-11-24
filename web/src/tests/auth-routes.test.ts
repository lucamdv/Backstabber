import { expect, test } from 'vitest';
import { clearOnlineCallback, oauthRedirect } from '../online/routes';

test('recovery returns to its own environment and preserves only a valid invite', () => {
  const url = new URL(oauthRedirect('https://preview.example.test/?sala=11111ABC12&redirect_to=https://evil.test&code=secret#/online', 'rooms', true));
  expect(url.origin).toBe('https://preview.example.test');
  expect(url.searchParams.get('sala')).toBe('11111ABC12');
  expect(url.searchParams.get('auth')).toBe('recovery');
  expect(url.searchParams.has('redirect_to')).toBe(false);
  expect(url.searchParams.has('code')).toBe(false);
  expect(oauthRedirect('https://game.example.test/?sala=INVALID', 'friends')).toBe('https://game.example.test/?online=amigos');
  expect(() => oauthRedirect('https://user:password@example.test/', 'friends')).toThrow();
});

test('URL cleanup removes callback secrets after SDK processing', () => {
  const url = new URL('http://127.0.0.1:4253/?online=salas&sala=11111ABC12&code=secret&sb_flow_id=flow&auth=recovery&token_hash=hash#access_token=jwt&refresh_token=refresh');
  clearOnlineCallback(url);
  expect(url.search).toBe('?sala=11111ABC12');
  expect(url.hash).toBe('');
});
