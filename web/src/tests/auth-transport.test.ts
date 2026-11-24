import { expect, test, vi } from 'vitest';
import { authFetch } from '../online/auth-transport';

test('redacts provider error bodies before the SDK can log them', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'email_not_confirmed', message: 'CANARY_PASSWORD 654321', access_token: 'CANARY_TOKEN' }), { status: 400 }));
  const response = await authFetch(fetcher)('https://auth.test/auth/v1/token');
  expect(await response.json()).toEqual({ code: 'email_not_confirmed', message: 'Authentication request failed' });
  expect(fetcher.mock.calls[0]).toHaveLength(2);
});

test('rejects redirects and makes thrown transport failures safe for SDK logging', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('CANARY_TOKEN https://auth.test/?code=secret'));
  await expect(authFetch(fetcher)('https://auth.test/auth/v1/user')).rejects.toThrow('Authentication transport unavailable');
  expect(fetcher).toHaveBeenCalledWith('https://auth.test/auth/v1/user', { redirect: 'error' });
});

test('preserves successful sessions and hides malformed successful payloads', async () => {
  const session = { access_token: 'CANARY_ACCESS', user: { id: 'uuid' } };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(new Response('unexpected CANARY_SECRET'));
  expect(await (await authFetch(fetcher)('https://auth.test/auth/v1/token')).json()).toEqual(session);
  const invalid = await authFetch(fetcher)('https://auth.test/auth/v1/token');
  expect(invalid.status).toBe(502);
  expect(await invalid.text()).not.toContain('CANARY');
});

test('binds password mutations to the validated bearer despite a cross-tab account switch', async () => {
  const fetcher = vi.fn(async () => Response.json({ id: 'user-a' }));
  const guarded = authFetch(fetcher, authorization => authorization === 'Bearer expected-a');
  await expect(guarded('https://auth.test/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer switched-b' }, body: JSON.stringify({ password: 'CANARY_PASSWORD' }) })).rejects.toThrow('Authentication transport unavailable');
  expect(fetcher).not.toHaveBeenCalled();
  await guarded('https://auth.test/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer expected-a' }, body: JSON.stringify({ password: 'CANARY_PASSWORD' }) });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
