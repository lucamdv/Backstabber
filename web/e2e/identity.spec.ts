import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const widths = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [800, 720], [768, 1024],
  [390, 844], [360, 800], [844, 390], [667, 375]];
const baseline = process.env.BACKSTABBER_VISUAL_BASELINE === '1';
const socialScenes = ['login', 'lobby', 'friends', 'profile'];
const arenaScenes = ['arena', 'reaction', 'victory', 'defeat', ...(baseline ? []
  : ['deal', 'income', 'backstab', 'declaration', 'contest', 'truth', 'bluff', 'loss', 'negotiation', 'targets'])];
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

  for (const [width, height, minimum, rows] of [[1920, 1080, 175, 1], [1366, 768, 136, 1], [800, 720, 130, 1],
    [390, 844, 100, 2], [360, 800, 95, 2], [667, 375, 76, 1]]) {
    test(`Broker no palco em ${width}×${height}`, async ({ page }) => {
      test.skip(baseline);
      await page.setViewportSize({ width, height });
      await openScene(page, 'negotiation');
      const stage = page.getByRole('region', { name: 'Negociação do Broker' });
      const cards = stage.getByRole('button', { name: /^Manter / });
      const confirm = stage.getByRole('button', { name: 'Confirmar Negociação' });
      await expect(cards).toHaveCount(4);
      await expect(stage.getByRole('dialog')).toHaveCount(0);
      await expect(confirm).toBeInViewport({ ratio: 1 });
      await expect(confirm).toBeDisabled();
      const geometry = await cards.evaluateAll(elements => elements.map(card => card.getBoundingClientRect().toJSON()));
      expect(new Set(geometry.map(card => Math.round(card.top))).size).toBe(rows);
      expect(Math.min(...geometry.map(card => card.width))).toBeGreaterThanOrEqual(minimum);
      for (const card of await cards.all()) await expect(card).toBeInViewport({ ratio: 1 });
      await cards.nth(0).click();
      await cards.nth(1).click();
      await cards.nth(2).click();
      await expect(cards.nth(2)).toHaveAttribute('aria-pressed', 'false');
      await cards.nth(0).click();
      await expect(confirm).toBeDisabled();
      await cards.nth(2).click();
      await expect(stage.getByText('2/2 selecionadas')).toBeVisible();
      await expect(cards.nth(2)).toHaveCSS('outline-color', 'rgb(140, 255, 182)');
      await expect(confirm).toBeInViewport({ ratio: 1 });
      const bounds = await stage.evaluate(section => {
        const mat = section.closest('.playmat-arena')!.getBoundingClientRect();
        const broker = section.getBoundingClientRect();
        return { top: broker.top - mat.top, bottom: mat.bottom - broker.bottom };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(4);
      expect(bounds.bottom).toBeGreaterThanOrEqual(4);
      await expect.poll(() => page.evaluate(() => [document.documentElement.scrollWidth - innerWidth,
        document.documentElement.scrollHeight - innerHeight, scrollX, scrollY])).toEqual([0, 0, 0, 0]);
      if (output) {
        await page.screenshot({ path: `${output}/broker-${width}x${height}.png`, animations: 'disabled' });
      }
      await confirm.click();
      await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'negotiate');
    });
  }

  test('geometria base nas dez resoluções', async ({ page }) => {
    test.skip(baseline);
    test.setTimeout(90_000);
    for (const [width, height] of widths) {
      await page.setViewportSize({ width, height });
      await openScene(page, 'arena');
      for (const selector of ['.hud-header', '.playmat-arena', '#player-hand', '#action-panel']) {
        await expect(page.locator(selector), `${width}×${height} ${selector}`).toBeInViewport({ ratio: .99 });
      }
      await expect.poll(() => page.evaluate(() => [document.documentElement.scrollWidth - innerWidth,
        document.documentElement.scrollHeight - innerHeight]), `${width}×${height}`).toEqual([0, 0]);
      await page.locator('#btn-income').click();
      await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'select-action');
    }
  });

  test('palco holográfico com declaração e confronto', async ({ page }) => {
    test.skip(baseline);
    test.setTimeout(90_000);
    for (const [width, height] of widths) {
      await page.setViewportSize({ width, height });
      for (const scene of ['declaration', 'reaction']) {
        await openScene(page, scene);
        const stage = page.locator('.online-hologram');
        const frame = await stage.evaluate(element => {
          const box = element.getBoundingClientRect();
          const mat = element.closest('.playmat-arena')!.getBoundingClientRect();
          return { scene: location.search, width: innerWidth, height: innerHeight, stage: box.toJSON(), mat: mat.toJSON() };
        });
        await expect(stage, JSON.stringify(frame)).toBeInViewport({ ratio: .99 });
        expect(frame.stage.bottom, JSON.stringify(frame)).toBeLessThanOrEqual(frame.mat.bottom);
        await expect(stage.locator('.declared-card')).toHaveCount(scene === 'reaction' ? 2 : 1);
        await expect(stage.getByRole('dialog')).toHaveCount(0);
        const vote = stage.getByRole('button', { name: scene === 'reaction' ? 'Contestar bloqueio' : 'Duvidar', exact: true });
        await expect(vote).toBeInViewport({ ratio: 1 });
        await vote.click();
        await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'vote');
      }
    }
  });

  for (const [width, height] of widths) {
    test(`telas e controles em ${width}×${height}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height });
      for (const scene of scenes) {
        await openScene(page, scene);
        await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth,
          document.querySelector('.online-hub')?.scrollWidth ?? 0) - innerWidth), `${scene} ${width}×${height}`).toBe(0);
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
          if (arenaScenes.includes(scene)) {
            await expect(page.locator('.hud-header')).toBeInViewport({ ratio: .99 });
            await expect(page.locator('.playmat-arena')).toBeInViewport({ ratio: .99 });
            await expect.poll(() => page.evaluate(() => [document.documentElement.scrollWidth - innerWidth,
              document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0]);
            const fit = await page.locator('.playmat-arena').evaluate(mat => {
              const frame = mat.getBoundingClientRect();
              const art = mat.querySelector('.online-playmat-art')!.getBoundingClientRect();
              return art.left >= frame.left && art.right <= frame.right
                && art.top >= frame.top && art.bottom <= frame.bottom;
            });
            expect(fit, `${scene} ${width}×${height} moldura`).toBe(true);
            if (scene !== 'victory' && scene !== 'defeat') {
              await expect(page.locator('#player-hand')).toBeInViewport({ ratio: .99 });
            }
          }
          if (scene === 'arena') {
            await expect(page.locator('#btn-income')).toBeInViewport();
            if (width >= 1366) {
              const hand = await page.locator('#player-hand .carta').first().boundingBox();
              expect(hand?.height).toBeGreaterThan(155);
            }
          }
          if (scene === 'backstab' || scene === 'income') {
            if (scene === 'backstab') await expect(page.getByRole('img', { name: 'BACKSTAB', exact: true })).toBeVisible();
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
          if (scene === 'contest') {
            const block = page.getByRole('button', { name: 'Bloquear com Broker' });
            await expect(block).toBeInViewport({ ratio: 1 });
            await block.click();
            await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'vote');
          }
          if (scene === 'truth' || scene === 'bluff') {
            const defense = page.locator('[data-slot="bloqueio"] .carta-declarada');
            await expect(defense).toHaveCSS('outline-color', scene === 'truth' ? 'rgb(112, 255, 158)' : 'rgb(255, 101, 118)');
            const confirm = page.getByRole('button', { name: 'Ciente / Continuar' });
            await expect(confirm).toBeInViewport({ ratio: 1 });
          }
          if (scene === 'loss') {
            const card = page.getByRole('button', { name: 'Perder Broker' });
            await expect(card).toBeInViewport({ ratio: 1 });
            await card.click();
            await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'lose');
          }
          if (scene === 'negotiation') {
            await page.getByRole('button', { name: 'Manter Broker' }).click();
            await page.getByRole('button', { name: 'Manter Magnata' }).click();
            const confirm = page.getByRole('button', { name: 'Confirmar Negociação' });
            await expect(confirm).toBeInViewport({ ratio: 1 });
            await confirm.click();
            await expect(page.locator('#fixture')).toHaveAttribute('data-command', 'negotiate');
          }
          if (scene === 'targets') {
            await page.getByRole('button', { name: /EXTORQUIR/ }).click();
            await expect(page.locator('.online-target-list button')).toHaveCount(9);
            await expect(page.getByRole('button', { name: 'Alvo: Operador 10' })).toBeInViewport({ ratio: 1 });
            await page.getByRole('button', { name: 'Alvo: Operador 10' }).click();
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
            await expect(page.getByRole('button', { name: 'Sair da arena' })).toBeInViewport({ ratio: 1 });
            if (scene === 'victory') await expect(page.getByRole('button', { name: 'Jogar revanche' })).toBeInViewport({ ratio: 1 });
          }
        }
        if (output && ([1366, 390].includes(width) || (scene === 'arena' && [1920, 800, 667].includes(width)))) {
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
