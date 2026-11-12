import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArenaOnline } from '../../src/online/ArenaOnline';
import { OnlineHub } from '../../src/online/OnlineHub';
import { OnlineAtmosphere } from '../../src/online/OnlineAtmosphere';
import { Lobby } from '../../src/online/Lobby';
import { FriendsPanel } from '../../src/online/FriendsPanel';
import { ProfileEditor } from '../../src/online/Profile';
import type { OnlineView } from '../../src/game/application/online-contracts';
import type { Profile, Room } from '../../src/online/types';
import GamePage from '../../src/pages/GamePage';

const scene = new URLSearchParams(location.search).get('scene');
const root = createRoot(document.querySelector('#fixture')!);
const noop = () => undefined;

function PresenceArena({ view }: { view: OnlineView }) {
  const [connectedIds, setConnectedIds] = useState(['ada', 'bia', 'caio']);
  useEffect(() => {
    const update = (event: Event) => setConnectedIds((event as CustomEvent<string[]>).detail);
    window.addEventListener('arena-fixture-presence', update);
    return () => window.removeEventListener('arena-fixture-presence', update);
  }, []);
  return <ArenaOnline view={view} send={noop} connectedIds={connectedIds} busy={false}
    onCloseMatch={noop} onExit={noop} onRematch={noop} />;
}

function RecordedArena({ initial, next, pilot }: { initial: OnlineView; next: OnlineView; pilot?: boolean }) {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    const advance = () => setSnapshot(next);
    window.addEventListener('arena-fixture-advance', advance);
    return () => window.removeEventListener('arena-fixture-advance', advance);
  }, [next]);
  if (pilot) return <GamePage view={snapshot} showIntro={false} send={noop}
    onReveal={noop} onConceal={noop} onExit={noop} onRematch={noop} />;
  return <ArenaOnline view={snapshot} send={noop} connectedIds={['ada', 'bia']} busy={false}
    onCloseMatch={noop} onExit={noop} onRematch={noop} />;
}
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
    <OnlineAtmosphere />
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
  let initial = { ...view };
  if (scene === 'reaction' || scene === 'presence-vote') {
    view.activeId = 'bia';
    view.phase = { kind: 'block-reaction', declaration: { action: 'assassinate', playerId: 'bia', targetId: 'caio' },
      block: { playerId: 'caio', character: 'sentinela' } };
    view.window = { id: '1:3', kind: 'block-reaction', eligible: ['ada', 'bia'], responded: ['bia'],
      options: [{ kind: 'accept' }, { kind: 'challenge' }], summary: 'Reaja ao bloqueio.' };
  }
  if (scene === 'declaration') {
    view.activeId = 'bia';
    view.phase = { kind: 'reaction', declaration: { action: 'tax', playerId: 'bia', targetId: null } };
    view.window = { id: '1:2', kind: 'reaction', eligible: ['ada', 'caio'], responded: [],
      options: [{ kind: 'accept' }, { kind: 'challenge' }], summary: 'Bia declarou Magnata.' };
  }
  if (scene === 'contest') {
    view.activeId = 'bia';
    view.phase = { kind: 'reaction', declaration: { action: 'steal', playerId: 'bia', targetId: 'ada' } };
    view.window = { id: '1:2', kind: 'reaction', eligible: ['ada', 'caio'], responded: [],
      options: [{ kind: 'accept' }, { kind: 'challenge' }, { kind: 'block', character: 'mercenario' },
        { kind: 'block', character: 'broker' }], summary: 'Bia declarou Mercenário.' };
  }
  if (scene === 'truth' || scene === 'bluff' || scene === 'truth-motion' || scene === 'bluff-motion' || scene === 'conflict-motion') {
    const truthful = scene.startsWith('truth');
    const declaration = { action: 'assassinate', playerId: 'bia', targetId: 'caio' } as const;
    const block = { playerId: 'caio', character: 'sentinela' } as const;
    const reaction = { id: '1:4', kind: 'block-reaction' as const, eligible: ['ada', 'bia'], responded: [],
      options: [{ kind: 'challenge' as const }, { kind: 'accept' as const }], summary: 'Caio declarou Sentinela.' };
    view.activeId = 'bia';
    if (scene === 'conflict-motion') {
      initial = { ...view, phase: { kind: 'reaction', declaration },
        window: { ...reaction, id: '1:3', kind: 'reaction', summary: 'Bia declarou Executor.' } };
      view.phase = { kind: 'block-reaction', declaration, block };
      view.window = reaction;
    } else {
      initial = { ...view, phase: { kind: 'block-reaction', declaration, block }, window: reaction };
      view.phase = { kind: 'loss', reason: 'challenge', victimId: truthful ? 'ada' : 'caio',
        challenge: { declaration, block, truthful, challengerId: 'ada', declarerId: 'caio', character: 'sentinela' } };
      view.window = { ...reaction, id: '1:5', kind: 'acknowledge',
        options: [{ kind: 'acknowledge' }], summary: truthful ? 'A carta foi comprovada.' : 'A defesa falhou.' };
    }
  }
  if (scene === 'loss') {
    view.phase = { kind: 'loss', reason: 'execution', victimId: 'ada' };
    view.choices = [...hand];
  }
  if (scene === 'targets') {
    view.players = [...players, ...Array.from({ length: 7 }, (_, index) => ({
      id: `seat-${index}`, name: `Operador ${index + 4}`, credits: 2, influence: 2,
    }))];
    view.targets = view.players.filter(player => player.id !== view.viewerId).map(player => player.id);
  }
  if (scene === 'negotiation') {
    view.phase = { kind: 'negotiation', playerId: 'ada', keep: 2 };
    view.choices = [...hand, { id: 'neg-1', character: 'executor' }, { id: 'neg-2', character: 'sentinela' }];
  }
  if (scene === 'deal' || scene === 'intro') {
    view.history = [];
    if (scene === 'intro') view.round = 2;
  }
  if (scene === 'income' || scene === 'backstab' || scene === 'impact' || scene === 'pilot-impact') {
    const backstab = scene !== 'income';
    view.activeId = 'bia';
    view.lastEvent = { kind: backstab ? 'backstab' : 'income', playerId: 'bia', targetId: backstab ? 'caio' : undefined };
    if (backstab) view.phase = { kind: 'loss', victimId: 'caio', reason: 'backstab' };
    view.window = { id: '1:4', kind: 'acknowledge', eligible: ['ada', 'bia', 'caio'], responded: ['bia'],
      options: [{ kind: 'acknowledge' }], summary: backstab ? 'Backstab declarado.' : 'Bia recebeu 1 crédito.' };
  }
  if (scene === 'victory' || scene === 'defeat') {
    view.phase = { kind: 'finished', winnerId: scene === 'victory' ? 'ada' : 'bia', cards: scene === 'victory' ? [...hand] : [] };
    view.canRematch = scene === 'victory';
    view.canClose = scene === 'victory';
  }
  root.render(scene === 'presence' || scene === 'presence-vote' ? <PresenceArena view={view} />
    : scene === 'impact' || scene === 'pilot-impact' || scene === 'intro' || scene?.endsWith('-motion')
    ? <RecordedArena initial={initial} next={view} pilot={scene === 'pilot-impact'} />
    : <ArenaOnline view={view} send={command => {
    document.querySelector('#fixture')?.setAttribute('data-command', command.type);
    }} connectedIds={['ada', 'bia']} busy={false} playIntro={scene === 'deal'}
    onCloseMatch={noop} onExit={noop} onRematch={noop} />);
}
