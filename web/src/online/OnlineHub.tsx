import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { onlineErrorMessage } from './api';
import type { OnlineApi } from './api';
import { useOnlineAuth } from './auth';
import { FriendsPanel, RoomInvites } from './FriendsPanel';
import { Lobby } from './Lobby';
import { ProfileEditor } from './Profile';
import { usePrivateBroadcast, useRoomRealtime } from './realtime';
import { onlineHash } from './routes';
import type { OnlineSection } from './routes';
import type { Invite, Profile, ProfileInput, Room, Social } from './types';
import './online.css';

export type { OnlineApi } from './api';

export type OnlineMatchProps = {
  matchId: string;
  roomId: string;
  userId: string;
  connectedIds: string[];
  api: OnlineApi;
  onExit: () => void;
  matchInvalidation: number;
};

type HubProps = {
  section?: OnlineSection;
  onNavigate?: (section: OnlineSection) => void;
  onExit: () => void;
  renderMatch: (props: OnlineMatchProps) => ReactNode;
};

const destinations = [
  { section: 'friends', label: 'Amigos' },
  { section: 'rooms', label: 'Salas e partidas' },
] as const;

function HubSurface({ onExit, onLogout, section = 'rooms', onNavigate, children }:
Pick<HubProps, 'onExit' | 'section' | 'onNavigate'> & { onLogout?: () => void; children: ReactNode }) {
  return <main className="online-hub">
    <header className="online-header">
      <div>
        <img src="images/isotipo.png" alt="" />
        <h1>Backstabber Online</h1>
      </div>
      <div className="online-actions">
        <button onClick={onExit}>Voltar ao menu</button>
        {onLogout && <button onClick={onLogout}>Sair da conta</button>}
      </div>
    </header>
    <div className="online-content">
      <nav className="online-sections" aria-label="Modo online">
        {destinations.map(destination => (
          <a key={destination.section} href={onlineHash(destination.section)}
            aria-current={section === destination.section ? 'page' : undefined}
            onClick={event => {
              if (onNavigate && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                onNavigate(destination.section);
              }
            }}>{destination.label}</a>
        ))}
      </nav>
      {children}
    </div>
  </main>;
}

function RoomEntry({ busy, onCreate, onJoin }: {
  busy: boolean; onCreate: (capacity: number) => void; onJoin: (code: string) => void;
}) {
  const [capacity, setCapacity] = useState(4);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('sala')?.slice(0, 10).toUpperCase() ?? '');

  return <section className="online-card" aria-labelledby="room-entry-title">
    <h2 id="room-entry-title">Salas privadas</h2>
    <form className="online-inline" onSubmit={event => { event.preventDefault(); onCreate(capacity); }}>
      <label htmlFor="room-capacity">Vagas</label>
      <select id="room-capacity" value={capacity} onChange={event => setCapacity(Number(event.target.value))}>
        {Array.from({ length: 9 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count}</option>)}
      </select>
      <button className="online-primary" disabled={busy}>Criar sala</button>
    </form>
    <form className="online-inline" onSubmit={event => { event.preventDefault(); onJoin(code.trim()); }}>
      <label htmlFor="room-code">Código de convite</label>
      <input id="room-code" value={code} onChange={event => setCode(event.target.value.toUpperCase())}
        pattern="[0-9A-F]{10}" maxLength={10} autoComplete="off" title="Digite os 10 caracteres do código" required />
      <button disabled={busy}>Entrar por código</button>
    </form>
  </section>;
}

function ConnectedHub({
  api, client, profile, editProfile, onExit, onLogout, authError, renderMatch, section = 'rooms', onNavigate,
}: HubProps & {
  api: OnlineApi;
  client: SupabaseClient;
  profile: Profile;
  editProfile: () => void;
  onLogout: () => void;
  authError: string;
}) {
  const [rooms, setRooms] = useState<Room[]>();
  const [selectedRoomId, selectRoomId] = useState<string>();
  const [invitedCode, setInvitedCode] = useState(() =>
    new URLSearchParams(window.location.search).get('sala')?.trim().toUpperCase() ?? null);
  const [social, setSocial] = useState<Social>();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [socialError, setSocialError] = useState('');
  const [roomError, setRoomError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [matchInvalidation, setMatchInvalidation] = useState(0);
  const roomGeneration = useRef(0);
  const socialGeneration = useRef(0);
  const room = selectedRoomId === ''
    ? undefined
    : (rooms?.find(item => item.id === selectedRoomId)
      ?? (invitedCode ? rooms?.find(item => item.code === invitedCode) : rooms?.[0]));
  const roomId = room?.id;

  const refreshRooms = useCallback(async () => {
    const generation = ++roomGeneration.current;
    try {
      const fresh = await api.request<Room[]>('/rooms');
      if (generation === roomGeneration.current) {
        setRoomError('');
        setRooms(fresh);
      }
    } catch (cause) {
      if (generation === roomGeneration.current) setRoomError(onlineErrorMessage(cause));
    }
  }, [api]);

  const refreshSocial = useCallback(async () => {
    const generation = ++socialGeneration.current;
    try {
      const [friends, latestInvites] = await Promise.all([
        api.request<Social>('/friends'), api.request<Invite[]>('/invites'),
      ]);
      if (generation === socialGeneration.current) {
        setSocialError('');
        setSocial(friends);
        setInvites(latestInvites);
      }
    } catch (cause) {
      if (generation === socialGeneration.current) setSocialError(onlineErrorMessage(cause));
    }
  }, [api]);

  const invalidateUser = useCallback(() => {
    void refreshSocial();
    void refreshRooms();
  }, [refreshSocial, refreshRooms]);

  const invalidateRoom = useCallback(() => {
    void refreshRooms();
    setMatchInvalidation(count => count + 1);
  }, [refreshRooms]);

  usePrivateBroadcast(client, `user:${profile.id}`, invalidateUser);
  const presence = useRoomRealtime(client, roomId, profile.id, invalidateRoom);

  useEffect(() => {
    const roomRequests = roomGeneration;
    const socialRequests = socialGeneration;
    const synchronize = () => {
      if (!document.hidden) invalidateUser();
    };
    synchronize();
    const interval = window.setInterval(synchronize, 12_000);
    document.addEventListener('visibilitychange', synchronize);
    window.addEventListener('online', synchronize);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', synchronize);
      window.removeEventListener('online', synchronize);
      roomRequests.current++;
      socialRequests.current++;
    };
  }, [invalidateUser]);

  useEffect(() => {
    let beatPending = false;
    const beat = () => {
      if (document.hidden || beatPending) return;
      beatPending = true;
      const requests = [api.request('/profile/heartbeat', 'POST', {})];
      if (roomId) requests.push(api.request(`/rooms/${roomId}/heartbeat`, 'POST', {}));
      void Promise.allSettled(requests).then(() => { beatPending = false; });
    };
    beat();
    const interval = window.setInterval(beat, 10_000);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('online', beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', beat);
      window.removeEventListener('online', beat);
    };
  }, [api, roomId]);

  function run(action: () => Promise<unknown>, success = '') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    void action().then(() => setNotice(success)).catch(cause => setError(onlineErrorMessage(cause))).finally(() => {
      pending.current = false;
      setBusy(false);
    });
  }

  function enter(entered: Room) {
    roomGeneration.current++;
    setRooms(current => [entered, ...(current ?? []).filter(item => item.id !== entered.id)]);
    selectRoomId(entered.id);
    setShareLink('');
    const url = new URL(window.location.href);
    if (url.searchParams.has('sala')) {
      url.searchParams.delete('sala');
      window.history.replaceState(window.history.state, '', url);
    }
    setInvitedCode(null);
  }

  async function changeRoom(operation: string, body = {}) {
    await api.request(`/rooms/${roomId}/${operation}`, 'POST', body);
    if (operation === 'leave' || operation === 'close') {
      roomGeneration.current++;
      setRooms(current => current?.filter(item => item.id !== roomId));
      selectRoomId(undefined);
      setShareLink('');
    }
    await refreshRooms();
  }

  async function copyLink(code: string) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('sala', code);
    url.hash = '/online';
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice('Link copiado.');
    } catch {
      setShareLink(url.href);
    }
  }

  if (section === 'rooms' && room?.status === 'started' && room.matchId) {
    const connectedIds = room.members.filter(member => member.connected).map(member => member.id);
    return renderMatch({
      matchId: room.matchId, roomId: room.id, userId: profile.id, connectedIds, api, onExit, matchInvalidation,
    });
  }

  const invitePanel = <RoomInvites invites={invites} busy={busy} onRespond={(id, accept) => run(async () => {
    try {
      if (accept) {
        enter(await api.request<Room>(`/invites/${id}/respond`, 'POST', { accept }));
        onNavigate?.('rooms');
      } else {
        await api.request(`/invites/${id}/respond`, 'POST', { accept });
      }
    } finally {
      await refreshSocial();
    }
  })} />;

  return <HubSurface onExit={onExit} onLogout={onLogout} section={section} onNavigate={onNavigate}>
    <div className="online-profile-bar">
      <p>{profile.displayName} <small>@{profile.username}</small></p>
      <button onClick={editProfile}>Editar perfil</button>
    </div>
    {(authError || error) && <p className="online-error" role="alert">{authError || error}</p>}
    {notice && <p className="online-notice" role="status">{notice}</p>}
    {socialError && <div className="online-error">
      <p role="alert">Não foi possível atualizar amigos e convites. {socialError}</p>
      <button onClick={() => { void refreshSocial(); }}>Tentar novamente</button>
    </div>}
    {section === 'friends' ? <div className="online-stack online-social">
      {!social && !socialError && <section className="online-card"><p role="status">Carregando amigos…</p></section>}
      {social && <FriendsPanel userId={profile.id} social={social} busy={busy}
        onSearch={async username => {
          setError('');
          try {
            return await api.request<Profile[]>(`/users?username=${encodeURIComponent(username)}`);
          } catch (cause) {
            setError(onlineErrorMessage(cause));
            throw cause;
          }
        }}
        onRequest={userId => run(async () => {
          await api.request('/friends/requests', 'POST', { userId });
          await refreshSocial();
        }, 'Solicitação enviada.')}
        onRespond={(id, accept) => run(async () => {
          await api.request(`/friends/requests/${id}/respond`, 'POST', { accept });
          await refreshSocial();
        })}
        onRemove={id => run(async () => {
          await api.request(`/friends/${id}`, 'DELETE');
          await refreshSocial();
        })} />}
      {invitePanel}
    </div> : <section aria-label="Salas e partidas">
      {roomError && <div className="online-error">
        <p role="alert">Não foi possível atualizar suas salas. {roomError}</p>
        <button onClick={() => { void refreshRooms(); }}>Tentar novamente</button>
      </div>}
      {selectedRoomId && rooms && !rooms.some(item => item.id === selectedRoomId) && !room &&
        <p className="online-notice" role="status">A sala anterior foi encerrada ou expirou.</p>}
      {rooms && rooms.length > 0 && <div className="online-inline">
        <label htmlFor="active-online-room">Selecionar sala</label>
        <select id="active-online-room" value={room?.id ?? ''} disabled={busy} onChange={event => {
          selectRoomId(event.target.value);
          setShareLink('');
        }}>
          <option value="">Criar sala ou entrar por código</option>
          {rooms.map(item => <option value={item.id} key={item.id}>
            {item.code}{item.status === 'started' ? ' · Partida em andamento' : ''}
          </option>)}
        </select>
      </div>}
      <div className="online-grid">
        {!rooms && !roomError && <section className="online-card"><p role="status">Buscando suas salas…</p></section>}
        {rooms && !room && <RoomEntry busy={busy}
          onCreate={capacity => run(async () => enter(await api.request<Room>('/rooms', 'POST', { capacity })))}
          onJoin={code => run(async () => enter(await api.request<Room>('/rooms/join', 'POST', { code })))} />}
        {room?.status === 'lobby' && <div className="online-stack">
          <Lobby key={room.id} room={room} userId={profile.id} friends={social?.friends ?? []} presence={presence} busy={busy}
            onReady={ready => run(() => changeRoom('ready', { ready }))}
            onStart={() => run(() => changeRoom('start'))}
            onLeave={() => run(() => changeRoom('leave'))}
            onClose={() => run(() => changeRoom('close'))}
            onInvite={userId => run(() => changeRoom('invite', { userId }), 'Convite enviado.')}
            onCopy={() => { void copyLink(room.code); }} />
          {shareLink && <label className="online-card">Link de convite
            <input readOnly value={shareLink} onFocus={event => event.target.select()} />
          </label>}
        </div>}
        {invitePanel}
      </div>
    </section>}
  </HubSurface>;
}

function ProfileGate({ session, api, client, onLogout, authError, ...hub }: HubProps & {
  session: Session;
  api: OnlineApi;
  client: SupabaseClient;
  onLogout: () => void;
  authError: string;
}) {
  const [profile, setProfile] = useState<Profile | null>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void api.request<Profile | null>('/profile')
      .then(current => { if (active) setProfile(current); })
      .catch(cause => { if (active) setError(onlineErrorMessage(cause)); });
    return () => { active = false; };
  }, [api, reload]);

  function save(input: ProfileInput) {
    setBusy(true);
    setError('');
    void api.request<Profile>('/profile', 'PUT', input).then(saved => {
      setProfile(saved);
      setEditing(false);
    }).catch(cause => setError(onlineErrorMessage(cause))).finally(() => setBusy(false));
  }

  if (profile && !editing) {
    return <ConnectedHub {...hub} api={api} client={client} profile={profile}
      authError={authError} onLogout={onLogout} editProfile={() => { setError(''); setEditing(true); }} />;
  }

  const metadata = session.user.user_metadata;
  const displayName = typeof metadata.full_name === 'string' ? metadata.full_name.slice(0, 40) : '';
  const avatarUrl = typeof metadata.avatar_url === 'string' && metadata.avatar_url.startsWith('https://') ? metadata.avatar_url : '';
  return <HubSurface onExit={hub.onExit} onLogout={onLogout} section={hub.section} onNavigate={hub.onNavigate}>
    {(authError || error) && <p className="online-error" role="alert">{authError || error}</p>}
    {profile === undefined
      ? error
        ? <button onClick={() => { setError(''); setReload(current => current + 1); }}>Tentar novamente</button>
        : <p role="status">Buscando seu perfil…</p>
      : <ProfileEditor profile={profile} defaults={{ displayName, avatarUrl }} busy={busy} onSave={save} />}
    {editing && <button onClick={() => setEditing(false)} disabled={busy}>
      {hub.section === 'friends' ? 'Voltar aos amigos' : 'Voltar às salas'}
    </button>}
  </HubSurface>;
}

export function OnlineHub(props: HubProps) {
  const { supabase, api, session, authError, configuration, signIn, signOut } = useOnlineAuth(props.section ?? 'rooms');
  const [signingIn, setSigningIn] = useState(false);

  if (session && supabase && api) return <ProfileGate {...props} key={session.user.id}
    session={session} api={api} client={supabase} authError={authError} onLogout={() => { void signOut(); }} />;

  return <HubSurface onExit={props.onExit} section={props.section} onNavigate={props.onNavigate}>
    <section className="online-card online-login">
      <h2>Acessar sua conta</h2>
      {authError && <p role="alert">{authError}</p>}
      {!supabase
        ? <p role="status">{configuration === 'invalid'
          ? 'A configuração pública do Supabase está inválida. Confira a URL e a chave publicável do ambiente.'
          : 'O modo online precisa da configuração do Supabase neste ambiente. Você pode continuar no modo local.'}</p>
        : session === undefined
          ? <p role="status">Restaurando sessão…</p>
          : <button className="online-primary" disabled={signingIn} onClick={() => {
            setSigningIn(true);
            void signIn().finally(() => setSigningIn(false));
          }}>Entrar com Google</button>}
    </section>
  </HubSurface>;
}
