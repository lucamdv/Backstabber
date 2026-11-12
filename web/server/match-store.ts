import { randomInt, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { actions, characters } from '../src/game/application/contracts.js';
import type { OnlineCommand, OnlineEnvelope } from '../src/game/application/online-contracts.js';
import { ApiError } from './errors.js';
import { createOnlineGame, onlineTransition, onlineView } from './online-engine.js';
import type { OnlineState, Participant } from './online-engine.js';
import { HOST_ABANDONMENT_SECONDS } from './room-policy.js';

const random = () => randomInt(0x100000000) / 0x100000000;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const shortId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80;

export async function createMatch(tx: PoolClient, roomId: string, participants: Participant[]) {
  const id = randomUUID();
  await tx.query('insert into public.bs_matches (id, room_id, state) values ($1, $2, $3)',
    [id, roomId, createOnlineGame(participants, random)]);
  return id;
}

function parseCommand(command: unknown): OnlineCommand {
  if (!record(command) || 'playerId' in command) throw new ApiError('INVALID_COMMAND');
  switch (command.type) {
    case 'select-action': {
      const action = actions.find(value => value === command.action);
      if (!action || (command.targetId !== undefined && !shortId(command.targetId))) break;
      return { type: command.type, action, targetId: command.targetId };
    }
    case 'lose':
      if (shortId(command.cardId)) return { type: command.type, cardId: command.cardId };
      break;
    case 'negotiate':
      if (Array.isArray(command.keepIds) && command.keepIds.length <= 2 && command.keepIds.every(shortId)) {
        return { type: command.type, keepIds: command.keepIds };
      }
      break;
    case 'vote': {
      const { choice, windowId } = command;
      if (!record(choice) || !shortId(windowId)) break;
      if (choice.kind === 'accept' || choice.kind === 'challenge' || choice.kind === 'acknowledge') {
        return { type: command.type, windowId, choice: { kind: choice.kind } };
      }
      const character = characters.find(value => value === choice.character);
      if (choice.kind === 'block' && character) {
        return { type: command.type, windowId, choice: { kind: 'block', character } };
      }
    }
  }
  throw new ApiError('INVALID_COMMAND');
}

function parseEnvelope(body: Record<string, unknown>): OnlineEnvelope {
  if (body.protocolVersion !== 1) throw new ApiError('UNSUPPORTED_PROTOCOL');
  if (!shortId(body.commandId) || typeof body.expectedRevision !== 'number'
    || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new ApiError('INVALID_COMMAND');
  return { protocolVersion: 1, commandId: body.commandId, expectedRevision: body.expectedRevision,
    command: parseCommand(body.command) };
}

export async function matchRoute(tx: PoolClient, userId: string, method: string, path: string, body: Record<string, unknown>) {
  const route = /^\/matches\/([^/]+)(?:\/(commands|rematch))?$/.exec(path);
  if (!route) return undefined;
  const [, id, sub] = route;
  if (!uuidPattern.test(id)) throw new ApiError('NOT_FOUND', 404);
  if (method !== (sub ? 'POST' : 'GET')) throw new ApiError('METHOD_NOT_ALLOWED', 405);
  // Both room lifecycle changes and match commands acquire the room lock first.
  if (sub) {
    await tx.query(`select r.id from public.bs_rooms r join public.bs_matches m on m.room_id = r.id
      join public.bs_room_members u on u.room_id = r.id
      where m.id = $1 and u.user_id = $2 for update of r`, [id, userId]);
  }
  const result = await tx.query<{ state: OnlineState; host_id: string | null; status: string; host_abandoned: boolean }>(
    `select m.state, r.host_id, r.status, not exists (
      select 1 from public.bs_room_members h where h.room_id = r.id and h.user_id = r.host_id
      and h.last_seen > now() - make_interval(secs => $3::int)
    ) as host_abandoned from public.bs_matches m
      join public.bs_rooms r on r.id = m.room_id
      join public.bs_room_members u on u.room_id = r.id
      where m.id = $1 and u.user_id = $2${sub ? ' for update of m' : ''}`, [id, userId, HOST_ABANDONMENT_SECONDS]);
  const row = result.rows[0];
  if (!row) throw new ApiError('NOT_FOUND', 404);
  const { state, host_id: hostId, status } = row;
  if (!sub) return onlineView(state, userId, hostId ?? '', status === 'closed' || hostId === null, row.host_abandoned);
  if (sub === 'rematch') {
    if (userId !== hostId) throw new ApiError('NOT_AUTHORIZED', 403);
    if (status !== 'started' || state.window || state.game.phase.kind !== 'finished') throw new ApiError('INVALID_PHASE', 409);
    const next = createOnlineGame(state.game.players, random);
    next.round = state.round + 1;
    next.game.revision = state.game.revision + 1;
    next.audit = state.audit;
    await tx.query('update public.bs_matches set state = $2 where id = $1', [id, next]);
    return onlineView(next, userId, hostId, false);
  }
  const message = parseEnvelope(body);
  const fingerprint = JSON.stringify(message);
  const previous = (await tx.query<{ fingerprint: string; result: { ok: true; revision: number } }>(
    `select fingerprint, result from public.bs_match_commands
      where match_id = $1 and user_id = $2 and command_id = $3`, [id, userId, message.commandId])).rows[0];
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new ApiError('INVALID_COMMAND');
    return previous.result;
  }
  if (status !== 'started' || !hostId) throw new ApiError('INVALID_PHASE', 409);
  const next = onlineTransition(state, userId, message.command, message.expectedRevision, random);
  if (!next.ok) throw new ApiError(next.error, next.error === 'NOT_AUTHORIZED' ? 403 : 409);
  const response = { ok: true, revision: next.state.game.revision };
  await tx.query('update public.bs_matches set state = $2 where id = $1', [id, next.state]);
  await tx.query(`insert into public.bs_match_commands (match_id, user_id, command_id, fingerprint, result)
    values ($1, $2, $3, $4, $5)`, [id, userId, message.commandId, fingerprint, response]);
  return response;
}
