import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const sizes = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [800, 720],
  [768, 1024], [390, 844], [360, 800], [844, 390], [667, 375]];
const output = process.env.BACKSTABBER_LOCAL_VISUAL_OUTPUT;
const access = 'ACESSAR TERMINAL';

async function openTable(page: Page, names: string[]) {
  // A shuffle that keeps the original deck order deals Broker to Ada and
  // Mercenário and Broker to Bia, while Caio has no Magnata.
  await page.addInitScript(() => { Math.random = () => 0.999; });
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto('./', { waitUntil: 'commit' });
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Jogar', exact: true }).click();
  await page.locator('#player-count').selectOption(String(names.length));
  for (const [index, name] of names.entries()) await page.locator(`#player${index + 1}`).fill(name);
  await page.getByRole('button', { name: 'ESTABELECER CONEXÃO' }).click();
  await expect(page.locator('.local-arena')).toBeVisible();
}

async function checkArena(page: Page, scene: string) {
  for (const selector of ['.hud-header', '.playmat-arena']) {
    await expect(page.locator(selector), `${scene} ${selector}`).toBeInViewport({ ratio: 0.99 });
  }
  const actions = page.locator('#action-panel');
  if (!await actions.isHidden()) await expect(actions, scene).toBeInViewport({ ratio: 0.99 });
  await expect.poll(() => page.evaluate(() => [document.documentElement.scrollWidth - innerWidth,
    document.documentElement.scrollHeight - innerHeight, scrollX, scrollY]), scene).toEqual([0, 0, 0, 0]);
}

async function stageInPlaymat(page: Page, name: string | RegExp) {
  const stage = page.getByRole('region', { name });
  await expect(stage).toHaveClass(/\blocal-stage-panel\b/);
  const frame = await stage.evaluate(element => {
    const stage = element.getBoundingClientRect();
    const mat = element.closest('.playmat-arena')?.getBoundingClientRect();
    const list = element.querySelector('#target-actions, #reaction-actions, #negotiation-cards, #loss-cards');
    return { stage: stage.toJSON(), mat: mat?.toJSON(), list: list?.getBoundingClientRect().toJSON(),
      columns: list ? getComputedStyle(list).gridTemplateColumns : undefined };
  });
  await expect(stage, JSON.stringify(frame)).toBeInViewport({ ratio: 0.99 });
  const { stage: box, mat } = frame;
  if (!mat) throw new Error(`Decisão fora do palco: ${name}`);
  expect(box.left, JSON.stringify(frame)).toBeGreaterThanOrEqual(mat.left - 1);
  expect(box.right, JSON.stringify(frame)).toBeLessThanOrEqual(mat.right + 1);
  expect(box.top, JSON.stringify(frame)).toBeGreaterThanOrEqual(mat.top - 1);
  expect(box.bottom, JSON.stringify(frame)).toBeLessThanOrEqual(mat.bottom + 1);
  await checkArena(page, String(name));
  return stage;
}

async function checkCards(cards: Locator, count: number, minWidth: number, art: RegExp) {
  await expect(cards).toHaveCount(count);
  for (const card of await cards.all()) {
    await expect(card).toBeInViewport({ ratio: 0.99 });
    await expect(card).toHaveCSS('background-image', art);
    const box = await card.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(minWidth);
    expect(box?.height).toBeGreaterThanOrEqual(minWidth * 1.2);
  }
}

async function clickInView(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.99 });
  await control.click();
}

async function handoff(page: Page, name: RegExp) {
  const protection = page.getByRole('dialog', { name });
  const hand = page.locator('#player-hand');
  await expect(protection).toBeVisible();
  await expect(hand.locator('.carta:not(.carta-verso)')).toHaveCount(0);
  return protection.getByRole('button', { name: access });
}

async function capture(page: Page, name: string) {
  const width = page.viewportSize()?.width;
  if (output && (width === 1366 || width === 390)) {
    await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('.local-arena .carta')];
      const urls = cards.flatMap(card => [...getComputedStyle(card).backgroundImage.matchAll(/url\("([^"]+)"\)/g)]
        .map(match => match[1]));
      await Promise.all([...new Set(urls)].map(async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
      }));
    });
    await page.screenshot({ path: `${output}/local-${name}-${width}.png`, animations: 'disabled' });
  }
}

test('a introdução termina na passagem protegida', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openTable(page, ['Ada', 'Bia']);
  const intro = page.locator('#intro-overlay');
  await expect(intro).toBeVisible();
  await expect(page.locator('#player-hand .carta:not(.carta-verso)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: access })).toHaveCount(0);
  await capture(page, 'introducao');
  await expect(intro).toBeHidden();
  await expect(await handoff(page, /Ada, assuma o terminal/)).toBeInViewport({ ratio: 0.99 });
});

for (const [width, height] of sizes) {
  test.describe(`${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width <= 900 });

    test('arena local, proteção e decisões integradas', async ({ page }) => {
      test.setTimeout(60_000);
      await openTable(page, ['Ada', 'Bia', 'Caio']);
      const hand = page.locator('#player-hand');
      const minHandWidth = width >= 1280 ? 88 : height < 450 ? 44 : 64;
      const minStageWidth = height < 450 ? 48 : 65;
      const backs = /verso_card\.png/;
      const faces = /(?:broker|mercenario|sentinela|magnata|executor)_card\.png/;
      const firstAccess = await handoff(page, /Ada, assuma o terminal/);
      await checkArena(page, 'passagem inicial');
      await checkCards(hand.locator('.carta-verso'), 2, minHandWidth, backs);
      await capture(page, 'cartas-viradas');
      await clickInView(firstAccess);
      await checkCards(hand.getByRole('img', { name: 'Broker', exact: true }), 2, minHandWidth, faces);
      await checkArena(page, 'mão revelada');
      await expect(page.locator('html')).toHaveCSS('touch-action', /manipulation|pinch-zoom/);
      await expect(page.locator('body')).toHaveCSS('touch-action', /manipulation|pinch-zoom/);
      await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute('content', /user-scalable=no|maximum-scale=1(?:,|$)/i);
      for (const action of await page.locator('#action-panel button').all()) {
        await expect(action).toBeInViewport({ ratio: 0.99 });
      }
      await capture(page, 'cartas-reveladas');

      await clickInView(page.locator('#btn-steal'));
      const targets = await stageInPlaymat(page, /Alvo para/);
      await expect(targets.getByRole('button', { name: 'Alvo: Ada' })).toHaveCount(0);
      await expect(targets.getByRole('button', { name: 'Alvo: Bia' })).toBeInViewport({ ratio: 0.99 });
      await capture(page, 'alvos');
      await clickInView(targets.getByRole('button', { name: 'Cancelar Operação' }));
      await expect(hand.getByRole('img', { name: 'Broker', exact: true })).toHaveCount(2);

      await clickInView(page.locator('#btn-income'));
      const income = await stageInPlaymat(page, 'Renda recebida');
      await capture(page, 'renda');
      await clickInView(income.getByRole('button', { name: 'Continuar', exact: true }));
      const biaAccess = await handoff(page, /Passe o dispositivo para Bia/);
      await expect(hand.locator('.carta-verso')).toHaveCount(2);
      await clickInView(biaAccess);

      await clickInView(page.locator('#btn-steal'));
      await clickInView((await stageInPlaymat(page, /Alvo para/)).getByRole('button', { name: 'Alvo: Ada' }));
      const reaction = await stageInPlaymat(page, 'Momento de Reação!');
      await checkCards(reaction.locator('.carta-declarada'), 1, minStageWidth, faces);
      await expect(reaction.locator('[data-slot="acao"]')).toContainText('Bia');
      await expect(reaction.locator('#btn-accept-action')).toBeInViewport({ ratio: 0.99 });
      await capture(page, 'declaracao');
      await clickInView(reaction.getByRole('button', { name: 'Ada - Bloquear (Broker)' }));
      const block = await stageInPlaymat(page, 'Contestar Defesa!');
      await checkCards(block.locator('.carta-declarada'), 2, minStageWidth, faces);
      const [declared, blocked] = await block.locator('.carta-declarada').all();
      const [declarationBox, blockBox] = await Promise.all([declared.boundingBox(), blocked.boundingBox()]);
      expect(declarationBox!.x + declarationBox!.width).toBeLessThanOrEqual(blockBox!.x + 1);
      await expect(block.locator('[data-slot="bloqueio"]')).toContainText('Ada');
      await capture(page, 'confronto');
      await clickInView(block.locator('#btn-accept-action'));

      await clickInView(await handoff(page, /Passe o dispositivo para Caio/));
      await clickInView(page.locator('#btn-tax'));
      await clickInView((await stageInPlaymat(page, 'Momento de Reação!')).getByRole('button', { name: 'Ada - Contestar!' }));
      const bluff = await stageInPlaymat(page, 'Blefe descoberto!');
      await expect(bluff.locator('.declared-card.is-lie')).toBeVisible();
      await capture(page, 'blefe');
      await clickInView(bluff.getByRole('button', { name: 'Aplicar resultado' }));

      const loss = await stageInPlaymat(page, 'Caio, proteja sua mão');
      await checkCards(loss.locator('#loss-cards .carta-verso'), 2, minStageWidth, backs);
      await expect(loss.getByRole('button', { name: /^Perder / })).toHaveCount(0);
      await capture(page, 'perda-viradas');
      await clickInView(loss.getByRole('button', { name: 'VIRAR MINHAS CARTAS' }));
      const losses = loss.getByRole('button', { name: /^Perder / });
      await checkCards(losses, 2, minStageWidth, faces);
      await capture(page, 'perda-reveladas');
      await clickInView(losses.first());

      await clickInView(await handoff(page, /Passe o dispositivo para Ada/));
      await clickInView(page.locator('#btn-negotiate'));
      await clickInView((await stageInPlaymat(page, 'Momento de Reação!')).getByRole('button', { name: 'Bia - Contestar!' }));
      const truth = await stageInPlaymat(page, 'Carta confirmada!');
      await expect(truth.locator('.declared-card.is-truth')).toBeVisible();
      await capture(page, 'verdade');
      await clickInView(truth.getByRole('button', { name: 'Aplicar resultado' }));
      const biaLoss = await stageInPlaymat(page, 'Bia, proteja sua mão');
      await clickInView(biaLoss.getByRole('button', { name: 'VIRAR MINHAS CARTAS' }));
      await clickInView(biaLoss.getByRole('button', { name: 'Perder Mercenário' }));

      const brokerAccess = await handoff(page, /Passe o dispositivo para Ada/);
      await expect(page.locator('#negotiation-cards .carta')).toHaveCount(0);
      await clickInView(brokerAccess);
      const broker = await stageInPlaymat(page, 'Negociação do Broker');
      const choices = broker.getByRole('button', { name: /^Manter / });
      const confirm = broker.getByRole('button', { name: 'Confirmar Negociação' });
      await checkCards(choices, 4, width <= 390 ? 100 : height < 450 ? 76 : minStageWidth, faces);
      if (width <= 390) {
        const rows = await choices.evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)));
        expect(new Set(rows).size).toBe(2);
      }
      await expect(confirm).toBeDisabled();
      await expect(confirm).toBeInViewport({ ratio: 0.99 });
      await clickInView(choices.nth(0));
      await clickInView(choices.nth(1));
      await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(confirm).toBeEnabled();
      await capture(page, 'broker');
      await clickInView(confirm);
      await expect(await handoff(page, /Passe o dispositivo para Bia/)).toBeInViewport({ ratio: 0.99 });
    });
  });
}

for (const [width, height] of [[360, 800], [667, 375]]) {
  test.describe(`mesa cheia em ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test('último alvo e última reação acessíveis sem rolar a página', async ({ page }) => {
      await openTable(page, Array.from({ length: 10 }, (_, index) => `Operador ${index + 1}`));
      await clickInView(await handoff(page, /Operador 1, assuma o terminal/));
      await clickInView(page.locator('#btn-steal'));
      const targets = await stageInPlaymat(page, /Alvo para/);
      await expect(targets.getByRole('button', { name: /^Alvo: / })).toHaveCount(9);
      await expect(targets.getByRole('button', { name: 'Cancelar Operação' })).toBeInViewport({ ratio: 0.99 });
      await targets.getByRole('button', { name: 'Alvo: Operador 10', exact: true }).click();
      const reaction = await stageInPlaymat(page, 'Momento de Reação!');
      await expect(reaction.getByRole('button', { name: /Contestar!/ })).toHaveCount(9);
      await expect(reaction.locator('#btn-accept-action')).toBeInViewport({ ratio: 0.99 });
      const last = reaction.getByRole('button', { name: 'Operador 10 - Contestar!' });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport({ ratio: 0.99 });
      await expect(reaction.locator('#btn-accept-action')).toBeInViewport({ ratio: 0.99 });
      await checkArena(page, 'reação com dez jogadores');
    });
  });
}
