import { actions, characters } from '../application/contracts';
import type { Card, Character, Declaration, Phase } from '../application/contracts';
import type { GameState } from '../core/engine';
import { deckSizeFor, validateNames } from '../core/setup';

export const saveKey = 'backstabber_react_local_v1';
const legacyKey = 'backstabber_jogo_v3';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadedGame = { state?: GameState; notice?: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const role = (value: unknown): value is Character => characters.some(character => character === value);
const action = (value: unknown) => actions.some(item => item === value);
const card = (value: unknown): value is Card => object(value) && typeof value.id === 'string' && role(value.character);
const cards = (value: unknown): value is Card[] => Array.isArray(value) && value.every(card);
const entry = (value: unknown) => object(value) && typeof value.player === 'string' && typeof value.text === 'string';
const storedPlayer = (value: unknown): value is GameState['players'][number] =>
  object(value) && typeof value.id === 'string' && typeof value.name === 'string'
  && count(value.credits) && cards(value.cards) && value.cards.length <= 2;

function isValidState(value: unknown): value is GameState {
  if (!object(value) || !count(value.revision) || !Array.isArray(value.players)
      || !value.players.every(storedPlayer) || !cards(value.deck) || !cards(value.offer)
      || !Array.isArray(value.history) || !value.history.every(entry)
      || !Array.isArray(value.cemetery) || !value.cemetery.every(role)) return false;
  const players = value.players;
  const allCards = [...value.deck, ...value.offer, ...players.flatMap(player => player.cards)];
  const size = deckSizeFor(players.length);
  if (validateNames(players.map(player => player.name)) || new Set(players.map(player => player.id)).size !== players.length
      || allCards.length !== size || new Set(allCards.map(item => item.id)).size !== size
      || characters.some(character => allCards.filter(item => item.character === character).length !== size / 5)) return false;
  const exists = (id: unknown) => players.some(player => player.id === id);
  const alive = (id: unknown) => players.some(player => player.id === id && player.cards.length);
  const declaration = (item: unknown): item is Declaration =>
    object(item) && action(item.action) && item.playerId === value.activeId
    && (item.targetId === null || (exists(item.targetId) && item.targetId !== item.playerId));
  const block = (item: unknown) => object(item) && alive(item.playerId) && role(item.character);
  const phase = value.phase;
  const event = value.lastEvent;
  if (!object(phase) || !exists(value.activeId) || (phase.kind !== 'finished' && !alive(value.activeId))
      || (phase.kind !== 'loss' && value.continuation !== null)
      || (phase.kind !== 'negotiation' && value.offer.length !== 0)
      || (event !== undefined && (!object(event) || !['income', 'backstab', 'eliminated'].includes(String(event.kind))
        || !exists(event.playerId) || (event.targetId !== undefined && !exists(event.targetId))))) return false;
  switch (phase.kind as Phase['kind']) {
    case 'action': return true;
    case 'target': return ['steal', 'assassinate', 'backstab'].some(item => item === phase.action);
    case 'reaction': return declaration(phase.declaration);
    case 'block-reaction': return declaration(phase.declaration) && block(phase.block);
    case 'loss': {
      const challenge = phase.challenge;
      return alive(phase.victimId) && (value.continuation === null || declaration(value.continuation))
        && (phase.reason === 'backstab' || phase.reason === 'execution' || (phase.reason === 'challenge'
          && object(challenge) && typeof challenge.truthful === 'boolean' && exists(challenge.challengerId)
          && exists(challenge.declarerId) && role(challenge.character) && declaration(challenge.declaration)
          && (challenge.block === undefined || block(challenge.block))));
    }
    case 'negotiation': return phase.playerId === value.activeId && value.offer.length === 2
      && phase.keep === players.find(player => player.id === value.activeId)?.cards.length;
    case 'finished': {
      const survivors = players.filter(player => player.cards.length > 0);
      return survivors.length === 1 && phase.winnerId === survivors[0].id
        && cards(phase.cards) && phase.cards.length === survivors[0].cards.length
        && phase.cards.every(item => survivors[0].cards.some(held => held.id === item.id && held.character === item.character));
    }
    default: return false;
  }
}

function legacyRole(value: unknown): Character | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/^💀\s*/u, '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return role(normalized) ? normalized : undefined;
}

function parseOptional(store: Store, key: string): unknown[] {
  try {
    const value: unknown = JSON.parse(store.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function migrate(raw: string, store: Store): GameState | undefined {
  const legacy: unknown = JSON.parse(raw);
  if (!object(legacy) || !Array.isArray(legacy.jogadores) || !object(legacy.baralho)
      || !count(legacy.turnoAtual) || legacy.acaoPendente || legacy.bloqueioPendente || legacy.jogadorSofrendoDano) return;
  let sequence = 0;
  const importCards = (value: unknown) => Array.isArray(value) ? value.map(item => ({
    id: `legacy-${++sequence}`, character: object(item) ? legacyRole(item.personagem) : undefined,
  })) : null;
  const players = legacy.jogadores.map((player: unknown, index) => object(player) ? {
    id: `p${index + 1}`, name: player.nome, credits: player.moedas, cards: importCards(player.cartas),
  } : null);
  const history = parseOptional(store, 'backstabber_log_v3').flatMap(item =>
    object(item) && typeof item.nome === 'string' && typeof item.acao === 'string'
      ? [{ player: item.nome, text: item.acao }] : []).slice(0, 5);
  const cemetery = parseOptional(store, 'backstabber_cemiterio_v3').map(legacyRole).filter(role);
  const state = {
    revision: 0, activeId: `p${legacy.turnoAtual + 1}`, players, deck: importCards(legacy.baralho.cartas),
    history, cemetery, phase: { kind: 'action' }, continuation: null, offer: [],
  };
  return isValidState(state) ? state : undefined;
}

export function loadGame(store: Store): LoadedGame {
  try {
    const current = store.getItem(saveKey);
    if (current !== null) {
      const parsed: unknown = JSON.parse(current);
      if (object(parsed) && parsed.version === 1 && isValidState(parsed.state)) {
        // Keep the finished snapshot as a marker so a stale v3 save is not imported.
        return parsed.state.phase.kind === 'finished' ? {} : { state: parsed.state };
      }
      return { notice: 'O salvamento atual é incompatível.' };
    }
    const legacy = store.getItem(legacyKey);
    if (legacy !== null) {
      const state = migrate(legacy, store);
      return state ? { state, notice: 'Partida da versão original disponível para continuar.' }
        : { notice: 'A partida antiga está incompleta ou incompatível. Abra a versão original para acessá-la.' };
    }
    return {};
  } catch {
    return { notice: 'Não foi possível ler o salvamento local.' };
  }
}

export function saveGame(store: Store, state: GameState) {
  store.setItem(saveKey, JSON.stringify({ version: 1, state }));
}
