import { useEffect, useRef, useState } from 'react';
import type { GameView } from '../game/application/contracts';

type Player = GameView['players'][number];
type PresenceNotice = { round: number; dropped: Player[]; returned: Player[] };
export type SyncIssue = 'offline' | 'api' | 'unstable' | 'realtime';
export type LocalConnection = SyncIssue | 'restored';

export function usePlayerConnectionTransitions(
  round: number, players: Player[], viewerId: string, connectedIds: string[], memberIds?: string[],
) {
  const previous = useRef<{ round: number; statuses: Map<string, boolean> }>(undefined);
  const [notice, setNotice] = useState<PresenceNotice>();

  useEffect(() => {
    const baseline = previous.current?.round === round ? previous.current.statuses : undefined;
    const statuses = new Map<string, boolean>();
    const dropped: Player[] = [];
    const returned: Player[] = [];
    for (const player of players) {
      if (memberIds && !memberIds.includes(player.id)) continue;
      const connected = connectedIds.includes(player.id);
      statuses.set(player.id, connected);
      const before = baseline?.get(player.id);
      if (player.id === viewerId || before === undefined || before === connected) continue;
      (connected ? returned : dropped).push(player);
    }
    previous.current = { round, statuses };
    if (dropped.length || returned.length) setNotice({ round, dropped, returned });
  }, [connectedIds, memberIds, players, round, viewerId]);

  useEffect(() => {
    if (!notice || notice.round !== round) return;
    const timer = window.setTimeout(() => setNotice(undefined), notice.dropped.length ? 4000 : 3000);
    return () => window.clearTimeout(timer);
  }, [notice, round]);

  return notice?.round === round ? notice : undefined;
}

export function SignalIcon({ connected }: { connected?: boolean }) {
  return <span aria-hidden="true" className="online-signal-icon" data-signal={connected ? 'up' : 'down'}>
    {connected ? '●' : '⊘'}
  </span>;
}

const localMessages: Record<LocalConnection, { title: string; detail: string }> = {
  offline: { title: 'Sinal interrompido', detail: 'Tentando restabelecer sua conexão com a arena…' },
  api: { title: 'Serviço temporariamente indisponível', detail: 'Tentando sincronizar a partida…' },
  unstable: { title: 'Conexão instável', detail: 'Tentando sincronizar a partida…' },
  realtime: { title: 'Canal em tempo real instável', detail: 'A partida continua sincronizando por consultas.' },
  restored: { title: 'Você voltou à rede', detail: 'Conexão restabelecida.' },
};

function participantNames(players: Player[]) {
  const names = players.slice(0, 2).map(player => player.name);
  if (players.length > 2) names.push(`mais ${players.length - 2}`);
  return new Intl.ListFormat('pt-BR').format(names);
}

export function OnlineConnectionFeed({ notice, local }: { notice?: PresenceNotice; local?: LocalConnection }) {
  const connection = local && localMessages[local];
  const events = connection ? [{ connected: local === 'restored', ...connection }] : [
    notice?.dropped.length ? {
      connected: false, title: 'Conexão interrompida',
      detail: `${participantNames(notice.dropped)} ${notice.dropped.length === 1 ? 'saiu' : 'saíram'} da rede.`,
    } : undefined,
    notice?.returned.length ? {
      connected: true, title: 'Conexão restabelecida',
      detail: `${participantNames(notice.returned)} ${notice.returned.length === 1 ? 'voltou' : 'voltaram'} à mesa.`,
    } : undefined,
  ].filter(event => event !== undefined);
  return <div className="online-connection-feed" role="status" aria-atomic="true">
    {events.map(event => <div className="online-connection-toast" data-signal={event.connected ? 'up' : 'down'}
      data-duration={local && local !== 'restored' ? 'persistent' : notice?.dropped.length && !local ? 'drop' : 'return'}
      key={event.title + event.detail}>
      <SignalIcon connected={event.connected} />
      <div><strong>{event.title}</strong><span>{event.detail}</span></div>
    </div>)}
  </div>;
}
