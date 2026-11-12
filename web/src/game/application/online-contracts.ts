import type { Action, Character, GameView } from './contracts';

export type VoteChoice =
  | { kind: 'accept' }
  | { kind: 'challenge' }
  | { kind: 'acknowledge' }
  | { kind: 'block'; character: Character };

export type OnlineCommand =
  | { type: 'select-action'; action: Action; targetId?: string }
  | { type: 'vote'; windowId: string; choice: VoteChoice }
  | { type: 'lose'; cardId: string }
  | { type: 'negotiate'; keepIds: string[] };

export type OnlineEnvelope = {
  protocolVersion: 1;
  commandId: string;
  expectedRevision: number;
  command: OnlineCommand;
};

export type OnlineWindow = {
  id: string;
  kind: 'reaction' | 'block-reaction' | 'acknowledge';
  eligible: string[];
  responded: string[];
  options: VoteChoice[];
  summary: string;
};

export type OnlineView = GameView & {
  round: number;
  viewerId: string;
  window?: OnlineWindow;
  closed: boolean;
  canClose: boolean;
  canRematch: boolean;
};
