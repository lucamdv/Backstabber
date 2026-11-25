import { expect, test } from '@playwright/test';

for (const [width, height] of [[1920, 1080], [1366, 768], [768, 1024], [390, 844], [360, 800]]) {
  test(`menu, acesso online e partida local em ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Amigos', exact: true }).click();
    await expect(page).toHaveURL(/#\/amigos$/);
    await expect(page.getByRole('heading', { name: 'Entrar na rede' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole('button', { name: 'Voltar ao menu local' }).click();
    await menu.getByRole('button', { name: 'START', exact: true }).click();
    await expect(page.getByRole('button', { name: /jogar online|multiplayer online/i })).toBeVisible();
    await page.getByRole('button', { name: 'Partida local' }).click();
    const fields = page.getByRole('textbox');
    await fields.nth(0).fill('Ada QA');
    await fields.nth(1).fill('Bia QA');
    await page.getByRole('button', { name: 'ESTABELECER CONEXÃO' }).click();
    await page.getByRole('button', { name: 'ACESSAR TERMINAL' }).click();
    await expect(page.locator('#player-hand [role="img"]')).toHaveCount(2);
    await expect(page.locator('#btn-income')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      extra: document.documentElement.scrollWidth - innerWidth,
      outside: [...document.querySelectorAll('body *')].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > innerWidth + 1;
      }).slice(0, 6).map(element => element.id || element.getAttribute('class') || element.tagName),
    }))).toMatchObject({ extra: 0 });
  });
}

test('menu permite configuração cheia, Oráculo e Configurações sem rolar o documento', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('./');
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  const documentScroll = () => page.evaluate(() => {
    const root = document.documentElement;
    return [root.scrollWidth - root.clientWidth, root.scrollHeight - root.clientHeight, scrollX, scrollY];
  });
  await menu.getByRole('button', { name: 'START' }).click();
  await page.getByRole('button', { name: 'Partida local' }).click();
  await page.locator('#player-count').selectOption('10');
  const lastPlayer = page.locator('#player10');
  await lastPlayer.scrollIntoViewIfNeeded();
  await expect(lastPlayer).toBeInViewport({ ratio: .99 });
  const submit = page.getByRole('button', { name: 'ESTABELECER CONEXÃO' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport({ ratio: .99 });
  await expect.poll(documentScroll).toEqual([0, 0, 0, 0]);
  await page.getByRole('button', { name: 'Fechar painel' }).click();
  await menu.getByRole('button', { name: 'Abrir Oráculo' }).click();
  await expect(page.getByRole('dialog', { name: 'ORÁCULO' })).toBeVisible();
  await expect.poll(documentScroll).toEqual([0, 0, 0, 0]);
  await page.getByRole('button', { name: 'Fechar Oráculo' }).click();
  await menu.getByRole('button', { name: 'Configurações' }).click();
  await expect(page.getByRole('dialog', { name: 'SISTEMA' })).toBeVisible();
  await expect.poll(documentScroll).toEqual([0, 0, 0, 0]);
});
