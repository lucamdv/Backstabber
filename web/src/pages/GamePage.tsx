import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
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
import '../components/game/arena-local.css';

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

interface PhasePresentation {
  overlay?: ReactNode;
  stage?: ReactNode;
  concealedHand?: boolean;
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

  function handoff(name: string, initial = false): PhasePresentation {
    return { overlay: <Handoff name={name} initial={initial} onReveal={reveal} />, concealedHand: !view.revealed };
  }

  function renderPhase(): PhasePresentation {
    if (intro) return { overlay: <ArenaIntro onComplete={endIntro} /> };
    if (cinematic) return { overlay: <ArenaCinematic view={view} event={cinematic} onComplete={endEvent} /> };
    if (event?.kind === 'income') return { stage: <IncomeDialog view={view} playerId={event.playerId} onContinue={endEvent} /> };
    if (utility === 'pause') return { overlay: <PauseDialog onClose={() => setUtility(null)} onExit={exit} /> };
    if (utility === 'oracle') return { overlay: <Oracle onClose={() => setUtility(null)} /> };

    switch (phase.kind) {
      case 'action':
        return activePlayerReady ? {} : handoff(playerName(view, view.privatePlayerId ?? view.activeId), view.revision === 0);
      case 'target':
        return activePlayerReady ? { stage: <TargetDialog view={view} send={send} /> }
          : handoff(playerName(view, view.activeId));
      case 'reaction':
      case 'block-reaction':
        return { stage: <ReactionDialog key={phase.kind} view={view} send={send} /> };
      case 'loss':
        return { stage: phase.challenge && dismissedChallenge !== view.revision
          ? <ChallengeResult key={view.revision} view={view} challenge={phase.challenge}
            onContinue={() => setDismissedChallenge(view.revision)} />
          : <LossDialog view={view} phase={phase} send={send} onReveal={reveal} /> };
      case 'negotiation':
        return view.revealed && view.privatePlayerId === phase.playerId
          ? { stage: <NegotiationDialog key={view.revision} view={view} phase={phase} send={send} /> }
          : handoff(playerName(view, phase.playerId));
      case 'finished':
        return { overlay: <VictoryDialog view={view} onRematch={onRematch} onExit={exit} /> };
    }
  }

  const { overlay, stage, concealedHand } = renderPhase();
  const owner = view.players.find(player => player.id === (view.privatePlayerId ?? view.activeId));
  return <div className={`arena-root local-arena${cinematic?.kind === 'backstab' ? ' arena-backstab-impact' : ''}`}>
    <ArenaBoard view={view} blocked={Boolean(overlay)} hideHand={Boolean(overlay || stage)}
      local={{ concealedHandCount: concealedHand ? owner?.influence ?? 0 : 0,
        stage: stage && <div className="online-stage local-decision-stage">
          <div className="online-stage-content">{stage}</div>
        </div> }}
      onAction={(action) => send({ type: 'select-action', playerId: view.activeId, action })}
      onOracle={() => setUtility('oracle')} onPause={() => setUtility('pause')} />
    {overlay}
    {error && <p className="arena-error" role="alert">{error}</p>}
  </div>;
}
