import { expect, test } from '@playwright/test';

const frontend = 'http://127.0.0.1:4253';
const auth = 'http://127.0.0.1:54321';

test.skip(process.env.BACKSTABBER_LOCAL_OAUTH_PREFLIGHT !== '1',
  'Requires the local Supabase stack with Google enabled.');
test.use({ serviceWorkers: 'block' });

for (const entry of [
  { path: '/#/amigos', query: '?online=amigos' },
  { path: '/?sala=11111ABC12#/online', query: '?sala=11111ABC12&online=salas' },
]) {
  test(`@local-oauth starts Google PKCE from ${entry.path}`, async ({ page, baseURL }) => {
    expect(baseURL).toBe(frontend);
    await page.route('**/*', route => {
      const { origin } = new URL(route.request().url());
      return origin === frontend ? route.continue() : route.abort();
    });
    let location = '';
    await page.route(`${auth}/auth/v1/authorize**`, async route => {
      const response = await route.fetch({ maxRedirects: 0 });
      location = response.headers().location ?? '';
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Local OAuth preflight.' });
    });

    await page.goto(frontend + entry.path);
    const [authorize] = await Promise.all([
      page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.origin === auth && url.pathname === '/auth/v1/authorize';
      }),
      page.getByRole('button', { name: 'Entrar com Google' }).click(),
    ]);
    const local = new URL(authorize.url());
    expect(local.searchParams.get('provider')).toBe('google');
    expect(local.searchParams.get('redirect_to')).toBe(`${frontend}/${entry.query}`);
    expect(local.searchParams.get('code_challenge_method')).toBe('s256');
    expect(/^[\w-]{43}$/.test(local.searchParams.get('code_challenge') ?? '')).toBe(true);

    await expect(page.getByText('Local OAuth preflight.')).toBeVisible();
    expect(Boolean(location)).toBe(true);
    const google = new URL(location);
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('redirect_uri')).toBe(`${auth}/auth/v1/callback`);
    expect(google.searchParams.get('response_type')).toBe('code');
    expect(Boolean(google.searchParams.get('state'))).toBe(true);
  });
}
