import { useEffect, useRef, useState } from 'react';
import { GameIcon } from '../components/shared/GameIcon';
import { Avatar } from './Profile';
import type { FriendRequest, Invite, Profile, Social } from './types';

function Identity({ profile }: { profile: Profile }) {
  return <>
    <Avatar profile={profile} />
    <div><strong>{profile.displayName}</strong><small>@{profile.username}</small></div>
  </>;
}

function pendingInvites(invites: Invite[]) {
  return invites.filter(invite => invite.status === 'pending');
}

export function SocialOverview({ social, invites }: { social?: Social; invites: Invite[] }) {
  if (!social) return null;
  const contacts = social.friends.length;
  const online = social.friends.filter(friend => friend.online === true).length;
  const pending = pendingInvites(invites).length;
  return <ul className="online-social-stats" aria-label="Resumo de amigos">
    <li><GameIcon name="users" /><strong>{contacts}</strong> {contacts === 1 ? 'Contato' : 'Contatos'}</li>
    <li><i className="online-status-dot" data-online="true" aria-hidden="true" />
      <strong>{online}</strong> {online === 1 ? 'Amigo online' : 'Amigos online'}</li>
    <li><GameIcon name="send" /><strong>{pending}</strong> {pending === 1 ? 'Convite de sala' : 'Convites de sala'}</li>
  </ul>;
}

function RemoveContact({ friend, busy, onCancel, onConfirm }: {
  friend: Profile; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement;
    node.showModal();
    cancel.current?.focus();
    return () => {
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return <dialog ref={dialog} className="online-confirm" aria-modal="true"
    aria-labelledby="online-remove-title" aria-describedby="online-remove-description"
    onCancel={event => { event.preventDefault(); onCancel(); }}>
      <h2 id="online-remove-title">Remover contato?</h2>
      <p id="online-remove-description"><strong>{friend.displayName}</strong> será removido da sua lista de amigos.</p>
      <div className="online-actions">
        <button type="button" ref={cancel} onClick={onCancel}>Cancelar</button>
        <button type="button" className="online-primary" onClick={onConfirm} disabled={busy}>Confirmar remoção</button>
      </div>
  </dialog>;
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
  const [contactQuery, setContactQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [removingId, setRemovingId] = useState<string>();
  const contactSearch = useRef<HTMLInputElement>(null);
  const focusAfterRemoval = useRef(false);
  const removing = social.friends.find(friend => friend.id === removingId);
  const nameQuery = contactQuery.trim().toLocaleLowerCase('pt-BR');
  const usernameQuery = nameQuery.replace(/^@/, '');
  const visibleFriends = social.friends.filter(friend => (!onlineOnly || friend.online === true)
    && (friend.displayName.toLocaleLowerCase('pt-BR').includes(nameQuery)
      || (usernameQuery && friend.username.toLowerCase().includes(usernameQuery))));
  const pending = social.requests.filter(request => request.status === 'pending');
  const received = pending.filter(request => request.to.id === userId);
  const sent = pending.filter(request => request.from.id === userId);

  useEffect(() => {
    if (!removing && (removingId || focusAfterRemoval.current)) {
      setRemovingId(undefined);
      focusAfterRemoval.current = false;
      contactSearch.current?.focus();
    }
  }, [removing, removingId]);

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

  return <section className="online-contact-panel online-stack" aria-labelledby="online-friends-title">
    <h2 id="online-friends-title" className="online-display-title">Rede de contatos</h2>
    <div className="online-contact-tools">
      <div className="online-filters" role="group" aria-label="Disponibilidade dos amigos">
        <button type="button" aria-pressed={!onlineOnly} onClick={() => setOnlineOnly(false)}>Todos</button>
        <button type="button" aria-pressed={onlineOnly} onClick={() => setOnlineOnly(true)}>Online</button>
      </div>
      <label className="online-contact-search">
        <GameIcon name="search" />
        <input ref={contactSearch} type="search" aria-label="Buscar amigos" placeholder="Buscar amigo" value={contactQuery}
          onChange={event => setContactQuery(event.target.value)} />
      </label>
    </div>
    {visibleFriends.length === 0 && <div className="online-empty" role="status"><GameIcon name="users" />
      {social.friends.length === 0 ? <><strong>Sua rede está vazia</strong><p>Busque um jogador pelo nome de usuário e envie uma solicitação de amizade.</p></>
        : <strong>Nenhum contato corresponde à busca ou ao filtro.</strong>}
    </div>}
    <ul className="online-list online-contact-list" aria-label="Lista de amigos">
      {visibleFriends.map(friend => <li key={friend.id}>
        <Identity profile={friend} />
        <div className="online-actions">
          {friend.online !== null && <span className={`online-friend-status ${friend.online ? 'online-good' : 'online-muted'}`}>
            <i className="online-status-dot" data-online={friend.online} aria-hidden="true" />
            {friend.online ? 'Online' : 'Offline'}
          </span>}
          <button type="button" className="online-icon-button" aria-label={`Remover ${friend.displayName}`} title="Remover amigo"
            onClick={event => { event.currentTarget.focus(); setRemovingId(friend.id); }} disabled={busy}><GameIcon name="trash" /></button>
        </div>
      </li>)}
    </ul>
    <form className="online-inline online-add-contact" onSubmit={event => {
      event.preventDefault();
      const username = query.trim().toLowerCase();
      if (!username || searching) return;
      setSearching(true);
      void onSearch(username).then(setResults).catch(() => setResults(undefined)).finally(() => setSearching(false));
    }}>
      <label htmlFor="online-search">Buscar por nome de usuário</label>
      <input id="online-search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Nome de usuário" autoComplete="off" minLength={1} maxLength={18} required />
      <button className="online-primary" disabled={searching}><GameIcon name="addUser" />{searching ? 'Buscando…' : 'Buscar jogador'}</button>
    </form>
    {results && <ul className="online-list" aria-label="Resultados da busca">
      {!results.some(person => person.id !== userId) && <li>Nenhum jogador encontrado.</li>}
      {results.filter(person => person.id !== userId).map(person => <li key={person.id}>
        <Identity profile={person} />
        <button disabled={busy || alreadyConnected(person)} onClick={() => onRequest(person.id)}>Adicionar amigo</button>
      </li>)}
    </ul>}
    {pending.length > 0 && <div className="online-requests">
      {received.length > 0 && <section>
        <h3 className="online-display-title">Solicitações recebidas</h3>
        <ul className="online-list" aria-label="Solicitações recebidas">{received.map(request => requestRow(request, true))}</ul>
      </section>}
      {sent.length > 0 && <section>
        <h3 className="online-display-title">Solicitações enviadas</h3>
        <ul className="online-list" aria-label="Solicitações enviadas">{sent.map(request => requestRow(request, false))}</ul>
      </section>}
    </div>}
    {removing && <RemoveContact friend={removing} busy={busy} onCancel={() => setRemovingId(undefined)} onConfirm={() => {
      if (busy) return;
      focusAfterRemoval.current = true;
      setRemovingId(undefined);
      onRemove(removing.id);
    }} />}
  </section>;
}

export function RoomInvites({ invites, busy, onRespond }: {
  invites: Invite[];
  busy: boolean;
  onRespond: (id: string, accept: boolean) => void;
}) {
  const pending = pendingInvites(invites);
  if (pending.length === 0) return null;
  return <section className="online-invites" aria-labelledby="online-invites-title">
    <h2 className="online-display-title" id="online-invites-title"><GameIcon name="send" />Convites para sala</h2>
    <ul className="online-list" aria-label="Convites para sala">
      {pending.map(invite => <li key={invite.id}>
        <Identity profile={invite.from} />
        <div className="online-actions">
          <button className="online-primary" onClick={() => onRespond(invite.id, true)} disabled={busy}>Entrar pelo convite <GameIcon name="check" /></button>
          <button className="online-icon-button" onClick={() => onRespond(invite.id, false)} disabled={busy}
            aria-label="Recusar convite" title="Recusar convite"><GameIcon name="close" /></button>
        </div>
      </li>)}
    </ul>
  </section>;
}
