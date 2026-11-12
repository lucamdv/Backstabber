import { useState } from 'react';
import { Card } from '../components/game/Card';
import { actions, characterName, playerName } from '../components/game/gameDisplay';
import { Claims } from '../components/modals/ArenaDecisions';
import type { Action } from '../game/application/contracts';
import type { OnlineCommand, OnlineView, OnlineWindow, VoteChoice } from '../game/application/online-contracts';

interface DecisionProps {
  view: OnlineView;
  send: (command: OnlineCommand) => void;
  busy: boolean;
}

function voteLabel(choice: VoteChoice, window: OnlineWindow) {
  switch (choice.kind) {
    case 'accept': return window.kind === 'block-reaction' ? 'Aceitar bloqueio' : 'Não duvidar';
    case 'challenge': return window.kind === 'block-reaction' ? 'Contestar bloqueio' : 'Duvidar';
    case 'acknowledge': return 'Ciente / Continuar';
    case 'block': return `Bloquear com ${characterName[choice.character]}`;
  }
}

function WindowClaims({ view }: { view: OnlineView }) {
  const phase = view.phase;
  if (phase.kind === 'reaction' || phase.kind === 'block-reaction') {
    return <Claims view={view} declaration={phase.declaration} block={phase.kind === 'block-reaction' ? phase.block : undefined} />;
  }
  if (phase.kind === 'loss' && phase.challenge) {
    const { declaration, block, truthful } = phase.challenge;
    return <Claims view={view} declaration={declaration} block={block}
      result={{ truthful, on: block ? 'bloqueio' : 'acao' }} />;
  }
  if (view.lastEvent?.kind === 'backstab' || view.lastEvent?.kind === 'income') {
    return <Claims view={view} declaration={{ action: view.lastEvent.kind, playerId: view.lastEvent.playerId,
      targetId: view.lastEvent.targetId ?? null }} />;
  }
  return null;
}

function CollectiveDecision({ view, send, busy, window }: DecisionProps & { window: OnlineWindow }) {
  const { phase } = view;
  const targetId = phase.kind === 'reaction' || phase.kind === 'block-reaction'
    ? phase.declaration.targetId : view.lastEvent?.targetId;
  const viewerResponded = window.responded.includes(view.viewerId);
  const mayVote = window.eligible.includes(view.viewerId) && !viewerResponded;
  const challenge = phase.kind === 'loss' ? phase.challenge : undefined;
  const outcome = challenge ? challenge.truthful ? 'proved' : 'bluff'
    : view.lastEvent?.kind === 'backstab' ? 'backstab'
    : view.lastEvent?.kind === 'eliminated' ? 'eliminated' : undefined;
  const heading = window.kind === 'reaction' ? 'A mesa exige uma resposta'
    : window.kind === 'block-reaction' ? 'Contestar defesa' : 'Resultado da jogada';
  return <section className="overlay-content online-panel online-collective" data-outcome={outcome} aria-labelledby="online-decision-title">
    {outcome && <div className="online-outcome">
      {outcome === 'backstab' && <img src="images/isologo.png" alt="" />}
      <strong>{outcome === 'proved' ? 'Defesa validada' : outcome === 'bluff' ? 'Blefe descoberto'
        : outcome === 'backstab' ? 'BACKSTAB' : 'Operador eliminado'}</strong>
    </div>}
    <h2 id="online-decision-title">{heading}</h2>
    <WindowClaims view={view} />
    <p className="online-declaration-summary">{window.summary}</p>
    {targetId && <p>Alvo: {playerName(view, targetId)}</p>}
    <p className="online-progress" role="status">Aguardando respostas — {window.responded.length}/{window.eligible.length}</p>
    <progress className="online-vote-meter" aria-label="Progresso das respostas" max={Math.max(1, window.eligible.length)} value={window.responded.length} />
    {viewerResponded && <p>Sua decisão está selada. Aguardando os outros jogadores.</p>}
    {!viewerResponded && !mayVote && <p>Acompanhe as respostas dos participantes elegíveis.</p>}
    {mayVote && <div className="online-decision-buttons">
      {window.options.map((choice) => <button type="button" disabled={busy}
        key={choice.kind === 'block' ? choice.character : choice.kind}
        className={choice.kind === 'block' ? 'btn-block' : choice.kind === 'challenge' ? 'btn-challenge' : 'btn-pass'}
        onClick={() => send({ type: 'vote', windowId: window.id, choice })}>
        {voteLabel(choice, window)}
      </button>)}
    </div>}
    <ul className="online-responses" aria-label="Participantes da decisão">
      {window.eligible.map((id) => <li key={id} data-responded={window.responded.includes(id)}>
        {playerName(view, id)} · {window.responded.includes(id) ? 'respondeu' : 'pendente'}
      </li>)}
    </ul>
  </section>;
}

function InfluenceLoss({ view, send, busy, victimId }: DecisionProps & { victimId: string }) {
  const isVictim = victimId === view.viewerId && view.privatePlayerId === view.viewerId;
  return <section className="overlay-content online-panel" aria-labelledby="online-loss-title">
    <h2 id="online-loss-title">Uma influência caiu</h2>
    <p>{isVictim ? 'Escolha uma influência para perder.' : `${playerName(view, victimId)} está escolhendo uma influência para perder.`}</p>
    {isVictim && <div id="loss-cards" className="hand">
      {view.choices.map((card) => <Card key={card.id} character={card.character}
        label={`Perder ${characterName[card.character]}`} disabled={busy}
        onSelect={() => send({ type: 'lose', cardId: card.id })} />)}
    </div>}
  </section>;
}

function BrokerChoice({ view, send, busy, keep }: DecisionProps & { keep: number }) {
  const [selected, setSelected] = useState<string[]>([]);
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((card) => card !== id)
      : current.length < keep ? [...current, id] : current);
  }
  return <>
    <p>Selecione {keep} {keep === 1 ? 'carta' : 'cartas'} para <strong>MANTER</strong>.</p>
    <div id="negotiation-cards" className="hand">
      {view.choices.map((card) => <Card key={card.id} character={card.character} selected={selected.includes(card.id)}
        className={selected.includes(card.id) ? 'selected' : ''} label={`Manter ${characterName[card.character]}`}
        disabled={busy} onSelect={() => toggle(card.id)} />)}
    </div>
    <button type="button" className="btn-pass" disabled={busy || selected.length !== keep}
      onClick={() => send({ type: 'negotiate', keepIds: selected })}>Confirmar Negociação</button>
  </>;
}

function Negotiation({ view, send, busy, playerId, keep }: DecisionProps & { playerId: string; keep: number }) {
  const isBroker = playerId === view.viewerId && view.privatePlayerId === view.viewerId;
  return <section className="overlay-content online-panel" aria-labelledby="online-broker-title">
    <h2 id="online-broker-title">Negociação do Broker</h2>
    {isBroker ? <BrokerChoice view={view} send={send} busy={busy} keep={keep} />
      : <p>Aguardando a negociação de {playerName(view, playerId)}.</p>}
  </section>;
}

function TargetPicker({ view, send, busy, action, onCancel }: DecisionProps & { action: Action; onCancel: () => void }) {
  return <section className="overlay-content online-panel" aria-labelledby="online-target-title">
    <h2 id="online-target-title">Alvo para: {actions[action].targetTitle ?? actions[action].title}</h2>
    <div className="online-decision-buttons">
      {view.targets.map((id) => <button type="button" className="btn-challenge" key={id} disabled={busy}
        onClick={() => send({ type: 'select-action', action, targetId: id })}>Alvo: {playerName(view, id)}</button>)}
    </div>
    <button type="button" className="btn-pass" disabled={busy} onClick={onCancel}>Cancelar Operação</button>
  </section>;
}

export function OnlineDecisionPanel({ view, send, busy, targetAction, onCancelTarget, onExit }: DecisionProps & {
  targetAction?: Action;
  onCancelTarget: () => void;
  onExit: () => void;
}) {
  const { phase } = view;
  if (view.closed) return <section className="overlay-content online-panel">
    <h2>Partida encerrada</h2>
    <button type="button" className="btn-pass" onClick={onExit}>Sair da arena</button>
  </section>;
  if (view.window) return <CollectiveDecision key={view.window.id} view={view} send={send} busy={busy} window={view.window} />;
  if (phase.kind === 'loss') return <InfluenceLoss view={view} send={send} busy={busy} victimId={phase.victimId} />;
  if (phase.kind === 'negotiation') return <Negotiation key={`${view.round}-${view.revision}`} view={view} send={send}
    busy={busy} playerId={phase.playerId} keep={phase.keep} />;
  if (phase.kind === 'finished') return null;
  if (targetAction) return <TargetPicker view={view} send={send} busy={busy} action={targetAction} onCancel={onCancelTarget} />;
  return <p className="online-turn-message" key={`${view.round}:${view.activeId}`} role="status">{view.activeId === view.viewerId
    ? 'É a sua vez. Escolha sua jogada.' : `${playerName(view, view.activeId)} está tramando o próximo movimento…`}</p>;
}
