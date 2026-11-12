import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';
import type { OnlineView } from '../src/game/application/online-contracts';

const host = process.env.BACKSTABBER_E2E_URL;
const states = ['a', 'b', 'c'].map(id => `.auth/${id}.json`);
const usernames = (process.env.BACKSTABBER_E2E_USERNAMES ?? '').split(',').map(name => name.trim());
const configured = Boolean(host && states.every(existsSync) && usernames.length === 3 && usernames.every(Boolean));

function matchResponse(response: Response) {
  return response.ok() && response.request().method() === 'GET'
    && /\/matches\/[0-9a-f-]+\/?$/.test(new URL(response.url()).pathname);
}

async function snapshot(page: Page, predicate: (view: OnlineView) => boolean = () => true) {
  const response = await page.waitForResponse(async candidate =>
    matchResponse(candidate) && predicate(await candidate.json() as OnlineView), { timeout: 25_000 });
  return response.json() as Promise<OnlineView>;
}

test('três contas, reação em reconexão, vitória e revanche @live', async ({ browser }) => {
  test.skip(!configured, 'Configure URL autorizada, três usernames e três sessões reais.');
  test.setTimeout(600_000);
  const contexts = await Promise.all(states.map((storageState, index) => browser.newContext({
    baseURL: host, storageState, reducedMotion: 'reduce', hasTouch: index !== 0,
    viewport: index === 0 ? { width: 1920, height: 1080 } : index === 1
      ? { width: 390, height: 844 } : { width: 360, height: 800 },
  })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [a, b, c] = pages;
  const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
  try {
    await Promise.all(pages.map(page => page.goto('./#/amigos')));
    await Promise.all(pages.map(page => expect(page.getByRole('heading', { name: 'Amigos', exact: true })).toBeVisible()));
    const friend = a.getByRole('list', { name: 'Lista de amigos' }).getByRole('listitem')
      .filter({ hasText: '@' + usernames[1] });
    if (!(await friend.isVisible())) {
      await a.getByLabel('Buscar por nome de usuário').fill(usernames[1]);
      await button(a, 'Buscar jogador').click();
      await button(a, 'Adicionar amigo').click();
      await b.getByRole('list', { name: 'Solicitações de amizade' }).getByRole('listitem')
        .filter({ hasText: '@' + usernames[0] }).getByRole('button', { name: 'Aceitar amizade' }).click();
    }
    await expect(friend).toBeVisible();
    const displayName = await friend.locator('strong').innerText();
    await a.goto('./#/online');
    await a.getByLabel('Vagas').selectOption('3');
    await button(a, 'Criar sala').click();
    const roomCode = a.locator('.online-room-code strong');
    await expect(roomCode).toHaveText(/^[0-9A-F]{10}$/);
    const code = await roomCode.innerText();
    await a.getByLabel('Convidar amigo').selectOption({ label: displayName });
    await button(a, 'Enviar convite').click();
    await button(b, 'Entrar pelo convite').click();
    await c.goto(`./?sala=${code}#/online`);
    await button(c, 'Entrar por código').click();
    await Promise.all(pages.map(page => expect(page.getByRole('list', { name: 'Participantes' })
      .getByRole('listitem')).toHaveCount(3)));
    await Promise.all(pages.map(page => button(page, 'Estou pronto').click()));
    const started = a.waitForResponse(matchResponse);
    await button(a, 'Iniciar partida').click();
    const matchUrl = (await started).url();
    const guest = await browser.newContext();
    try {
      expect((await guest.request.get(matchUrl)).status()).toBe(401);
    } finally {
      await guest.close();
    }
    const views = await Promise.all(pages.map(page => snapshot(page)));
    for (const [index, view] of views.entries()) {
      expect(view.hand.length).toBe(2);
      expect('deck' in view).toBe(false);
      expect(view.players.every(player => !('cards' in player))).toBe(true);
      expect(views.some((other, otherIndex) => otherIndex !== index
        && other.hand.some(card => view.hand.some(own => own.id === card.id)))).toBe(false);
      await expect(pages[index].locator('#player-hand [role="img"]')).toHaveCount(2);
      await expect.poll(() => pages[index].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const byId = new Map(views.map((view, index) => [view.viewerId, pages[index]]));
    await a.locator('#btn-tax').click();
    await button(b, 'Não duvidar').click();
    await expect(a.getByText('Aguardando respostas — 1/2')).toBeVisible();
    await contexts[2].setOffline(true);
    const before = await snapshot(a, view => view.window?.kind === 'reaction' && view.window.responded.length === 1);
    await contexts[2].setOffline(false);
    await c.reload();
    await expect(c.locator('#player-hand [role="img"]')).toHaveCount(2);
    await button(c, 'Duvidar').click();
    let view = await snapshot(a, next => next.revision > before.revision && next.phase.kind === 'loss');
    for (const page of pages) await expect(page.getByRole('heading', { name: 'Resultado da jogada' })).toBeVisible();

    for (let step = 0; step < 160 && (view.phase.kind !== 'finished' || view.window); step++) {
      const previous = view.revision;
      const actor = byId.get(view.activeId)!;
      if (view.window) {
        const window = view.window;
        const pending = window.eligible.filter(id => !window.responded.includes(id));
        const name = window.kind === 'acknowledge' ? 'Ciente / Continuar'
          : window.kind === 'block-reaction' ? 'Aceitar bloqueio' : 'Não duvidar';
        await Promise.all(pending.map(id => button(byId.get(id)!, name).click()));
        view = await snapshot(a, next => next.revision >= previous + pending.length);
        continue;
      }
      if (view.phase.kind === 'loss') {
        await button(byId.get(view.phase.victimId)!, /^Perder /).first().click();
      } else if (view.phase.kind === 'negotiation') {
        const owner = byId.get(view.phase.playerId)!;
        for (let i = 0; i < view.phase.keep; i++) await button(owner, /^Manter /).nth(i).click();
        await button(owner, 'Confirmar Negociação').click();
      } else {
        const player = view.players.find(player => player.id === view.activeId)!;
        if (actor === a && player.credits >= 7) {
          await actor.locator('#btn-backstab').click();
          await button(actor, /^Alvo: /).first().click();
        } else {
          await actor.locator(actor === a ? '#btn-tax' : player.credits < 8 ? '#btn-income' : '#btn-negotiate').click();
        }
      }
      view = await snapshot(a, next => next.revision > previous);
    }
    expect(view.phase.kind).toBe('finished');
    expect(view.window).toBeUndefined();
    await button(a, /revanche|jogar novamente/i).click();
    await Promise.all(pages.map(page => snapshot(page, next => next.round > view.round)));
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
