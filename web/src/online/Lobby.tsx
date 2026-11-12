import { useState } from 'react';
import { Avatar } from './Profile';
import type { Friend, Room } from './types';

export function Lobby({
  room, userId, friends, presence, busy = false, onReady, onStart, onLeave, onClose, onInvite, onCopy,
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
}) {
  const [recipient, setRecipient] = useState('');
  const me = room.members.find(player => player.id === userId);
  const host = room.hostId === userId;
  const available = friends.filter(friend => !room.members.some(member => member.id === friend.id));
  const canStart = room.status === 'lobby' && room.canStart && room.members.length >= 2
    && room.members.every(member => member.ready && member.connected);

  return <section className="online-card" aria-labelledby="lobby-title">
    <div className="online-card-heading">
      <h2 id="lobby-title">Lobby</h2>
      <span>{room.members.length}/{room.capacity} jogadores</span>
    </div>
    <div className="online-room-code">
      <p>Código da sala <strong>{room.code}</strong></p>
      <button type="button" onClick={onCopy}>Copiar link de convite</button>
    </div>
    <ul className="online-list" aria-label="Participantes">
      {room.members.map(member => <li key={member.id}>
        <Avatar profile={member} />
        <div>
          <strong>{member.displayName}{room.hostId === member.id && ' · Anfitrião'}{member.id === userId && ' · Você'}</strong>
          <small>@{member.username}</small>
        </div>
        <div className="online-member-status">
          <span className={member.connected ? 'online-good' : 'online-muted'}>
            {member.connected ? 'Conectado' : 'Desconectado'}
          </span>
          {presence?.has(member.id) && member.connected && <small>Em tempo real</small>}
          <span className={member.ready ? 'online-good' : 'online-muted'}>{member.ready ? 'Pronto' : 'Aguardando'}</span>
        </div>
      </li>)}
    </ul>
    {available.length > 0 && <form className="online-inline" onSubmit={event => {
      event.preventDefault();
      if (available.some(friend => friend.id === recipient)) onInvite(recipient);
    }}>
      <label htmlFor="invite-friend">Convidar amigo</label>
      <select id="invite-friend" value={recipient} onChange={event => setRecipient(event.target.value)} required>
        <option value="">Escolha um amigo</option>
        {available.map(friend => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}
      </select>
      <button disabled={busy || !available.some(friend => friend.id === recipient)}>Enviar convite</button>
    </form>}
    <div className="online-actions">
      <button type="button" className="online-primary" onClick={() => onReady(!me?.ready)}
        disabled={busy || !me || room.status !== 'lobby'}>{me?.ready ? 'Cancelar prontidão' : 'Estou pronto'}</button>
      {host && <button type="button" className="online-primary" onClick={onStart}
        disabled={busy || !canStart}>Iniciar partida</button>}
      <button type="button" onClick={onLeave} disabled={busy}>Sair da sala</button>
      {host && <button type="button" onClick={onClose} disabled={busy}>Encerrar sala</button>}
    </div>
    {host && !canStart && <p className="online-muted">A partida precisa de pelo menos dois jogadores, todos conectados e prontos.</p>}
  </section>;
}
