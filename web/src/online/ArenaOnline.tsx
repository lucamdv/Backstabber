import { useEffect, useRef, useState } from 'react';
import { ArenaBoard } from '../components/game/ArenaBoard';
import { actions, playerName } from '../components/game/gameDisplay';
import { OnlineResult } from './OnlineResult';
import { OraclePanel } from '../components/shared/Oracle';
import type { Action } from '../game/application/contracts';
import type { OnlineCommand, OnlineView } from '../game/application/online-contracts';
import { OnlineDecisionPanel } from './OnlineDecisionPanel';
import { OnlineDeal } from './OnlineCinematics';
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

export function ArenaOnline({ view, send, onExit, onRematch, onCloseMatch, connectedIds, busy, error }: ArenaOnlineProps) {
  const [utility, setUtility] = useState<{ kind: 'oracle' | 'options'; decision: string } | null>(null);
  const [target, setTarget] = useState<{ action: Action; round: number; revision: number }>();
  const panelScroll = useRef<HTMLDivElement>(null);
  const turn = !view.closed && view.activeId === view.viewerId && view.phase.kind === 'action' && !view.window;
  const targetAction = turn && target?.round === view.round && target.revision === view.revision
    && view.availableActions.includes(target.action) ? target.action : undefined;
  const mayClose = view.canClose && !view.closed;
  const decision = `${view.round}/${view.window?.id ?? view.phase.kind}`;
  const activeUtility = !view.closed && utility?.decision === decision ? utility.kind : null;
  const showResult = view.phase.kind === 'finished' && !view.window && !view.closed;
  const closeMatchControl = mayClose && <CloseMatchControl key={view.round} busy={busy} onCloseMatch={onCloseMatch} />;

  useEffect(() => {
    if (panelScroll.current) panelScroll.current.scrollTop = 0;
  }, [activeUtility, targetAction, view.phase.kind, view.window?.id]);

  function chooseAction(action: Action) {
    if (!turn || busy || !view.availableActions.includes(action)) return;
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

  const panel = !showResult && <div className="online-playmat-scroll" ref={panelScroll} tabIndex={0} role="region" aria-label="Decisões da partida">
    {view.history.length === 0 && view.phase.kind === 'action' && !view.window && !view.closed && <OnlineDeal key={view.round} />}
    {activeUtility === 'oracle' && view.window && <div className="overlay-content online-panel">
      <button type="button" className="btn-pass" onClick={() => setUtility(null)}>Voltar à decisão coletiva</button>
    </div>}
    {activeUtility === 'oracle' && <OraclePanel onClose={() => setUtility(null)} />}
    {activeUtility === 'options' && <section className="overlay-content online-panel" aria-labelledby="online-options-title">
      <h2 id="online-options-title">Opções da partida</h2>
      <p>A partida continua disponível nesta sala.</p>
      <div className="online-decision-buttons">
        <button type="button" className="btn-pass" onClick={() => setUtility(null)}>Voltar à mesa</button>
        <button type="button" className="btn-pass" onClick={onExit}>Sair da arena</button>
      </div>
      {closeMatchControl}
    </section>}
    <OnlineDecisionPanel view={view} send={send} busy={busy} targetAction={targetAction}
      onCancelTarget={() => setTarget(undefined)} onExit={onExit} />
    {busy && <p className="online-arena-busy" role="status">Enviando à mesa…</p>}
    {error && <p className="online-error" role="alert">{error}</p>}
  </div>;

  return <div className="arena-root online-arena" data-your-turn={turn}>
    <ArenaBoard view={view} blocked={showResult} hideHand={showResult} onAction={chooseAction}
      onOracle={() => toggleUtility('oracle')}
      onPause={() => toggleUtility('options')}
      online={{ viewerId: view.viewerId, connectedIds, panel, showActions: turn && !targetAction,
        actionsDisabled: busy }} />
    {showResult && view.phase.kind === 'finished' && <OnlineResult key={view.round}
      won={view.phase.winnerId === view.viewerId}
      winner={playerName(view, view.phase.winnerId)}
      cards={view.phase.winnerId === view.viewerId ? view.phase.cards : []}
      busy={busy} onRematch={view.canRematch ? onRematch : undefined} onExit={onExit}>
      {mayClose && <div className="online-victory-host-controls">{closeMatchControl}</div>}
      {error && <p className="online-error" role="alert">{error}</p>}
    </OnlineResult>}
    <div className="portrait-lock" role="status" aria-live="polite">
      <img src="images/isotipo.png" alt="" />
      <strong>GIRE O DISPOSITIVO</strong>
      <span>A mesa do Backstabber foi projetada para o modo retrato.</span>
    </div>
  </div>;
}

export default ArenaOnline;
