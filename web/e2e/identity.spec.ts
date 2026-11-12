import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const widths = [[1920, 1080], [1366, 768], [800, 720], [768, 1024], [390, 844], [360, 800]];
const scenes = ['login', 'lobby', 'friends', 'profile', 'arena', 'reaction', 'victory', 'defeat'];
const baseline = process.env.BACKSTABBER_VISUAL_BASELINE === '1';
const output = process.env.BACKSTABBER_VISUAL_OUTPUT;

async function openScene(page: Page, scene: string) {
  await page.route('**/__identity-fixture?*', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="/css/style-index.css">
      ${['arena', 'reaction', 'victory', 'defeat'].includes(scene) ? `
        <link rel="stylesheet" href="/css/style-game.css">
        <link rel="stylesheet" href="/css/mobile-game.css" media="(max-width: 900px), (max-height: 600px) and (pointer: coarse)">` : ''}
      <div id="fixture"></div><script type="module" src="/@vite/client"></script>
      <script type="module">import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;</script>
      <script type="module" src="/e2e/fixtures/identity.tsx"></script>`,
  }));
  await page.goto(`/__identity-fixture?scene=${scene}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.online-hub, .online-arena')).toBeVisible();
}

test.describe('identidade online', () => {
  test.skip(Boolean(process.env.BACKSTABBER_E2E_URL), 'A página de fixtures é servida pelo Vite local.');
  test.beforeEach(async ({ page }) => {
    await page.route('**/src/online/auth.ts*', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'export const useOnlineAuth = () => ({ supabase: {}, session: null, signIn: async () => {} });',
    }));
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
  });

  for (const [width, height] of widths) {
    test(`telas e controles em ${width}×${height}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height });
      for (const scene of scenes) {
        await openScene(page, scene);
        await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth,
          document.querySelector('.online-hub')?.scrollWidth ?? 0) - innerWidth)).toBe(0);
        if (scene === 'login') await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
        if (!baseline) {
          if (scene === 'arena') await expect(page.locator('#btn-income')).toBeInViewport();
          if (scene === 'reaction') {
            await expect(page.getByRole('button', { name: 'Contestar bloqueio' })).toBeInViewport();
            await expect(page.locator('#current-player-name')).toBeInViewport({ ratio: 1 });
            await expect.poll(() => page.locator('#current-player-name').evaluate(name => {
              const heading = name.getBoundingClientRect();
              const badge = name.parentElement!.getBoundingClientRect();
              return heading.top >= badge.top && heading.bottom <= badge.bottom;
            })).toBe(true);
          }
          if (scene === 'victory' || scene === 'defeat') {
            await expect(page.getByRole('dialog', { name: scene === 'victory' ? 'VITÓRIA' : 'DERROTA' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Sair da arena' })).toBeInViewport();
          }
        }
        if (output && [1366, 390].includes(width)) {
          await page.evaluate(async () => {
            const elements = document.querySelectorAll('.online-login-art, .carta, img');
            const urls = [...elements].flatMap(element => {
              if (element instanceof HTMLImageElement) return element.src;
              return [...getComputedStyle(element).backgroundImage.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
            });
            await Promise.all([...new Set(urls)].map(async url => {
              const image = new Image();
              image.src = url;
              await image.decode();
            }));
          });
          await page.screenshot({ path: `${output}/${baseline ? 'antes' : 'depois'}-${scene}-${width}.png`, animations: 'disabled' });
        }
      }
    });
  }

  test('movimento reduzido e foco de teclado no resultado', async ({ page }) => {
    test.skip(baseline, 'O teste de foco é da nova tela de resultado.');
    await openScene(page, 'victory');
    const rematch = page.getByRole('button', { name: 'Jogar revanche' });
    await expect(rematch).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sair da arena' })).toBeFocused();
    await expect(page.locator('.online-result-field i').first()).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('.online-result-field i').first()).toBeVisible();
  });
});
