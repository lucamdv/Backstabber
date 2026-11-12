import { createRoot } from 'react-dom/client';
import { ArenaOnline } from '../../src/online/ArenaOnline';
import { OnlineHub } from '../../src/online/OnlineHub';
import { Lobby } from '../../src/online/Lobby';
import { FriendsPanel } from '../../src/online/FriendsPanel';
import { ProfileEditor } from '../../src/online/Profile';
import type { OnlineView } from '../../src/game/application/online-contracts';
import type { Profile, Room } from '../../src/online/types';

const scene = new URLSearchParams(location.search).get('scene');
const root = createRoot(document.querySelector('#fixture')!);
const noop = () => undefined;
const people: Profile[] = [
  { id: 'ada', username: 'ada', displayName: 'Ada', avatarUrl: null, showOnline: true },
  { id: 'bia', username: 'bia', displayName: 'Bia', avatarUrl: null, showOnline: true },
  { id: 'caio', username: 'caio', displayName: 'Caio', avatarUrl: null, showOnline: true },
];

if (scene === 'login') {
  root.render(<OnlineHub onExit={noop} renderMatch={() => null} />);
} else if (scene === 'lobby' || scene === 'friends' || scene === 'profile') {
  const room: Room = {
    id: 'room', code: '7A9FC3402B', hostId: 'ada', capacity: 4, status: 'lobby', matchId: null, canStart: false,
    members: people.map((profile, index) => ({ ...profile, connected: index < 2, ready: index === 1 })),
  };
  root.render(<main className="online-hub">
    <header className="online-header"><div><img src="images/isotipo.png" alt="" /><h1>Backstabber <span>Online</span></h1></div></header>
    <div className="online-content">
      {scene === 'lobby' && <Lobby room={room} userId="ada" friends={[]} onReady={noop}
        onStart={noop} onLeave={noop} onClose={noop} onInvite={noop} onCopy={noop} />}
      {scene === 'friends' && <FriendsPanel userId="ada"
        social={{ friends: [{ ...people[1], online: true }, { ...people[2], online: false }], requests: [] }}
        busy={false} onSearch={async () => []} onRequest={noop} onRespond={noop} onRemove={noop} />}
      {scene === 'profile' && <ProfileEditor profile={people[0]} defaults={{ displayName: '', avatarUrl: '' }}
        busy={false} onSave={noop} />}
    </div>
  </main>);
} else {
  document.body.classList.add('game-active');
  const hand = [{ id: 'broker', character: 'broker' }, { id: 'magnata', character: 'magnata' }] as const;
  const players = people.map((player, index) => ({ id: player.id, name: player.displayName,
    credits: index + 2, influence: scene === 'defeat' && index !== 1 ? 0 : 2 }));
  const view: OnlineView = {
    viewerId: 'ada', revision: 7, round: 1, activeId: 'ada', players, deckCount: 9,
    history: [{ player: 'Bia', text: 'Taxou +3 créditos.' }], cemetery: ['executor'], phase: { kind: 'action' },
    hand: [...hand], choices: [], privatePlayerId: 'ada', revealed: true,
    availableActions: ['income', 'patrocinio', 'tax', 'steal', 'negotiate'],
    targets: ['bia', 'caio'], challenges: [], blocks: [], closed: false, canClose: true, canRematch: false,
  };
  if (scene === 'reaction') {
    view.activeId = 'bia';
    view.phase = { kind: 'block-reaction', declaration: { action: 'assassinate', playerId: 'bia', targetId: 'caio' },
      block: { playerId: 'caio', character: 'sentinela' } };
    view.window = { id: '1:3', kind: 'block-reaction', eligible: ['ada', 'bia'], responded: ['bia'],
      options: [{ kind: 'accept' }, { kind: 'challenge' }], summary: 'Reaja ao bloqueio.' };
  }
  if (scene === 'victory' || scene === 'defeat') {
    view.phase = { kind: 'finished', winnerId: scene === 'victory' ? 'ada' : 'bia', cards: scene === 'victory' ? [...hand] : [] };
    view.canRematch = scene === 'victory';
    view.canClose = scene === 'victory';
  }
  root.render(<ArenaOnline view={view} send={noop} connectedIds={['ada', 'bia']} busy={false}
    onCloseMatch={noop} onExit={noop} onRematch={noop} />);
}
