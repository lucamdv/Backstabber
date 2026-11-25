import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const screenshots = process.env.BACKSTABBER_AUTH_VISUAL_OUTPUT ?? resolve(repository, 'docs/auth/screenshots');
const viewports = [[360, 800], [390, 844], [768, 1024], [1366, 768], [1920, 1080]];
const views = [
  ['login', 'Entrar no sistema'], ['signup', 'Criar conta'],
  ['verify-email', 'Verifique sua identidade'], ['request-password', 'Recuperar acesso'],
  ['set-password', 'Definir nova senha'], ['password-saved', 'Senha salva'],
] as const;

// Browser UI fixture only: no Supabase request, Google login or real email is performed.
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
const { useState } = React;
export function useOnlineAuth() {
  const query = new URLSearchParams(location.search);
  const [view, setView] = useState(query.get('authView') || 'login');
  const [authError, setError] = useState(query.has('feedback') ? 'Código incorreto ou expirado. Solicite outro.' : '');
  const [notice, setNotice] = useState(query.has('feedback') ? 'Use o código mais recente recebido.' : '');
  const [pendingEmail, setPendingEmail] = useState('operador@example.invalid');
  const [cooldown, setCooldown] = useState(view === 'verify-email' ? 29 : 0);
  const navigate = next => { setView(next); setError(''); setNotice(''); };
  const noop = async () => {};
  return {
    supabase: {}, configuration: 'ready', api: undefined, session: null, authError,
    view, busy: false, notice, pendingEmail, cooldown, recoveryAuthorized: !query.has('unauthorized'),
    signIn: noop, signOut: noop, onNavigate: navigate,
    onGoogle: async () => setNotice('Fixture de interface: o provedor Google não foi acionado.'),
    onPasswordSignIn: async () => setError('Não foi possível entrar. Confira suas credenciais.'),
    onSignUp: async email => { setPendingEmail(email); setCooldown(29); navigate('verify-email'); },
    onConfirmEmail: async () => setError('Código incorreto ou expirado. Solicite outro.'),
    onResend: async () => { setCooldown(29); setNotice('Se houver uma confirmação pendente, você receberá um novo código.'); },
    onRequestPassword: async () => setNotice('Se este endereço estiver associado a uma conta, você receberá instruções para definir ou recuperar sua senha.'),
    onSavePassword: async () => navigate('password-saved'),
  };
}`;

async function open(page: Page, view: string, options = '') {
  const errors: string[] = [];
  const captureError = (error: Error) => errors.push(error.message);
  page.on('pageerror', captureError);
  await page.goto(`/e2e/fixtures/identity.html?scene=login&authView=${view}${options}`);
  await expect(page.locator('.auth-terminal'), errors.join('\n')).toBeVisible({ timeout: 20_000 });
  page.off('pageerror', captureError);
  await page.evaluate(() => document.fonts.ready);
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.querySelector('.online-hub')?.scrollWidth ?? 0,
    document.querySelector('.auth-terminal')?.scrollWidth ?? 0,
  ) - innerWidth)).toBeLessThanOrEqual(0);
  const overflow = await page.locator('.auth-terminal :is(input, button)').evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.left < 0 || box.right > innerWidth;
  }).length);
  expect(overflow).toBe(0);
}

test.describe('terminal de autenticação com fixture explícita', () => {
  test.skip(Boolean(process.env.BACKSTABBER_E2E_URL), 'Fixtures disponíveis somente no Vite local.');
  test.beforeEach(async ({ page }) => {
    await page.route('**/src/online/auth.ts*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
  });

  for (const [width, height] of viewports) {
    test(`seis telas acessíveis em ${width}×${height}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const [view, title] of views) {
        await open(page, view);
        const heading = page.getByRole('heading', { name: title, exact: true });
        await expect(heading).toBeFocused();
        await noHorizontalOverflow(page);
        const sizes = await page.locator('.auth-terminal input').evaluateAll(inputs => inputs.map(input => parseFloat(getComputedStyle(input).fontSize)));
        for (const fontSize of sizes) expect(fontSize, `${view}: campo deve ter ao menos 16px`).toBeGreaterThanOrEqual(16);
        if (width <= 390) {
          const primary = page.locator(view === 'password-saved' ? '.auth-terminal .auth-back' : '.auth-terminal .auth-primary');
          await expect(primary, `${view}: ação principal antes de rolar ou usar teclado`).toBeInViewport({ ratio: .99 });
          if (view === 'login') await expect(page.getByRole('button', { name: 'Continuar com Google' })).toBeInViewport({ ratio: .99 });
        }
        const controls = page.locator('.auth-terminal :is(input, button):not(:disabled)');
        for (const control of await controls.all()) {
          await page.keyboard.press('Tab');
          await expect(control).toBeFocused();
          // Native focus scrolling can round an edge by a fraction of a CSS pixel.
          await expect(control).toBeInViewport({ ratio: .99 });
        }
        await expect(page.locator('.auth-terminal')).toHaveCSS('animation-name', 'none');
        if (width === 390 || view === 'login') {
          if (width === 390 && (view === 'login' || view === 'signup')) {
            await page.screenshot({ path: resolve(screenshots, `terminal-${view}-keyboard-bottom-${width}x${height}.png`), animations: 'disabled' });
          }
          await page.locator('.online-hub').evaluate(element => { element.scrollTop = 0; });
          if (width === 390 && (view === 'login' || view === 'signup')) {
            await page.screenshot({ path: resolve(screenshots, `terminal-${view}-viewport-${width}x${height}.png`), animations: 'disabled' });
          }
          await page.screenshot({
            path: resolve(screenshots, `terminal-${view}-${width}x${height}.png`), animations: 'disabled',
            fullPage: true,
            // Expand only the capture of the fixed scroll surface, preserving the tested viewport layout.
            style: width === 390 && (view === 'login' || view === 'signup')
              ? '.online-hub { position: absolute !important; overflow: visible !important; height: auto !important; min-height: 100vh !important; }'
              : undefined,
          });
        }
      }
      expect(errors).toEqual([]);
    });
  }

  test('navegação, validação, código e recuperação sem backend ou credenciais no console', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', message => messages.push(message.text()));
    const sentinel = 'FixtureSecret1!';
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'login');
    await page.getByLabel('E-mail', { exact: true }).fill('operador@example.invalid');
    await page.getByLabel('Senha', { exact: true }).fill(sentinel);
    await page.getByRole('button', { name: 'Mostrar senha', exact: true }).click();
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar senha', exact: true }).click();
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível entrar');
    await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Continuar com Google' }).click();
    await expect(page.locator('.auth-terminal [role="status"]')).toContainText('Fixture de interface');
    await page.getByRole('button', { name: 'Cadastro', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Criar conta', exact: true })).toBeFocused();
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('');
    await page.getByLabel('E-mail', { exact: true }).fill('operador@example.invalid');
    await page.getByLabel('Senha', { exact: true }).fill('password');
    await page.getByLabel('Confirmar senha', { exact: true }).fill('password');
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('requisitos');
    await page.getByLabel('Senha', { exact: true }).fill(sentinel);
    await page.getByLabel('Confirmar senha', { exact: true }).fill(sentinel);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Verifique sua identidade' })).toBeFocused();
    await expect(page.getByRole('button', { name: /Reenviar código/ })).toBeDisabled();
    const code = page.getByLabel('Código de 6 dígitos');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await code.fill('000000');
    await page.getByRole('button', { name: 'Confirmar código' }).click();
    await expect(page.getByRole('alert')).toContainText('Código incorreto');
    await noHorizontalOverflow(page);
    await code.fill('');
    await page.screenshot({ path: resolve(screenshots, 'terminal-verification-error-390x844.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Corrigir e-mail' }).click();
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.getByRole('button', { name: /Esqueci minha senha/ }).click();
    await page.getByLabel('E-mail', { exact: true }).fill('operador@example.invalid');
    await page.getByRole('button', { name: 'Enviar link de recuperação' }).click();
    await expect(page.locator('.auth-terminal [role="status"]')).toContainText('Se este endereço estiver associado');
    await open(page, 'set-password', '&unauthorized=1');
    await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Solicitar novo link' }).click();
    await expect(page.getByRole('heading', { name: 'Recuperar acesso' })).toBeFocused();
    await open(page, 'set-password');
    await page.getByLabel('Nova senha', { exact: true }).fill(sentinel);
    await page.getByLabel('Confirmar senha', { exact: true }).fill(sentinel);
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('heading', { name: 'Senha salva' })).toBeFocused();
    await page.getByRole('button', { name: 'Voltar para entrar' }).click();
    await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('');
    expect(messages.join('\n')).not.toContain(sentinel);
    expect(messages.join('\n')).not.toContain('operador@example.invalid');
    expect(page.url()).not.toContain(sentinel);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(sentinel);
  });

  test('aviso e erro são anunciados sem perder o foco do título', async ({ page }) => {
    await open(page, 'verify-email', '&feedback=1');
    await expect(page.getByRole('alert')).toHaveAttribute('aria-atomic', 'true');
    await expect(page.getByRole('alert')).toContainText('Código incorreto');
    await expect(page.locator('.auth-terminal [role="status"]')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.auth-terminal [role="status"]')).toContainText('mais recente');
    await expect(page.getByRole('heading', { name: 'Verifique sua identidade' })).toBeFocused();
  });

  for (const width of [390, 1366]) {
    test(`prévias de emails com exemplos estáticos em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      for (const kind of ['confirmation', 'recovery']) {
        const preview = resolve(repository, `docs/auth/previews/${kind}.html`).replaceAll('\\', '/');
        await page.goto(`/@fs/${preview}`);
        await expect(page.getByText(/PRÉVIA ESTÁTICA/)).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
        const images = await page.locator('img').evaluateAll(elements => elements.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0));
        expect(images).toBe(true);
        await page.screenshot({ path: resolve(screenshots, `email-${kind}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
    });
  }
});
