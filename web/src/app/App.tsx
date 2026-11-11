import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CommandError, GameCommand } from '../game/application/contracts';
import { createClientId } from '../game/application/clientId';
import { LocalGameAdapter } from '../game/adapters/local';
import { loadGame, saveGame } from '../game/adapters/persistence';
import type { GameState } from '../game/core/engine';
import { createGame } from '../game/core/engine';
import GamePage from '../pages/GamePage';
import MenuPage from '../pages/MenuPage';
import { usePerformance } from './usePerformance';

const mobile = '(max-width: 900px), (max-height: 600px) and (pointer: coarse)';
const errors: Record<CommandError, string> = {
  STALE_REVISION: 'A partida já avançou. Tente a ação novamente.',
  INVALID_COMMAND: 'Essa jogada não é válida.',
  NOT_AUTHORIZED: 'Essa jogada não está disponível para o jogador.',
  INVALID_PHASE: 'Essa jogada não está disponível nesta etapa.',
};

function ActiveGame({ session, onExit, onRematch }: {
  session: LocalGameAdapter; onExit: () => void; onRematch: () => void;
}) {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [error, setError] = useState<string>();

  function send(command: GameCommand) {
    setError(undefined);
    void session.send({
      protocolVersion: 1, matchId: session.matchId, commandId: createClientId(),
      expectedRevision: view.revision, command,
    }).then(result => {
      if (!result.ok) setError(errors[result.error]);
    });
  }

  return <GamePage view={view} send={send} error={error} onReveal={() => session.reveal()}
    onConceal={() => session.conceal()} onExit={onExit} onRematch={onRematch} />;
}

function readSavedGame() {
  try {
    return loadGame(window.localStorage);
  } catch {
    return { notice: 'O navegador bloqueou o salvamento local.' };
  }
}

export function App() {
  usePerformance();
  const [saved, setSaved] = useState(readSavedGame);
  const [session, setSession] = useState<LocalGameAdapter | null>(null);
  const [isGameRoute, setGameRoute] = useState(location.hash === '#/partida');
  const [storageWarning, setStorageWarning] = useState<string>();
  const inGame = Boolean(session && isGameRoute);

  useEffect(() => {
    const navigate = () => {
      const playing = location.hash === '#/partida';
      if (!playing) session?.conceal();
      setGameRoute(playing);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [session]);

  function open(state: GameState) {
    const persist = (next: GameState) => {
      setSaved(next.phase.kind === 'finished' ? {} : { state: next });
      try {
        saveGame(window.localStorage, next);
      } catch {
        setStorageWarning('Não foi possível gravar a partida neste navegador.');
      }
    };
    setStorageWarning(undefined);
    persist(state);
    setSession(new LocalGameAdapter(state, persist));
    location.hash = '/partida';
    setGameRoute(true);
  }

  function exit() {
    session?.conceal();
    location.hash = '/';
    setGameRoute(false);
  }

  const stylesheet = inGame ? 'game' : 'index';
  return <>
    <link rel="icon" type="image/png" href="images/isotipo.png" />
    <link rel="stylesheet" href={`css/style-${stylesheet}.css`} />
    <link rel="stylesheet" href="css/oracle.css" />
    <link rel="stylesheet" href={`css/mobile-${stylesheet}.css`} media={mobile} />
    {inGame && session
      ? <ActiveGame key={session.matchId} session={session} onExit={exit}
          onRematch={() => open(createGame(session.getSnapshot().players.map(player => player.name)))} />
      : <MenuPage onStart={names => open(createGame(names))}
          onResume={saved.state ? () => open(saved.state!) : undefined}
          notice={storageWarning ?? saved.notice} />}
    {inGame && storageWarning && <output role="status" className="storage-warning">{storageWarning}</output>}
  </>;
}
