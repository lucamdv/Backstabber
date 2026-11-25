import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { GameIcon } from '../components/shared/GameIcon';
import { onlineErrorMessage } from './api';
import type { OnlineApi } from './api';
import { useOnlineAuth } from './auth';
import { FriendsPanel, RoomInvites, SocialOverview } from './FriendsPanel';
import { Lobby } from './Lobby';
import { OnlineAtmosphere } from './OnlineAtmosphere';
import { Avatar, ProfileEditor } from './Profile';
import { usePrivateBroadcast, useRoomRealtime } from './realtime';
import { onlineHash } from './routes';
import type { OnlineSection } from './routes';
import type { Invite, Profile, ProfileInput, Room, Social } from './types';
import './online.css';
import { AuthTerminal } from './AuthTerminal';

export type { OnlineApi } from './api';

export type OnlineMatchProps = {
  matchId: string;
  roomId: string;
  userId: string;
  connectedIds: string[];
  memberIds: string[];
  realtimeUnavailable: boolean;
  api: OnlineApi;
  onExit: () => void;
  matchInvalidation: number;
  startedFromLobby?: boolean;
};

type HubProps = {
  section?: OnlineSection;
  onNavigate?: (section: OnlineSection) => void;
  onExit: () => void;
  renderMatch: (props: OnlineMatchProps) => ReactNode;
};

const destinations = [
  { section: 'friends', label: 'Amigos', icon: 'users' },
  { section: 'rooms', label: 'Salas e partidas', icon: 'rooms' },
] as const;

function followSection(event: MouseEvent<HTMLAnchorElement>, section: OnlineSection, onNavigate?: HubProps['onNavigate']) {
  if (onNavigate && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    onNavigate(section);
  }
}

function HubSurface({ onExit, onLogout, section = 'rooms', onNavigate, children }:
Pick<HubProps, 'onExit' | 'section' | 'onNavigate'> & { onLogout?: () => void; children: ReactNode }) {
  return <main className={`online-hub${onLogout ? '' : ' online-entry'}`}>
    <OnlineAtmosphere />
    <header className="online-header">
      <div className="online-brand">
        <img src="images/isotipo.png" alt="" />
        <div><h1>Backstabber <span>Online</span></h1><p>Terminal de conexão</p></div>
      </div>
      <div className="online-actions">
        <button type="button" aria-label={onLogout ? 'Voltar ao menu' : 'Voltar ao menu local'} title="Voltar ao menu" onClick={onExit}>
          <GameIcon name="back" /><span>{onLogout ? 'Voltar ao menu' : 'Voltar ao menu local'}</span>
        </button>
        {onLogout && <button type="button" aria-label="Sair da conta" title="Sair da conta" onClick={onLogout}>
          <GameIcon name="exit" /><span>Sair da conta</span>
        </button>}
      </div>
    </header>
    <div className="online-shell">
      {onLogout && <aside className="online-rail">
        <nav className="online-sections" aria-label="Modo online">
        {destinations.map(destination => (
          <a key={destination.section} href={onlineHash(destination.section)}
            aria-current={section === destination.section ? 'page' : undefined}
            onClick={event => followSection(event, destination.section, onNavigate)}>
            <GameIcon name={destination.icon} />{destination.label}
          </a>
        ))}
        </nav>
        <img className="online-rail-card" src="images/verso_card.png" alt="" width="124" />
      </aside>}
      <div className="online-content">{children}</div>
    </div>
  </main>;
}

function RoomEntry({ busy, onCreate, onJoin }: {
  busy: boolean; onCreate: (capacity: number) => void; onJoin: (code: string) => void;
}) {
  const [capacity, setCapacity] = useState(4);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('sala')?.slice(0, 10).toUpperCase() ?? '');

  return <section className="online-room-entry" aria-labelledby="room-entry-title">
    <h2 id="room-entry-title" className="online-display-title">Salas privadas</h2>
    <div className="online-room-forms">
    <form className="online-room-form" onSubmit={event => { event.preventDefault(); if (!busy) onCreate(capacity); }}>
      <h3 className="online-display-title"><GameIcon name="plus" />Criar sala</h3>
      <label htmlFor="room-capacity">Vagas</label>
      <select id="room-capacity" value={capacity} disabled={busy} onChange={event => setCapacity(Number(event.target.value))}>
        {Array.from({ length: 9 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count}</option>)}
      </select>
      <button className="online-primary" disabled={busy}>Criar sala <GameIcon name="plus" /></button>
    </form>
    <form className="online-room-form" onSubmit={event => { event.preventDefault(); if (!busy) onJoin(code.trim()); }}>
      <h3 className="online-display-title"><GameIcon name="enter" />Entrar na sala</h3>
      <label htmlFor="room-code">Código de convite</label>
      <input id="room-code" value={code} onChange={event => setCode(event.target.value.toUpperCase())} disabled={busy}
        pattern="[0-9A-F]{10}" maxLength={10} autoComplete="off" spellCheck={false} placeholder="10 caracteres" title="Digite os 10 caracteres do código" required />
      <button disabled={busy}>Entrar por código <GameIcon name="enter" /></button>
    </form>
    </div>
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
  const roomStatus = room?.status;
  const observedLobby = useRef<string | undefined>(undefined);
  useEffect(() => {
    observedLobby.current = roomStatus === 'lobby' ? roomId : undefined;
  }, [roomId, roomStatus]);

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
  const { presence, realtimeUnavailable } = useRoomRealtime(client, roomId, profile.id, invalidateRoom, refreshRooms);

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
      memberIds: room.members.map(member => member.id), realtimeUnavailable,
      startedFromLobby: observedLobby.current === room.id,
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
  }, accept ? 'Convite aceito.' : 'Convite recusado.')} />;

  return <HubSurface onExit={onExit} onLogout={onLogout} section={section} onNavigate={onNavigate}>
    <div className="online-profile-bar">
      <div className="online-identity"><Avatar profile={profile} /><p><strong>{profile.displayName}</strong><small>@{profile.username}</small></p></div>
      <button type="button" onClick={editProfile}><GameIcon name="identity" />Editar perfil</button>
    </div>
    {(authError || error) && <p className="online-error" role="alert">{authError || error}</p>}
    {notice && <p className="online-notice" role="status">{notice}</p>}
    {socialError && <div className="online-error">
      <p role="alert">Não foi possível atualizar amigos e convites. {socialError}</p>
      <button onClick={() => { void refreshSocial(); }}>Tentar novamente</button>
    </div>}
    {section === 'friends' ? <div className="online-stack online-social">
      <header className="online-page-heading">
        <div><h2>Seus <em>aliados.</em></h2><p>Mantenha os amigos perto. Os traidores, mais ainda.</p></div>
        <a className="online-page-link" href={onlineHash('rooms')} onClick={event => followSection(event, 'rooms', onNavigate)}>
          Ir para salas <GameIcon name="rooms" />
        </a>
      </header>
      <SocialOverview social={social} invites={invites} />
      {invitePanel}
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
        }, accept ? 'Amizade aceita.' : 'Solicitação recusada.')}
        onRemove={id => run(async () => {
          await api.request(`/friends/${id}`, 'DELETE');
          await refreshSocial();
        }, 'Contato removido.')} />}
    </div> : <section className={`online-stack online-rooms${room?.status === 'lobby' ? ' online-rooms-lobby' : ''}`} aria-label="Salas e partidas">
      {room?.status !== 'lobby' && <header className="online-page-heading">
        <div><h2>Reúna a <em>mesa.</em></h2><p>Uma sala. Muitos aliados. Apenas um sobrevivente.</p></div>
        <GameIcon name="rooms" />
      </header>}
      {roomError && <div className="online-error">
        <p role="alert">Não foi possível atualizar suas salas. {roomError}</p>
        <button onClick={() => { void refreshRooms(); }}>Tentar novamente</button>
      </div>}
      {selectedRoomId && rooms && !rooms.some(item => item.id === selectedRoomId) && !room &&
        <p className="online-notice" role="status">A sala anterior foi encerrada ou expirou.</p>}
      {rooms && rooms.length > 0 && <div className="online-room-selector">
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
      <div className="online-stack online-room-body">
        {room?.status !== 'lobby' && invitePanel}
        {!rooms && !roomError && <section className="online-card"><p role="status">Buscando suas salas…</p></section>}
        {rooms && !room && <RoomEntry busy={busy}
          onCreate={capacity => run(async () => enter(await api.request<Room>('/rooms', 'POST', { capacity })))}
          onJoin={code => run(async () => enter(await api.request<Room>('/rooms/join', 'POST', { code })))} />}
        {room?.status === 'lobby' &&
          <Lobby key={room.id} room={room} userId={profile.id} friends={social?.friends ?? []} presence={presence} busy={busy}
            onReady={ready => run(() => changeRoom('ready', { ready }))}
            onStart={() => run(() => changeRoom('start'))}
            onLeave={() => run(() => changeRoom('leave'))}
            onClose={() => run(() => changeRoom('close'))}
            onInvite={userId => run(() => changeRoom('invite', { userId }), 'Convite enviado.')}
            onCopy={() => { void copyLink(room.code); }} shareLink={shareLink}>
            {invitePanel}
          </Lobby>}
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
  const auth = useOnlineAuth(props.section ?? 'rooms');
  const { supabase, api, session, authError, configuration, signOut } = auth;

  if (session && supabase && api) return <ProfileGate {...props} key={session.user.id}
    session={session} api={api} client={supabase} authError={authError} onLogout={() => { void signOut(); }} />;

  return <HubSurface onExit={props.onExit} section={props.section} onNavigate={props.onNavigate}>
    <div className="online-login">
      {!supabase || session === undefined ? <div className="online-card online-login-terminal">
        <h2 id="online-login-title">Entrar na rede</h2>
        {!supabase ? <p role="status">{configuration === 'invalid'
            ? 'A configuração pública do Supabase está inválida. Confira a URL e a chave publicável do ambiente.'
            : 'O modo online precisa da configuração do Supabase neste ambiente. Você pode continuar no modo local.'}</p>
          : <p className="online-loading-status" role="status">Restaurando sessão…</p>}
      </div> : <AuthTerminal {...auth} error={authError} />}
    </div>
  </HubSurface>;
}
