import { expect, test } from '@playwright/test';

const output = process.env.BACKSTABBER_MOTION_OUTPUT;

for (const [scene, name] of [['pilot-impact', 'backstab-piloto'], ['impact', 'backstab-online'], ['intro', 'entrada-5-segundos'],
  ['truth-motion', 'carta-confirmada'], ['bluff-motion', 'blefe-descoberto'], ['conflict-motion', 'confronto']]) {
  test(`grava ${name}`, async ({ browser, baseURL }) => {
    test.skip(!output || Boolean(process.env.BACKSTABBER_E2E_URL), 'Gravação opcional com o Vite local.');
    test.setTimeout(45_000);
    const viewport = { width: 1366, height: 768 };
    const context = await browser.newContext({
      baseURL, viewport, reducedMotion: 'no-preference',
      recordVideo: { dir: output!, size: viewport },
    });
    const page = await context.newPage();
    try {
      await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
      await page.goto(`/e2e/fixtures/identity.html?scene=${scene}`, { waitUntil: 'commit' });
      await expect(page.locator('.arena-root')).toBeVisible({ timeout: 20_000 });
      const opening = scene === 'intro';
      if (scene.endsWith('-motion')) {
        await expect(page.locator('.online-hologram')).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event('arena-fixture-advance')));
        const state = scene === 'conflict-motion' ? '[data-slot="bloqueio"]'
          : scene === 'truth-motion' ? '.declared-card.is-truth' : '.declared-card.is-lie';
        await expect(page.locator(state)).toBeVisible();
        await page.waitForTimeout(900);
        return;
      }
      const evidence = await page.evaluate(({ opening }) => new Promise<{ layers: number; duration: number }>((resolve, reject) => {
        let mounted: { layers: number; time: number } | undefined;
        const observer = new MutationObserver(() => {
          const cinematic = document.querySelector(opening ? '.online-arena-intro' : '#backstab-cinematic');
          if (cinematic && !mounted) mounted = {
            layers: cinematic.querySelectorAll(opening ? '.intro-card, .online-intro-tunnel i'
              : '.backstab-rift-main, .backstab-shockwave').length, time: performance.now(),
          };
          if (!cinematic && mounted) {
            observer.disconnect();
            clearTimeout(timeout);
            resolve({ layers: mounted.layers, duration: performance.now() - mounted.time });
          }
        });
        const timeout = window.setTimeout(() => { observer.disconnect(); reject(Error('Cinemática não concluída')); }, 8000);
        observer.observe(document.body, { childList: true, subtree: true });
        window.dispatchEvent(new Event('arena-fixture-advance'));
      }), { opening });
      expect(evidence.layers).toBe(opening ? 10 : 2);
      expect(evidence.duration).toBeGreaterThan(opening ? 4975 : 2300);
      if (scene === 'impact') await expect(page.getByRole('button', { name: 'Ciente / Continuar' })).toBeVisible();
    } finally {
      await context.close();
      await page.video()?.saveAs(`${output}/${name}.webm`);
      await page.video()?.delete();
    }
  });
}
