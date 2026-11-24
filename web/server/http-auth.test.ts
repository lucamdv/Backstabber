// @vitest-environment node
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, supabaseAuthenticator } from './http';

const id = '00000000-0000-4000-8000-000000000001';
const confirmed = '2026-11-20T12:00:00.000Z';
const request = (authorization = 'Bearer canary-access-token') => new Request('http://local.test/api/v1/profile', {
  headers: { Authorization: authorization },
});
const cannotConnect = async (): Promise<PoolClient> => { throw Error('Authentication must precede database checkout'); };
const responseFor = (user: unknown) => (async () => Response.json(user)) as typeof fetch;

afterEach(() => vi.restoreAllMocks());

describe('trusted Supabase identity', () => {
  it.each(['google', 'email'])('accepts a confirmed %s account with the upstream UUID', async provider => {
    const auth = supabaseAuthenticator('https://auth.test', 'public-key', responseFor({
      id, email_confirmed_at: confirmed, is_anonymous: false,
      app_metadata: { provider }, user_metadata: { email_verified: false },
    }));
    await expect(auth('session-token')).resolves.toBe(id);
  });

  it.each([undefined, null, '', ' ', false, true, 'not-a-date'])('rejects missing or invalid trusted confirmation %s', async email_confirmed_at => {
    const auth = supabaseAuthenticator('https://auth.test', 'public-key', responseFor({
      id, email_confirmed_at, confirmed_at: confirmed, user_metadata: { email_verified: true, email_confirmed_at: confirmed },
    }));
    const response = await createApi(cannotConnect, auth)(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it.each([{ id, email_confirmed_at: confirmed, is_anonymous: true }, { id: '1-2-3-4-5', email_confirmed_at: confirmed }, null])('rejects anonymous or malformed identity %#', async user => {
    expect((await createApi(cannotConnect, supabaseAuthenticator('https://auth.test', 'public-key', responseFor(user)))(request())).status).toBe(401);
  });

  it('rechecks Auth for every request and does not reuse revoked confirmation', async () => {
    let verified = true;
    const auth = supabaseAuthenticator('https://auth.test', 'public-key', (async () => Response.json({
      id, email_confirmed_at: verified ? confirmed : null,
    })) as typeof fetch);
    await expect(auth('same-token')).resolves.toBe(id);
    verified = false;
    await expect(auth('same-token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it.each([401, 403, 503, 302])('maps Auth HTTP %s to a safe API response', async status => {
    const auth = supabaseAuthenticator('https://auth.test', 'public-key', (async () => new Response('canary-password', { status })) as typeof fetch);
    const response = await createApi(cannotConnect, auth)(request());
    expect(response.status).toBe(status === 401 || status === 403 ? 401 : 503);
    expect(await response.text()).not.toContain('canary');
  });

  it('requests the configured Auth endpoint with redirects disabled', async () => {
    const fetcher = (async (url, options) => {
      expect(String(url)).toBe('https://auth.test/auth/v1/user');
      expect(options?.redirect).toBe('error');
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer canary-access-token');
      return Response.json({ id, email_confirmed_at: confirmed });
    }) as typeof fetch;
    await expect(supabaseAuthenticator('https://auth.test', 'public-key', fetcher)('canary-access-token')).resolves.toBe(id);
  });

  it.each(['http://remote.test', 'https://user:canary-password@auth.test'])('refuses unsafe Auth configuration %s without sending credentials', async url => {
    const fetcher = vi.fn(responseFor({ id, email_confirmed_at: confirmed }));
    expect((await createApi(cannotConnect, supabaseAuthenticator(url, 'public-key', fetcher))(request())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never logs injected names, codes, Auth JSON, bearer tokens or passwords', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'canary-access-token canary-password canary-otp-654321';
    const poisoned = Object.assign(new Error(secret), { name: secret, code: secret });
    const outage = supabaseAuthenticator('https://auth.test', 'public-key', (async () => { throw poisoned; }) as typeof fetch);
    expect((await createApi(cannotConnect, outage)(request())).status).toBe(503);
    const malformed = supabaseAuthenticator('https://auth.test', 'public-key', (async () => new Response('{' + secret)) as typeof fetch);
    const invalidJson = await createApi(cannotConnect, malformed)(request());
    expect(invalidJson.status).toBe(500);
    expect(await invalidJson.json()).toEqual({ error: 'INTERNAL_ERROR' });
    expect((await createApi(async () => { throw poisoned; }, async () => id)(request())).status).toBe(503);
    const tx = { query: async (sql: string) => { if (sql !== 'rollback') throw poisoned; }, release: () => undefined } as unknown as PoolClient;
    expect((await createApi(async () => tx, async () => id)(request())).status).toBe(500);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('canary');
  });

  it.each(['Basic canary-password', 'Bearer token with spaces', 'Bearer'])('rejects malformed authorization before contacting Auth: %s', async authorization => {
    const auth = vi.fn(async () => id);
    expect((await createApi(cannotConnect, auth)(request(authorization))).status).toBe(401);
    expect(auth).not.toHaveBeenCalled();
  });
});
