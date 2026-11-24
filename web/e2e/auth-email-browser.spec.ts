import { test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Opt-in integration proof: AuthTerminal + auth.ts + SDK + local GoTrue/Mailpit are REAL.
// Only the unavailable game API is stubbed. No Google provider is invoked.
test.use({ channel: 'chrome', trace: 'off', screenshot: 'off', video: 'off' });

const app = 'http://127.0.0.1:4263';
const auth = 'http://127.0.0.1:55441';
const mailbox = 'http://127.0.0.1:55444';
const game = 'http://127.0.0.1:18085';

test('real local browser email authentication with explicitly stubbed game API', async ({ page, baseURL }) => {
  test.skip(process.env.BACKSTABBER_AUTH_EMAIL_BROWSER !== 'auth-email-proof', 'Explicit disposable local Auth opt-in required.');
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  let stage = 'GUARD';
  const privateValues: string[] = [];
  const browserMessages: string[] = [];
  let profileRequests = 0;
  let controllerRequests = 0;
  let passed = 0;
  const check = (condition: unknown, label: string, status?: number) => {
    stage = label;
    if (!condition) throw new Error('LOCAL_BROWSER_CHECK_FAILED');
    passed++;
    process.stdout.write(`PASS AUTH_BROWSER_${label}${status ? ` HTTP_${status}` : ''}\n`);
  };
  const waitAuth = (path: string, method = 'POST', grant?: string) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === auth && url.pathname === `/auth/v1/${path}` && response.request().method() === method
      && (!grant || url.searchParams.get('grant_type') === grant);
  });
  const rememberSession = async (response: Response) => {
    const data = await response.json();
    for (const value of [data.access_token, data.refresh_token]) if (typeof value === 'string') privateValues.push(value);
    return data;
  };
  const visible = async (locator: ReturnType<Page['locator']>) => locator.waitFor({ state: 'visible' });
  const signIn = async (email: string, password: string) => {
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    const response = waitAuth('token', 'POST', 'password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    return response;
  };
  const signOut = async () => {
    const response = waitAuth('logout');
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    const result = await response;
    if (result.status() !== 204) throw new Error('LOCAL_BROWSER_LOGOUT_FAILED');
    await visible(page.getByRole('heading', { name: 'Entrar no sistema' }));
  };

  try {
    const key = process.env.BACKSTABBER_AUTH_EMAIL_BROWSER_PUBLIC_KEY ?? '';
    let publicKey = /^sb_publishable_[\w-]+$/.test(key);
    if (!publicKey && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
      try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* Guard fails below. */ }
    }
    check(baseURL === app && process.env.BACKSTABBER_AUTH_EMAIL_BROWSER_PROJECT === 'auth-email-proof'
      && process.env.BACKSTABBER_AUTH_EMAIL_BROWSER_URL === auth && publicKey, 'LOOPBACK_GUARD');
    page.on('console', message => { browserMessages.push(message.text()); });
    page.on('pageerror', error => { browserMessages.push(error.message); });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === game && url.pathname.startsWith('/api/v1/')) {
        const headers = { 'Access-Control-Allow-Origin': app, 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' };
        if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
        if (!/^Bearer \S+$/.test(request.headers().authorization ?? '')) {
          await route.fulfill({ status: 401, headers, json: { error: 'UNAUTHENTICATED' } }); return;
        }
        if (url.pathname === '/api/v1/profile' && request.method() === 'GET') {
          profileRequests++;
          await route.fulfill({ status: 200, headers, json: null }); return;
        }
        if (url.pathname === '/api/v1/friends') {
          await route.fulfill({ status: 200, headers, json: { friends: [], requests: [] } }); return;
        }
        if (url.pathname === '/api/v1/rooms') {
          await route.fulfill({ status: 200, headers, json: [] }); return;
        }
        await route.fulfill({ status: 404, headers, json: { error: 'GAME_API_FIXTURE_ONLY' } }); return;
      }
      if (url.origin === app) {
        if (url.pathname === '/src/online/auth.ts') controllerRequests++;
        await route.continue(); return;
      }
      if (url.origin === auth && /^\/auth\/v1\/(settings|signup|token|verify|user|logout|recover)$/.test(url.pathname)) {
        await route.continue(); return;
      }
      await route.abort('blockedbyclient');
    });
    const email = `browser-${randomUUID()}@auth-email-proof.test`;
    const password = `Aa1!${randomBytes(18).toString('hex')}`;
    const replacement = `Bb2!${randomBytes(18).toString('hex')}`;
    privateValues.push(email, password, replacement);
    const seen = new Set<string>();
    const mailRequest = async (path: string) => {
      if (!/^\/api\/v1\/(messages\?limit=100|message\/[a-zA-Z0-9-]+)$/.test(path)) throw new Error('LOCAL_MAIL_PATH_REQUIRED');
      const response = await fetch(mailbox + path, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('LOCAL_MAIL_UNAVAILABLE');
      return response.json();
    };
    const readMail = async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const listing = await mailRequest('/api/v1/messages?limit=100');
        const message = (listing.messages ?? []).find((item: { ID: string; To?: Array<{ Address: string }> }) => !seen.has(item.ID) && item.To?.some(recipient => recipient.Address === email));
        if (message) { seen.add(message.ID); return mailRequest('/api/v1/message/' + encodeURIComponent(message.ID)); }
        await delay(200);
      }
      throw new Error('LOCAL_MAIL_TIMEOUT');
    };

    stage = 'SIGNUP_NAVIGATION';
    await page.goto(app + '/?online=salas');
    stage = 'SIGNUP_OPEN_FORM';
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    stage = 'SIGNUP_FILL_FORM';
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByLabel('Confirmar senha', { exact: true }).fill(password);
    const signupWait = waitAuth('signup');
    stage = 'SIGNUP_SUBMIT';
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    const signup = await signupWait;
    const created = await signup.json();
    const id = created.id ?? created.user?.id;
    check(signup.status() === 200 && typeof id === 'string' && !created.access_token && controllerRequests > 0, 'SIGNUP_REAL_CONTROLLER', signup.status());
    await visible(page.getByRole('heading', { name: 'Verifique sua identidade' }));
    check(profileRequests === 0, 'UNCONFIRMED_GAME_GATE');
    stage = 'CONFIRMATION_MAIL';
    const confirmation = await readMail();
    const codes = [...String(confirmation.HTML ?? '').matchAll(/>\s*(\d{6})\s*</g)].map(match => match[1]);
    check(codes.length === 1, 'REAL_CONFIRMATION_MAIL');
    privateValues.push(codes[0]);
    await page.getByLabel('Código de 6 dígitos').fill(codes[0]);
    const verificationWait = waitAuth('verify');
    await page.getByRole('button', { name: 'Confirmar código' }).click();
    const verification = await verificationWait;
    const verified = await rememberSession(verification);
    check(verification.status() === 200 && verified.user?.id === id && verified.user?.email_confirmed_at, 'OTP_CONFIRMS_ORIGINAL_USER', verification.status());
    stage = 'PROFILE_AFTER_CONFIRMATION';
    await visible(page.getByRole('heading', { name: 'Configure seu perfil' }));
    check(profileRequests > 0, 'AUTH_REAL_GAME_API_STUBBED');
    stage = 'SESSION_RELOAD';
    await page.reload();
    await visible(page.getByRole('heading', { name: 'Configure seu perfil' }));
    check(profileRequests > 1, 'SESSION_RESTORED_ON_RELOAD');
    stage = 'PASSWORD_LOGIN';
    await signOut();
    const login = await signIn(email, password);
    const logged = await rememberSession(login);
    check(login.status() === 200 && logged.user?.id === id, 'PASSWORD_LOGIN_SAME_USER', login.status());
    await visible(page.getByRole('heading', { name: 'Configure seu perfil' }));
    await signOut();

    stage = 'RECOVERY_EMAIL_UI';
    // UI cooldown is component memory; reload clears it. The isolated server rate is 1 second.
    await page.reload();
    await delay(1100);
    await page.getByRole('button', { name: /Esqueci minha senha/ }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    const recoverWait = waitAuth('recover');
    await page.getByRole('button', { name: 'Enviar link de recuperação' }).click();
    const recovery = await recoverWait;
    check(recovery.status() === 200, 'RECOVERY_REQUEST_REAL_CONTROLLER', recovery.status());
    await visible(page.locator('.auth-terminal [role="status"]').filter({ hasText: 'Se este endereço estiver associado' }));
    stage = 'RECOVERY_LINK';
    const mail = await readMail();
    const links = [...String(mail.HTML ?? '').matchAll(/href=["']([^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&'));
    const recoveryLink = links.find(value => {
      try { const url = new URL(value); return url.origin === auth && url.pathname === '/auth/v1/verify' && url.searchParams.get('type') === 'recovery'; } catch { return false; }
    });
    check(Boolean(recoveryLink), 'REAL_RECOVERY_MAIL');
    privateValues.push(recoveryLink!);
    const verifyLinkWait = waitAuth('verify', 'GET');
    const exchangeWait = waitAuth('token', 'POST', 'pkce');
    // Keep the private ConfirmationURL out of Playwright navigation call logs.
    await page.evaluate(url => { location.assign(url); }, recoveryLink!);
    const redirect = await verifyLinkWait;
    const destination = new URL(redirect.headers().location ?? '', app);
    check(redirect.status() === 303 && destination.origin === app && destination.searchParams.get('online') === 'salas'
      && destination.searchParams.get('auth') === 'recovery' && destination.searchParams.has('code'), 'RECOVERY_REDIRECT_PRESERVES_CONTROLLER_ROUTE', redirect.status());
    const exchange = await exchangeWait;
    const recovered = await rememberSession(exchange);
    check(exchange.status() === 200 && recovered.user?.id === id, 'REAL_PKCE_CALLBACK_EXCHANGE', exchange.status());
    stage = 'RECOVERY_FORM';
    await visible(page.getByLabel('Nova senha', { exact: true }));
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('code'));
    await page.getByLabel('Nova senha', { exact: true }).fill(replacement);
    await page.getByLabel('Confirmar senha', { exact: true }).fill(replacement);
    const updateWait = waitAuth('user', 'PUT');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    const update = await updateWait;
    check(update.status() === 200, 'PASSWORD_UPDATE_REAL_HTTP', update.status());
    await visible(page.getByRole('heading', { name: 'Senha salva', exact: true }));
    check(await page.getByRole('button', { name: 'Sair da conta', exact: true }).count() === 0, 'PASSWORD_UPDATE_LOGGED_OUT');
    await page.getByRole('button', { name: 'Voltar para entrar' }).click();
    stage = 'OLD_PASSWORD_REJECTED';
    const oldLogin = await signIn(email, password);
    check(oldLogin.status() === 400, 'OLD_PASSWORD_REJECTED', oldLogin.status());
    await visible(page.getByRole('alert').filter({ hasText: 'Não foi possível entrar' }));
    stage = 'NEW_PASSWORD_LOGIN';
    const newLogin = await signIn(email, replacement);
    const renewed = await rememberSession(newLogin);
    check(newLogin.status() === 200 && renewed.user?.id === id, 'NEW_PASSWORD_LOGIN_SAME_USER', newLogin.status());
    await visible(page.getByRole('heading', { name: 'Configure seu perfil' }));
    await signOut();
    check(!privateValues.some(value => value && browserMessages.some(message => message.includes(value))), 'NO_PRIVATE_CONSOLE_OUTPUT');
    process.stdout.write(`PASS AUTH_BROWSER_CHECKS_${passed}\n`);
  } catch (cause) {
    // Never propagate Playwright call logs, private URLs, mail, input values or SDK exception text.
    process.stdout.write(`FAIL AUTH_BROWSER_${stage}\n`);
    process.stdout.write(`FAIL AUTH_BROWSER_${cause instanceof Error && cause.name === 'TimeoutError' ? 'TIMEOUT' : 'EXCEPTION'}\n`);
    throw new Error(`AUTH_BROWSER_${stage}_FAILED`);
  }
});
