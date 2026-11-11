import { useCallback, useState } from 'react';
import type { GameCommand, GameView } from '../game/application/contracts';
import { ArenaBoard } from '../components/game/ArenaBoard';
import { playerName } from '../components/game/gameDisplay';
import {
  ChallengeResult, Handoff, IncomeDialog, LossDialog, NegotiationDialog,
  PauseDialog, ReactionDialog, TargetDialog,
} from '../components/modals/ArenaDecisions';
import { ArenaCinematic, ArenaIntro, VictoryDialog } from '../components/modals/ArenaCinematics';
import { Oracle } from '../components/shared/Oracle';
import '../components/game/arena.css';

interface GamePageProps {
  view: GameView;
  send: (command: GameCommand) => void;
  onReveal: () => void;
  onConceal: () => void;
  onExit: () => void;
  onRematch: () => void;
  error?: string;
  showIntro?: boolean;
}

export default function GamePage({
  view, send, onReveal, onConceal, onExit, onRematch, error, showIntro = true,
}: GamePageProps) {
  const [intro, setIntro] = useState(showIntro);
  const [dismissedEvent, setDismissedEvent] = useState<number | null>(null);
  const [dismissedChallenge, setDismissedChallenge] = useState<number | null>(null);
  const [utility, setUtility] = useState<'pause' | 'oracle' | null>(null);
  const { phase } = view;
  const event = dismissedEvent === view.revision ? undefined : view.lastEvent;
  const cinematic = event?.kind === 'backstab' || event?.kind === 'eliminated' ? event : undefined;
  const activePlayerReady = view.revealed && view.privatePlayerId === view.activeId;
  const endIntro = useCallback(() => setIntro(false), []);
  const endEvent = useCallback(() => setDismissedEvent(view.revision), [view.revision]);

  function reveal() {
    const orientation = screen.orientation as (ScreenOrientation & {
      lock?: (type: 'portrait-primary') => Promise<void>;
    }) | undefined;
    if (window.matchMedia?.('(max-width: 900px), (pointer: coarse)').matches && orientation?.lock) {
      void orientation.lock('portrait-primary').catch(() => undefined);
    }
    onReveal();
  }

  function exit() {
    onConceal();
    onExit();
  }

  function renderPhase() {
    if (intro) return <ArenaIntro onComplete={endIntro} />;
    if (cinematic) return <ArenaCinematic view={view} event={cinematic} onComplete={endEvent} />;
    if (event?.kind === 'income') return <IncomeDialog view={view} playerId={event.playerId} onContinue={endEvent} />;
    if (utility === 'pause') return <PauseDialog onClose={() => setUtility(null)} onExit={exit} />;
    if (utility === 'oracle') return <Oracle onClose={() => setUtility(null)} />;

    switch (phase.kind) {
      case 'action':
        return activePlayerReady ? null : <Handoff initial={view.revision === 0}
          name={playerName(view, view.privatePlayerId ?? view.activeId)} onReveal={reveal} />;
      case 'target':
        return activePlayerReady ? <TargetDialog view={view} send={send} />
          : <Handoff name={playerName(view, view.activeId)} onReveal={reveal} />;
      case 'reaction':
      case 'block-reaction':
        return <ReactionDialog key={phase.kind} view={view} send={send} />;
      case 'loss':
        return phase.challenge && dismissedChallenge !== view.revision
          ? <ChallengeResult key={view.revision} view={view} challenge={phase.challenge}
            onContinue={() => setDismissedChallenge(view.revision)} />
          : <LossDialog view={view} phase={phase} send={send} onReveal={reveal} />;
      case 'negotiation':
        return view.revealed && view.privatePlayerId === phase.playerId
          ? <NegotiationDialog key={view.revision} view={view} phase={phase} send={send} />
          : <Handoff name={playerName(view, phase.playerId)} onReveal={reveal} />;
      case 'finished':
        return <VictoryDialog view={view} onRematch={onRematch} onExit={exit} />;
    }
  }

  const overlay = renderPhase();
  return <div className={`arena-root${cinematic?.kind === 'backstab' ? ' arena-backstab-impact' : ''}`}>
    <ArenaBoard view={view} blocked={overlay !== null} hideHand={overlay !== null}
      onAction={(action) => send({ type: 'select-action', playerId: view.activeId, action })}
      onOracle={() => setUtility('oracle')} onPause={() => setUtility('pause')} />
    {overlay}
    {error && <p className="arena-error" role="alert">{error}</p>}
    <div className="portrait-lock" role="status" aria-live="polite">
      <img src="images/isotipo.png" alt="" />
      <strong>GIRE O DISPOSITIVO</strong>
      <span>A mesa do Backstabber foi projetada para o modo retrato.</span>
    </div>
  </div>;
}
