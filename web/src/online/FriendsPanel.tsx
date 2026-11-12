import { useState } from 'react';
import { Avatar } from './Profile';
import type { FriendRequest, Invite, Profile, Social } from './types';

function Identity({ profile }: { profile: Profile }) {
  return <>
    <Avatar profile={profile} />
    <div><strong>{profile.displayName}</strong><small>@{profile.username}</small></div>
  </>;
}

export function FriendsPanel({
  userId, social, busy, onSearch, onRequest, onRespond, onRemove,
}: {
  userId: string;
  social: Social;
  busy: boolean;
  onSearch: (username: string) => Promise<Profile[]>;
  onRequest: (userId: string) => void;
  onRespond: (id: string, accept: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>();
  const [searching, setSearching] = useState(false);
  const pending = social.requests.filter(request => request.status === 'pending');
  const received = pending.filter(request => request.to.id === userId);
  const sent = pending.filter(request => request.from.id === userId);

  function alreadyConnected(person: Profile) {
    return social.friends.some(friend => friend.id === person.id)
      || pending.some(request => request.from.id === person.id || request.to.id === person.id);
  }

  function requestRow(request: FriendRequest, incoming: boolean) {
    return <li key={request.id}>
      <Identity profile={incoming ? request.from : request.to} />
      <div className="online-actions">
        {incoming ? <>
          <button onClick={() => onRespond(request.id, true)} disabled={busy}>Aceitar amizade</button>
          <button onClick={() => onRespond(request.id, false)} disabled={busy}>Recusar amizade</button>
        </> : <span className="online-muted">Solicitação enviada</span>}
      </div>
    </li>;
  }

  return <section className="online-card" aria-labelledby="online-friends-title">
    <h2 id="online-friends-title">Amigos</h2>
    <form className="online-inline" onSubmit={event => {
      event.preventDefault();
      const username = query.trim().toLowerCase();
      if (!username || searching) return;
      setSearching(true);
      void onSearch(username).then(setResults).catch(() => setResults(undefined)).finally(() => setSearching(false));
    }}>
      <label htmlFor="online-search">Buscar por nome de usuário</label>
      <input id="online-search" value={query} onChange={event => setQuery(event.target.value)}
        autoComplete="off" minLength={1} maxLength={18} required />
      <button disabled={searching}>Buscar jogador</button>
    </form>
    {results && <ul className="online-list" aria-label="Resultados da busca">
      {results.length === 0 && <li>Nenhum jogador encontrado.</li>}
      {results.filter(person => person.id !== userId).map(person => <li key={person.id}>
        <Identity profile={person} />
        <button disabled={busy || alreadyConnected(person)} onClick={() => onRequest(person.id)}>Adicionar amigo</button>
      </li>)}
    </ul>}
    {pending.length > 0 && <>
      <h3>Solicitações de amizade</h3>
      <ul className="online-list" aria-label="Solicitações de amizade">
        {received.map(request => requestRow(request, true))}
        {sent.map(request => requestRow(request, false))}
      </ul>
    </>}
    <h3>Sua lista</h3>
    {social.friends.length === 0 && <p className="online-muted">Você ainda não adicionou amigos.</p>}
    <ul className="online-list" aria-label="Lista de amigos">
      {social.friends.map(friend => <li key={friend.id}>
        <Identity profile={friend} />
        <div className="online-actions">
          {friend.online !== null && <span className={friend.online ? 'online-good' : 'online-muted'}>
            {friend.online ? 'Online' : 'Offline'}
          </span>}
          <button onClick={() => onRemove(friend.id)} disabled={busy}>Remover amigo</button>
        </div>
      </li>)}
    </ul>
  </section>;
}

export function RoomInvites({ invites, busy, onRespond }: {
  invites: Invite[];
  busy: boolean;
  onRespond: (id: string, accept: boolean) => void;
}) {
  const pending = invites.filter(invite => invite.status === 'pending');
  if (pending.length === 0) return null;
  return <section className="online-card" aria-labelledby="online-invites-title">
    <h2 id="online-invites-title">Convites para sala</h2>
    <ul className="online-list" aria-label="Convites para sala">
      {pending.map(invite => <li key={invite.id}>
        <Identity profile={invite.from} />
        <div className="online-actions">
          <button onClick={() => onRespond(invite.id, true)} disabled={busy}>Entrar pelo convite</button>
          <button onClick={() => onRespond(invite.id, false)} disabled={busy}>Recusar convite</button>
        </div>
      </li>)}
    </ul>
  </section>;
}
