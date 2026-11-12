// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

interface LegacyCard {
  personagem: string
  isRevelada: boolean
}

interface LegacyPlayer {
  cartas: LegacyCard[]
  moedas: number
}

interface LegacyGame {
  baralho: {
    cartas: LegacyCard[]
    devolver(card: LegacyCard): void
  }
  jogadores: LegacyPlayer[]
  turnoAtual: number
  acaoPendente: { acao: string } | null
  jogadorSofrendoDano: LegacyPlayer | null
  declararAcao(action: string, target?: LegacyPlayer): void
  efetivarAcaoPendente(): boolean | string
  contestar(challenger: LegacyPlayer): { verdadeiro: boolean; personagem: string }
  declararBloqueio(blocker: LegacyPlayer, role: string): void
  contestarBloqueio(challenger: LegacyPlayer): { verdadeiro: boolean; personagem: string }
}

function readLegacy(path: string) {
  return readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')
}

const classes = readLegacy('js/classes.js')

function createLegacyGame() {
  return runInNewContext(
    `Math.random = () => 0.5; ${classes}\nnew Jogo(["A", "B", "C"]);`,
  ) as LegacyGame
}

function card(personagem: string): LegacyCard {
  return { personagem, isRevelada: false }
}

it('cobra Executor na declaração, mesmo se a Sentinela comprovar o bloqueio', () => {
  const game = createLegacyGame()
  const [actor, target] = game.jogadores
  actor.moedas = 5
  target.cartas = [card('Sentinela'), card('Broker')]

  game.declararAcao('executor', target)
  expect(actor.moedas).toBe(2)

  game.declararBloqueio(target, 'sentinela')
  expect(game.contestarBloqueio(actor)).toEqual({ verdadeiro: true, personagem: 'Sentinela' })
  expect(actor.moedas).toBe(2)
  expect(game.acaoPendente).toBeNull()
  expect(game.jogadorSofrendoDano).toBe(actor)
})

it('compra a substituta antes de devolver a carta de prova ao baralho', () => {
  const game = createLegacyGame()
  const [actor, challenger] = game.jogadores
  const proof = card('Magnata')
  const replacement = card('Broker')
  actor.cartas = [proof, card('Executor')]
  game.baralho.cartas = [card('Sentinela'), replacement]

  game.declararAcao('magnata')
  expect(game.contestar(challenger)).toEqual({ verdadeiro: true, personagem: 'Magnata' })
  expect(actor.cartas.map((influence) => influence.personagem)).toEqual(['Executor', 'Broker'])
  expect(game.baralho.cartas).toContain(proof)
  expect(game.baralho.cartas).not.toContain(replacement)
  expect(game.acaoPendente?.acao).toBe('magnata')
  expect(game.jogadorSofrendoDano).toBe(challenger)
})

it('mantém a execução pendente quando a defesa blefa e pula o alvo eliminado', () => {
  const game = createLegacyGame()
  const [actor, target] = game.jogadores
  actor.moedas = 3
  target.cartas = [card('Broker')]
  game.declararAcao('executor', target)
  game.declararBloqueio(target, 'sentinela')

  expect(game.contestarBloqueio(actor)).toEqual({ verdadeiro: false, personagem: 'sentinela' })
  expect(game.jogadorSofrendoDano).toBe(target)
  expect(game.acaoPendente?.acao).toBe('executor')
  target.cartas = []

  expect(game.efetivarAcaoPendente()).toBe(true)
  expect(game.jogadorSofrendoDano).toBeNull()
  expect(game.turnoAtual).toBe(2)
  expect(actor.moedas).toBe(0)
})

it('caracteriza os rostos presentes no DOM do legado durante a passagem protegida', () => {
  const originalUrl = location.href
  const originalChildren = [...document.body.childNodes]
  const saveKeys = ['backstabber_jogo_v3', 'backstabber_log_v3', 'backstabber_cemiterio_v3']
  const originalSaves = saveKeys.map((key) => ({ key, value: localStorage.getItem(key) }))
  const page = new DOMParser().parseFromString(readLegacy('game.html'), 'text/html')
  document.body.replaceChildren(...page.body.childNodes)
  history.replaceState({}, '', '/game.html?players=2&p1=Alfa&p2=Beta')
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))

  const isolatedDocument = new AbortController()
  const addEventListener = document.addEventListener.bind(document)
  const documentListeners = vi.spyOn(document, 'addEventListener').mockImplementation(
    (event, listener) => addEventListener(event, listener, { signal: isolatedDocument.signal }),
  )
  const isolatedWindow = new AbortController()
  const addWindowListener = window.addEventListener.bind(window)
  const windowListeners = vi.spyOn(window, 'addEventListener').mockImplementation(
    (event, listener) => addWindowListener(event, listener, { signal: isolatedWindow.signal }),
  )

  try {
    runInNewContext(`Math.random = () => 0.5; ${classes}\n${readLegacy('js/engine.js')}`, {
      document,
      window,
      localStorage,
      URLSearchParams,
      setTimeout,
    })
    document.dispatchEvent(new Event('DOMContentLoaded'))
    vi.runAllTimers()

    expect(document.querySelector('#blindfold')?.classList.contains('active')).toBe(true)
    expect(document.querySelector('#player-hand')?.getAttribute('aria-label')).toBe('Influências de Alfa')
    const faces = [...document.querySelectorAll('#player-hand [role="img"]')]
    expect(faces.map((face) => face.getAttribute('aria-label'))).toEqual(['Mercenário', 'Sentinela'])
  } finally {
    isolatedDocument.abort()
    isolatedWindow.abort()
    documentListeners.mockRestore()
    windowListeners.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.replaceChildren(...originalChildren)
    history.replaceState({}, '', originalUrl)
    for (const { key, value } of originalSaves) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  }
})
