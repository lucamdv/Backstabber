import { availableCommands } from '../core/engine';
import type { GameState } from '../core/engine';
import type { GameView, PlayerId } from './contracts';

export function privateOwner(state: GameState): PlayerId | null {
  switch (state.phase.kind) {
    case 'action':
    case 'target': return state.activeId;
    case 'loss': return state.phase.victimId;
    case 'negotiation': return state.phase.playerId;
    default: return null;
  }
}

export function projectGame(state: GameState, viewer: PlayerId | null, localTable = false): GameView {
  const owner = privateOwner(state);
  const current = viewer !== null && viewer === owner
    ? state.players.find(player => player.id === viewer)
    : undefined;
  const phase = state.phase;
  const options = availableCommands(state);
  const activeAccess = viewer === state.activeId || localTable;
  return structuredClone({
    revision: state.revision,
    activeId: state.activeId,
    players: state.players.map(({ id, name, credits, cards }) => ({ id, name, credits, influence: cards.length })),
    deckCount: state.deck.length,
    history: state.history,
    cemetery: state.cemetery,
    phase,
    lastEvent: state.lastEvent,
    hand: current && (phase.kind === 'action' || phase.kind === 'target') ? current.cards : [],
    choices: current && (phase.kind === 'loss' || phase.kind === 'negotiation') ? [...current.cards, ...state.offer] : [],
    privatePlayerId: localTable ? owner : current?.id ?? null,
    revealed: Boolean(current),
    availableActions: activeAccess ? options.availableActions : [],
    targets: activeAccess ? options.targets : [],
    challenges: localTable ? options.challenges : options.challenges.filter(id => id === viewer),
    blocks: localTable ? options.blocks : options.blocks.filter(block => block.playerId === viewer),
  });
}
