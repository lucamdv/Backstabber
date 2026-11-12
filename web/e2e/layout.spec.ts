import { expect, test } from '@playwright/test';

for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844], [360, 800]]) {
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
    await menu.getByRole('button', { name: 'Jogar', exact: true }).click();
    await expect(page.getByRole('button', { name: /jogar online|multiplayer online/i })).toBeVisible();
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
