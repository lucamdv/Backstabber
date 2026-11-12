import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const widths = [[1920, 1080], [1366, 768], [800, 720], [768, 1024], [390, 844], [360, 800]];
const baseline = process.env.BACKSTABBER_VISUAL_BASELINE === '1';
const socialScenes = ['login', 'lobby', 'friends', 'profile'];
const arenaScenes = ['arena', 'reaction', 'victory', 'defeat', ...(baseline ? [] : ['deal', 'income', 'backstab'])];
const scenes = [...socialScenes, ...arenaScenes];
const output = process.env.BACKSTABBER_VISUAL_OUTPUT;

async function openScene(page: Page, scene: string) {
  await page.goto(`/e2e/fixtures/identity.html?scene=${scene}`, { waitUntil: 'commit' });
  await expect(page.locator('.online-hub, .online-arena')).toBeVisible({ timeout: 20_000 });
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
        if (scene === 'login') {
          await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
          if (!baseline) {
            expect(await page.evaluate(async () => {
              const fonts = await document.fonts.load('28px "Backstabber Pixel"', 'Créditos');
              return fonts.some(font => font.status === 'loaded');
            })).toBe(true);
          }
        }
        if (!baseline) {
          if (scene === 'arena') {
            await expect(page.locator('#btn-income')).toBeInViewport();
            if (width >= 1366) {
              const hand = await page.locator('#player-hand .carta').first().boundingBox();
              expect(hand?.height).toBeGreaterThan(155);
            }
          }
          if (scene === 'backstab' || scene === 'income') {
            if (scene === 'backstab') await expect(page.getByTestId('online-backstab')).toBeVisible();
            const acknowledge = page.getByRole('button', { name: 'Ciente / Continuar' });
            await expect(acknowledge).toBeInViewport();
            await acknowledge.click();
            await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'vote');
          }
          if (scene === 'deal') {
            const income = page.locator('#btn-income');
            await expect(income).toBeInViewport();
            await income.click();
            await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'select-action');
          }
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
            const elements = document.querySelectorAll('.carta, img');
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
