import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resolve } from 'node:path';

const output = process.env.BACKSTABBER_POLISH_SHOTS;
const fixture = `
const makeProfile = index => ({
  id: 'operator' + index, displayName: index ? 'Operador ' + index : 'Operadora Neon', username: 'operador' + index,
  avatarUrl: null, showOnline: index % 3 !== 0, online: index % 3 === 0 ? null : index % 3 === 1,
});
const me = makeProfile(0);
const friends = Array.from({ length: 14 }, (_, i) => makeProfile(i + 1));
const room = { id: 'room', code: '11111ABC12', status: 'lobby', capacity: 10, matchId: null, hostId: me.id,
  canStart: true, members: [me, ...friends.slice(0, 9)].map(profile => ({ ...profile, ready: true, connected: true })) };
const mode = new URLSearchParams(location.search).get('viewport');
const channel = { on() { return this; }, subscribe() { return this; } };
const supabase = { channel() { return channel; }, removeChannel() {} };
const data = { '/profile': me, '/friends': { friends, requests: [] },
  '/invites': [{ id: 'inv', roomId: 'another', status: 'pending', from: friends[0], expiresAt: '2099-01-01' }],
  '/rooms': mode === 'lobby' ? [room] : [] };
const api = { request: async path => data[path] ?? {} };
const noop = async () => {};
export function useOnlineAuth() {
  return mode === 'login' || mode === 'signup' ? {
    supabase, configuration: 'ready', session: null, authError: '', view: mode, busy: false,
    notice: '', pendingEmail: '', cooldown: 0, recoveryAuthorized: false, onNavigate: noop,
    onGoogle: noop, onPasswordSignIn: noop, onSignUp: noop,
  } : { session: { user: { id: me.id, user_metadata: {} } }, supabase, api, authError: '', signOut: noop };
}`;

async function noDocumentScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const app = document.querySelector('.online-hub')!;
    const documentRoot = document.documentElement;
    app.scrollTop = 100;
    return [documentRoot.scrollWidth - documentRoot.clientWidth, documentRoot.scrollHeight - documentRoot.clientHeight,
      app.scrollWidth - app.clientWidth, app.scrollTop, scrollX, scrollY];
  })).toEqual([0, 0, 0, 0, 0, 0]);
}

async function shot(page: Page, name: string) {
  if (output) await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
}

test.describe('viewport do hub em loopback com dados simulados', () => {
  test.skip(Boolean(process.env.BACKSTABBER_E2E_URL), 'Fixture disponível no Vite local.');
  test.beforeEach(async ({ page }) => {
    await page.route('**/src/online/auth.ts*', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
  });

  for (const [width, height] of [[1366, 768], [390, 844]]) {
    test(`Amigos mostra a lista antes da dobra e mantém a navegação em ${width}×${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('./?viewport=friends#/amigos');
      const rows = page.getByRole('list', { name: 'Lista de amigos' }).getByRole('listitem');
      await expect(rows.nth(1)).toBeInViewport({ ratio: .99 });
      await expect(page.getByRole('searchbox', { name: 'Buscar amigos' })).toBeInViewport({ ratio: .99 });
      await noDocumentScroll(page);
      await shot(page, `amigos-${width}x${height}`);
      await page.locator('.online-content').evaluate(element => element.scrollTop = element.scrollHeight);
      await expect(page.getByRole('navigation', { name: 'Modo online' })).toBeInViewport({ ratio: .99 });
      await expect(page.getByRole('textbox', { name: 'Buscar por nome de usuário' })).toBeInViewport({ ratio: .99 });
    });

    test(`Lobby mantém prontidão e início visíveis com dez jogadores em ${width}×${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('./?viewport=lobby#/online');
      const start = page.getByRole('button', { name: 'Iniciar partida' });
      const ready = page.getByRole('button', { name: 'Cancelar prontidão' });
      await expect(ready).toBeInViewport({ ratio: .99 });
      await expect(start, `Ações em ${width}×${height}`).toBeInViewport({ ratio: .99 });
      const roster = page.getByRole('region', { name: 'Conteúdo da sala' });
      await noDocumentScroll(page);
      await shot(page, `lobby-${width}x${height}`);
      await roster.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(start).toBeInViewport({ ratio: .99 });
      await expect(page.getByRole('navigation', { name: 'Modo online' })).toBeInViewport({ ratio: .99 });
      await expect.poll(() => page.locator('.online-content').evaluate(element => element.scrollTop)).toBe(0);
    });
  }

  test('ajusta Lobby ao redimensionar e girar sem perder a barra de ação', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('./?viewport=lobby#/online');
    const start = page.getByRole('button', { name: 'Iniciar partida' });
    for (const [width, height] of [[768, 1024], [844, 390], [667, 375], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await expect(start, `Ações após redimensionar para ${width}×${height}`).toBeInViewport({ ratio: .99 });
      await noDocumentScroll(page);
    }
  });

  test('mantém as ações do lobby dentro das áreas seguras emuladas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 30, right: 15, bottom: 35, left: 15 } });
    await page.goto('./?viewport=lobby#/online');
    const start = page.getByRole('button', { name: 'Iniciar partida' });
    await expect(start).toBeInViewport({ ratio: .99 });
    const action = (await start.boundingBox())!;
    expect(action.y + action.height).toBeLessThanOrEqual(844 - 35);
    expect((await page.getByRole('button', { name: 'Voltar ao menu', exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(30);
    await noDocumentScroll(page);
  });

  test('mantém a entrada e a criação de salas acessíveis ao girar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./?viewport=rooms#/online');
    for (const [width, height] of [[390, 844], [667, 375]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['Criar sala', 'Entrar por código']) {
        const control = page.getByRole('button', { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: .99 });
        await noDocumentScroll(page);
      }
      await expect(page.getByRole('navigation', { name: 'Modo online' })).toBeInViewport({ ratio: .99 });
    }
  });

  test('usa rolagem interna para cadastro com área útil reduzida e preserva zoom', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./?viewport=login#/online');
    await expect(page.getByRole('button', { name: 'Continuar com Google' })).toBeInViewport({ ratio: .99 });
    await noDocumentScroll(page);
    await page.goto('./?viewport=signup#/online');
    await expect(page.getByRole('button', { name: 'Criar conta', exact: true })).toBeInViewport({ ratio: .99 });
    await shot(page, 'cadastro-390x844');
    const confirmation = page.getByLabel('Confirmar senha', { exact: true });
    await confirmation.fill('Exemplo1!');
    await page.setViewportSize({ width: 390, height: 450 });
    await confirmation.scrollIntoViewIfNeeded();
    await expect(confirmation).toBeInViewport({ ratio: .99 });
    await expect(page.getByRole('button', { name: 'Voltar ao menu local' })).toBeInViewport({ ratio: .99 });
    await noDocumentScroll(page);
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/i);
    expect(await page.evaluate(() => getComputedStyle(document.body).touchAction)).toBe('auto');
    await shot(page, 'cadastro-area-reduzida-390x450');
  });
});
