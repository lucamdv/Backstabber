export const characters = ['magnata', 'executor', 'sentinela', 'mercenario', 'broker'] as const;
export type Character = typeof characters[number];
export const actions = ['income', 'patrocinio', 'tax', 'steal', 'assassinate', 'backstab', 'negotiate'] as const;
export type Action = typeof actions[number];
export type PlayerId = string;
export type MatchId = string;
export type Card = { id: string; character: Character };
export type Declaration = { action: Action; playerId: PlayerId; targetId: PlayerId | null };
export type Block = { playerId: PlayerId; character: Character };
export type Challenge = {
  truthful: boolean;
  challengerId: PlayerId;
  declarerId: PlayerId;
  character: Character;
  declaration: Declaration;
  block?: Block;
};
export type Phase =
  | { kind: 'action' }
  | { kind: 'target'; action: Action }
  | { kind: 'reaction'; declaration: Declaration }
  | { kind: 'block-reaction'; declaration: Declaration; block: Block }
  | { kind: 'loss'; victimId: PlayerId; reason: 'backstab' | 'execution' | 'challenge'; challenge?: Challenge }
  | { kind: 'negotiation'; playerId: PlayerId; keep: number }
  | { kind: 'finished'; winnerId: PlayerId; cards: Card[] };
export type GameCommand = { playerId: PlayerId } & (
  | { type: 'select-action'; action: Action }
  | { type: 'select-target'; targetId: PlayerId }
  | { type: 'cancel-target' }
  | { type: 'accept' }
  | { type: 'challenge' }
  | { type: 'block'; character: Character }
  | { type: 'lose'; cardId: string }
  | { type: 'negotiate'; keepIds: string[] }
);
export type PublicPlayer = { id: PlayerId; name: string; credits: number; influence: number };
export type HistoryEntry = { player: string; text: string };
export type GameEvent = { kind: 'income' | 'backstab' | 'eliminated'; playerId: PlayerId; targetId?: PlayerId };
export type PublicState = {
  revision: number;
  activeId: PlayerId;
  players: PublicPlayer[];
  deckCount: number;
  history: HistoryEntry[];
  cemetery: Character[];
  phase: Phase;
  lastEvent?: GameEvent;
};
export type PrivateState = {
  hand: Card[];
  choices: Card[];
  privatePlayerId: PlayerId | null;
  revealed: boolean;
};
export type AvailableCommands = {
  availableActions: Action[];
  targets: PlayerId[];
  challenges: PlayerId[];
  blocks: Block[];
};
export type GameView = PublicState & PrivateState & AvailableCommands;
export type CommandError = 'STALE_REVISION' | 'INVALID_COMMAND' | 'NOT_AUTHORIZED' | 'INVALID_PHASE';
export type CommandEnvelope = {
  protocolVersion: 1;
  matchId: MatchId;
  commandId: string;
  expectedRevision: number;
  command: GameCommand;
};
export type CommandResult = { ok: true; revision: number } | { ok: false; error: CommandError; revision: number };
export type SnapshotEvent = { protocolVersion: 1; type: 'snapshot'; matchId: MatchId; view: GameView };
export interface GameAdapter {
  readonly matchId: MatchId;
  getSnapshot(): GameView;
  subscribe(listener: () => void): () => void;
  send(message: CommandEnvelope): Promise<CommandResult>;
}
