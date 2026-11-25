import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GameIcon } from '../components/shared/GameIcon';
import { Avatar } from './Profile';
import type { Friend, Room } from './types';

export function Lobby({
  room, userId, friends, presence, busy = false, onReady, onStart, onLeave, onClose, onInvite, onCopy, shareLink, children,
}: {
  room: Room;
  userId: string;
  friends: Friend[];
  presence?: ReadonlySet<string>;
  busy?: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onClose: () => void;
  onInvite: (id: string) => void;
  onCopy: () => void;
  shareLink?: string;
  children?: ReactNode;
}) {
  const [recipient, setRecipient] = useState('');
  const me = room.members.find(player => player.id === userId);
  const host = room.hostId === userId;
  const available = friends.filter(friend => !room.members.some(member => member.id === friend.id));
  const canStart = room.status === 'lobby' && room.canStart && room.members.length >= 2
    && room.members.every(member => member.ready && member.connected);
  const startHint = room.members.length < 2 ? 'Convide pelo menos mais um jogador.'
    : room.members.some(member => !member.connected) ? 'Aguardando jogadores desconectados retornarem.'
    : room.members.some(member => !member.ready) ? 'Todos os jogadores precisam confirmar que estão prontos.'
    : !canStart ? 'A sala ainda não está disponível para iniciar.'
    : host ? 'Todos prontos. Você pode iniciar a partida.' : 'Todos prontos. Aguarde o anfitrião iniciar a partida.';
  const previousMembers = useRef(room.members);
  const [rosterNotice, setRosterNotice] = useState('');

  useEffect(() => {
    const previous = previousMembers.current;
    previousMembers.current = room.members;
    const arrivals = room.members.filter(member => !previous.some(player => player.id === member.id));
    const departures = previous.filter(member => !room.members.some(player => player.id === member.id));
    const changes = [...arrivals.map(member => `${member.displayName} entrou`),
      ...departures.map(member => `${member.displayName} saiu`)];
    if (!changes.length) return;
    setRosterNotice(changes.join(' · '));
  }, [room.members]);

  useEffect(() => {
    if (!rosterNotice) return;
    const timer = window.setTimeout(() => setRosterNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [rosterNotice]);

  return <section className="online-card online-lobby" data-ready={canStart} aria-labelledby="lobby-title">
    <header className="online-card-heading">
      <h2 id="lobby-title"><GameIcon name="rooms" />Preparação da mesa</h2>
      <div className="online-occupancy">
        <span>{room.members.length}/{room.capacity} jogadores</span>
        <progress aria-label="Ocupação da sala" value={room.members.length} max={room.capacity} />
      </div>
    </header>
    <div className="online-actions online-lobby-start">
      <button type="button" className={host && canStart ? undefined : 'online-primary'} onClick={() => onReady(!me?.ready)}
        disabled={busy || !me || room.status !== 'lobby'}><GameIcon name="check" />{me?.ready ? 'Cancelar prontidão' : 'Estou pronto'}</button>
      {host && <button type="button" className="online-primary" onClick={onStart}
        disabled={busy || !canStart}>Iniciar partida</button>}
    </div>
    <div className="online-room-code">
      <p>Código da sala <strong>{room.code}</strong></p>
      <button type="button" onClick={onCopy}><GameIcon name="copy" />Copiar link de convite</button>
    </div>
    {shareLink && <label className="online-lobby-share">Link de convite
      <input readOnly value={shareLink} onFocus={event => event.target.select()} />
    </label>}
    <p className="online-lobby-hint" role="status">{startHint}</p>
    <div className="online-roster-notice" role="status">{rosterNotice}</div>
    <div className="online-lobby-scroll" role="region" aria-label="Conteúdo da sala" tabIndex={0}>
    <div className="online-lobby-layout">
    <section aria-labelledby="lobby-roster-title">
    <h3 id="lobby-roster-title" className="online-display-title"><GameIcon name="users" />Jogadores</h3>
    <ul className="online-list online-roster" aria-label="Participantes">
      {room.members.map(member => <li key={member.id} data-ready={member.ready} data-connected={member.connected}>
        <Avatar profile={member} />
        <div>
          <strong>{member.displayName}{member.id === userId && ' · Você'}</strong>
          <small>@{member.username}</small>
          {room.hostId === member.id && <span className="online-host-badge">Anfitrião</span>}
        </div>
        <div className="online-member-status">
          <span className={member.connected ? 'online-good' : 'online-muted'}>
            {member.connected ? 'Conectado' : 'Desconectado'}
          </span>
          {presence?.has(member.id) && member.connected && <small>Em tempo real</small>}
          <span className={member.ready ? 'online-good online-ready-badge' : 'online-muted'}>{member.ready ? 'Pronto' : 'Aguardando'}</span>
        </div>
      </li>)}
    </ul>
    </section>
    <section className="online-lobby-invite" aria-labelledby="lobby-invite-title">
      <h3 id="lobby-invite-title" className="online-display-title"><GameIcon name="send" />Convidar amigos</h3>
      {available.length > 0 ? <form className="online-stack" onSubmit={event => {
        event.preventDefault();
        if (!busy && available.some(friend => friend.id === recipient)) onInvite(recipient);
      }}>
        <label htmlFor="invite-friend">Convidar amigo</label>
        <select id="invite-friend" value={recipient} onChange={event => setRecipient(event.target.value)} required>
          <option value="">Escolha um amigo</option>
          {available.map(friend => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}
        </select>
        <button disabled={busy || !available.some(friend => friend.id === recipient)}>Enviar convite <GameIcon name="send" /></button>
      </form> : <p>Copie o link de convite para chamar mais jogadores.</p>}
    </section>
    </div>
    {children}
    <div className="online-actions online-lobby-exit">
      <button type="button" onClick={onLeave} disabled={busy}><GameIcon name="exit" />Sair da sala</button>
      {host && <button type="button" onClick={onClose} disabled={busy}>Encerrar sala</button>}
    </div>
    </div>
  </section>;
}
