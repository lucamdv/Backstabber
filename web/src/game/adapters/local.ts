import type { CommandEnvelope, CommandResult, GameAdapter, GameView, PlayerId } from '../application/contracts';
import { createClientId } from '../application/clientId';
import { privateOwner, projectGame } from '../application/projection';
import { transition } from '../core/engine';
import type { GameState } from '../core/engine';

export class LocalGameAdapter implements GameAdapter {
  readonly matchId = createClientId();
  #state: GameState;
  #view: GameView;
  #viewer: PlayerId | null = null;
  #listeners = new Set<() => void>();
  #processed = new Map<string, { fingerprint: string; result: CommandResult }>();

  constructor(state: GameState, private readonly persist: (state: GameState) => void, private readonly random = Math.random) {
    this.#state = structuredClone(state);
    this.#view = projectGame(this.#state, null, true);
  }

  getSnapshot = () => this.#view;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  #publish() {
    this.#view = projectGame(this.#state, this.#viewer, true);
    this.#listeners.forEach(listener => listener());
  }

  reveal() {
    this.#viewer = privateOwner(this.#state);
    this.#publish();
  }

  conceal() {
    this.#viewer = null;
    this.#publish();
  }

  async send(message: CommandEnvelope): Promise<CommandResult> {
    const revision = this.#state.revision;
    if (message.protocolVersion !== 1 || message.matchId !== this.matchId || !message.commandId || !message.command) {
      return { ok: false, revision, error: 'INVALID_COMMAND' };
    }
    const command = message.command;
    const key = JSON.stringify([command.playerId, message.commandId]);
    const fingerprint = JSON.stringify(command, Object.keys(command).sort()) + ':' + message.expectedRevision;
    const previous = this.#processed.get(key);
    if (previous) {
      return previous.fingerprint === fingerprint ? previous.result : { ok: false, revision, error: 'INVALID_COMMAND' };
    }
    const needsPrivateAccess = ['select-action', 'select-target', 'cancel-target', 'lose', 'negotiate'].includes(command.type);
    if (needsPrivateAccess && this.#viewer !== command.playerId) {
      return { ok: false, revision, error: 'NOT_AUTHORIZED' };
    }
    const result = transition(this.#state, command, message.expectedRevision, this.random);
    if (!result.ok) return { ...result, revision };
    const previousPhase = this.#state.phase;
    this.#state = result.state;
    const next = this.#state.phase;
    if (next.kind !== 'target' && !(previousPhase.kind === 'target' && next.kind === 'action' && command.type === 'cancel-target')) {
      this.#viewer = null;
    }
    const applied = { ok: true, revision: this.#state.revision } as const;
    this.#processed.set(key, { fingerprint, result: applied });
    if (this.#processed.size > 128) this.#processed.delete(this.#processed.keys().next().value!);
    this.persist(structuredClone(this.#state));
    this.#publish();
    return applied;
  }
}
