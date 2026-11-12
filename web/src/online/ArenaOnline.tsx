import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArenaBoard } from '../components/game/ArenaBoard';
import { actions, playerName } from '../components/game/gameDisplay';
import { ArenaCinematic } from '../components/modals/ArenaCinematics';
import { ArenaDialog } from '../components/modals/ArenaDialog';
import { OnlineResult } from './OnlineResult';
import { Oracle } from '../components/shared/Oracle';
import type { Action, GameEvent } from '../game/application/contracts';
import type { OnlineCommand, OnlineView } from '../game/application/online-contracts';
import { OnlineDecisionPanel } from './OnlineDecisionPanel';
import { OnlineArenaIntro } from './OnlineCinematics';
import '../components/game/arena.css';
import './arena-online.css';

interface ArenaOnlineProps {
  view: OnlineView;
  send: (command: OnlineCommand) => void;
  onExit: () => void;
  onRematch: () => void;
  onCloseMatch: () => void;
  connectedIds: string[];
  busy: boolean;
  playIntro?: boolean;
  error?: string;
}

function CloseMatchControl({ busy, onCloseMatch }: Pick<ArenaOnlineProps, 'busy' | 'onCloseMatch'>) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button type="button" className="btn-danger" disabled={busy} onClick={() => setConfirm(true)}>
    Encerrar partida
  </button>;
  return <>
    <p>O encerramento vale para todos os participantes.</p>
    <div className="online-decision-buttons">
      <button type="button" className="btn-danger" disabled={busy} onClick={onCloseMatch}>Confirmar encerramento</button>
      <button type="button" className="btn-pass" disabled={busy} onClick={() => setConfirm(false)}>Cancelar encerramento</button>
    </div>
  </>;
}

export function ArenaOnline({ view, send, onExit, onRematch, onCloseMatch, connectedIds, busy, error, playIntro }: ArenaOnlineProps) {
  const [utility, setUtility] = useState<{ kind: 'oracle' | 'options'; decision: string } | null>(null);
  const [target, setTarget] = useState<{ action: Action; round: number; revision: number }>();
  const openingRound = !view.closed && !view.window && view.phase.kind === 'action' && view.history.length === 0;
  const observedRound = useRef(view.round);
  const [introRound, setIntroRound] = useState(() => playIntro && openingRound ? view.round : undefined);
  const endIntro = useCallback(() => setIntroRound(undefined), []);
  const playingIntro = introRound === view.round && !view.closed;
  useLayoutEffect(() => {
    if (observedRound.current === view.round) return;
    observedRound.current = view.round;
    setIntroRound(openingRound ? view.round : undefined);
  }, [openingRound, view.round]);
  const backstab = view.window?.kind === 'acknowledge' && view.lastEvent?.kind === 'backstab'
    ? view.lastEvent : undefined;
  const backstabKey = backstab ? `${view.round}/${view.window?.id}` : undefined;
  const seenBackstab = useRef(backstabKey);
  const [impact, setImpact] = useState<{ event: GameEvent; allowAudio: boolean }>();
  const endImpact = useCallback(() => setImpact(undefined), []);
  const playingImpact = Boolean(impact && !view.closed && !playingIntro);
  const turn = !view.closed && view.activeId === view.viewerId && view.phase.kind === 'action' && !view.window;
  const targetAction = turn && target?.round === view.round && target.revision === view.revision
    && view.availableActions.includes(target.action) ? target.action : undefined;
  const mayClose = view.canClose && !view.closed;
  const decision = `${view.round}/${view.window?.id ?? view.phase.kind}`;
  const activeUtility = !view.closed && utility?.decision === decision ? utility.kind : null;
  const showResult = view.phase.kind === 'finished' && !view.window && !view.closed;
  const closeMatchControl = mayClose && <CloseMatchControl key={view.round} busy={busy} onCloseMatch={onCloseMatch} />;

  useLayoutEffect(() => {
    if (view.closed || !backstab || seenBackstab.current === backstabKey) return;
    seenBackstab.current = backstabKey;
    setImpact({ event: backstab, allowAudio: navigator.userActivation?.hasBeenActive === true });
  }, [backstab, backstabKey, view.closed]);

  function chooseAction(action: Action) {
    if (!turn || busy || playingIntro || playingImpact || !view.availableActions.includes(action)) return;
    setUtility(null);
    if (actions[action].targetTitle) {
      setTarget({ action, round: view.round, revision: view.revision });
    } else {
      send({ type: 'select-action', action });
    }
  }

  function toggleUtility(kind: 'oracle' | 'options') {
    setUtility(activeUtility === kind ? null : { kind, decision });
  }

  const panel = !showResult && <div className="online-stage" role="region" aria-label="Decisões da partida">
    <div className="online-stage-content">
      <OnlineDecisionPanel view={view} send={send} busy={busy} targetAction={targetAction}
        onCancelTarget={() => setTarget(undefined)} onExit={onExit} />
    </div>
    {error ? <p className="online-error" role="alert">{error}</p>
      : busy && <p className="online-arena-busy" role="status">Enviando à mesa…</p>}
  </div>;

  const options = activeUtility === 'options' && <ArenaDialog id="online-options" titleId="online-options-title"
    onEscape={() => setUtility(null)}>
    <section className="overlay-content online-panel">
      <h2 id="online-options-title">Opções da partida</h2>
      <p>A partida continua disponível nesta sala.</p>
      <div className="online-decision-buttons">
        <button type="button" className="btn-pass" onClick={() => setUtility(null)}>Voltar à mesa</button>
        <button type="button" className="btn-pass" onClick={onExit}>Sair da arena</button>
      </div>
      {closeMatchControl}
    </section>
  </ArenaDialog>;

  return <div className={`arena-root online-arena${playingImpact ? ' arena-backstab-impact' : ''}`} data-your-turn={turn}>
    <ArenaBoard view={view} blocked={showResult || playingIntro || playingImpact || Boolean(activeUtility)} hideHand={showResult} onAction={chooseAction}
      onOracle={() => toggleUtility('oracle')}
      onPause={() => toggleUtility('options')}
      online={{ viewerId: view.viewerId, connectedIds, panel, showActions: turn && !targetAction,
        actionsDisabled: busy }} />
    {!playingIntro && !playingImpact && activeUtility === 'oracle' && <Oracle onClose={() => setUtility(null)} />}
    {!playingIntro && !playingImpact && options}
    {playingIntro && <OnlineArenaIntro key={introRound} onComplete={endIntro} />}
    {playingImpact && impact && <ArenaCinematic view={view} event={impact.event}
      allowAudio={impact.allowAudio} onComplete={endImpact} />}
    {showResult && !playingIntro && !playingImpact && view.phase.kind === 'finished' && <OnlineResult key={view.round}
      won={view.phase.winnerId === view.viewerId}
      winner={playerName(view, view.phase.winnerId)}
      cards={view.phase.winnerId === view.viewerId ? view.phase.cards : []}
      busy={busy} onRematch={view.canRematch ? onRematch : undefined} onExit={onExit}>
      {mayClose && <div className="online-victory-host-controls">{closeMatchControl}</div>}
      {error && <p className="online-error" role="alert">{error}</p>}
    </OnlineResult>}
  </div>;
}

export default ArenaOnline;
