import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameCommand, GameView } from '../../game/application/contracts';
import { Card } from '../game/Card';
import { actions, characterName, playerName } from '../game/gameDisplay';
import { ArenaDialog } from './ArenaDialog';

type Declaration = Extract<GameView['phase'], { kind: 'reaction' }>['declaration'];
type Block = Extract<GameView['phase'], { kind: 'block-reaction' }>['block'];
type LossPhase = Extract<GameView['phase'], { kind: 'loss' }>;
type NegotiationPhase = Extract<GameView['phase'], { kind: 'negotiation' }>;
type Send = (command: GameCommand) => void;

interface ClaimsProps {
  view: GameView;
  declaration: Declaration;
  block?: Block;
  result?: { truthful: boolean; on: 'acao' | 'bloqueio'; exiting?: boolean };
}

export function Claims({ view, declaration, block, result }: ClaimsProps) {
  const action = actions[declaration.action];
  function status(slot: 'acao' | 'bloqueio') {
    if (result?.on !== slot) return '';
    return result.truthful ? ' is-truth' : ` is-lie${result.exiting ? ' is-exiting' : ''}`;
  }
  return <div id="reaction-card-stage" className="reaction-card-stage" aria-live="polite">
    <article className={`declared-card${status('acao')}`} data-slot="acao">
      <Card className="carta-declarada" character={action.character} label={action.character ? undefined : action.title}>
        {!action.character && <span className="generic-action-label">{action.title}</span>}
      </Card>
      <strong>{playerName(view, declaration.playerId)}</strong>
      <span>{action.title}</span>
    </article>
    {block && <>
      <span className="declaration-versus" aria-hidden="true">VS</span>
      <article className={`declared-card${status('bloqueio')}`} data-slot="bloqueio">
        <Card className="carta-declarada" character={block.character} />
        <strong>{playerName(view, block.playerId)}</strong>
        <span>BLOQUEIO</span>
      </article>
    </>}
  </div>;
}

export function Handoff({ name, initial = false, onReveal }: { name: string; initial?: boolean; onReveal: () => void }) {
  return <ArenaDialog id="blindfold" titleId="blindfold-msg">
    <h2 id="blindfold-msg" className="neon-text">
      {initial ? `SISTEMA PRONTO! ${name}, assuma o terminal.` : `Passe o dispositivo para ${name}`}
    </h2>
    <button type="button" id="btn-reveal" className="btn-cyber" onClick={onReveal}>ACESSAR TERMINAL</button>
  </ArenaDialog>;
}

export function TargetDialog({ view, send }: { view: GameView; send: Send }) {
  const phase = view.phase;
  if (phase.kind !== 'target') return null;
  const cancel = () => send({ type: 'cancel-target', playerId: view.activeId });
  return <ArenaDialog id="target-modal" titleId="target-title" placement="stage"
    className="local-stage-panel local-target-stage" onEscape={cancel}>
    <h2 id="target-title">Alvo para: {actions[phase.action].targetTitle ?? actions[phase.action].title}</h2>
    <div id="target-actions">
      {view.targets.map((id) => <button type="button" key={id} className="btn-challenge"
        onClick={() => send({ type: 'select-target', playerId: view.activeId, targetId: id })}>Alvo: {playerName(view, id)}</button>)}
    </div>
    <button type="button" id="btn-cancel-target" className="btn-pass" onClick={cancel}>Cancelar Operação</button>
  </ArenaDialog>;
}

export function ReactionDialog({ view, send }: { view: GameView; send: Send }) {
  const phase = view.phase;
  if (phase.kind !== 'reaction' && phase.kind !== 'block-reaction') return null;
  const block = phase.kind === 'block-reaction' ? phase.block : undefined;
  const actor = playerName(view, phase.declaration.playerId);
  const action = actions[phase.declaration.action];
  const description = block
    ? `${playerName(view, block.playerId)} bloqueou com ${characterName[block.character].toUpperCase()}. Alguém contesta o bloqueio?`
    : `${actor} declarou: ${action.title}. O que vocês fazem?`;
  return <ArenaDialog id="reaction-modal" titleId="reaction-title" placement="stage"
    className="online-hologram online-collective local-stage-panel local-reaction">
    <div className="online-projection">
      <Claims view={view} declaration={phase.declaration} block={block} />
    </div>
    <div className="online-reaction-controls">
      <h2 id="reaction-title">{block ? 'Contestar Defesa!' : 'Momento de Reação!'}</h2>
      <p id="reaction-desc">{description}</p>
      <div id="reaction-actions" className="local-reaction-options">
        {view.players.map((player) => <div className="arena-player-reactions" key={player.id}>
          {view.challenges.includes(player.id) && <button type="button" className="btn-challenge"
            onClick={() => send({ type: 'challenge', playerId: player.id })}>{player.name} - Contestar!</button>}
          {view.blocks.filter((option) => option.playerId === player.id).map(({ character }) =>
            <button type="button" key={character} className="btn-block"
              onClick={() => send({ type: 'block', playerId: player.id, character })}>
              {player.name} - Bloquear ({characterName[character]})
            </button>)}
        </div>)}
      </div>
      <button type="button" id="btn-accept-action" className="btn-pass" onClick={() => send({ type: 'accept', playerId: view.activeId })}>
        Ninguém se opõe (Permitir)
      </button>
    </div>
  </ArenaDialog>;
}

export function IncomeDialog({ view, playerId, onContinue }: { view: GameView; playerId: string; onContinue: () => void }) {
  return <ArenaDialog id="reaction-modal" titleId="reaction-title" placement="stage"
    className="online-hologram online-collective local-stage-panel local-reaction">
    <div className="online-projection">
      <Claims view={view} declaration={{ action: 'income', playerId, targetId: null }} />
    </div>
    <div className="online-reaction-controls">
      <h2 id="reaction-title">Renda recebida</h2>
      <p id="reaction-desc">{playerName(view, playerId)} recebeu 1 Crédito sem oposição.</p>
      <div id="reaction-actions"><button type="button" className="btn-pass" onClick={onContinue}>Continuar</button></div>
    </div>
  </ArenaDialog>;
}

export function ChallengeResult({ view, challenge, onContinue }: {
  view: GameView;
  challenge: NonNullable<LossPhase['challenge']>;
  onContinue: () => void;
}) {
  const [exiting, setExiting] = useState(false);
  const timeout = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timeout.current), []);

  function applyResult() {
    if (challenge.truthful || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onContinue();
    } else {
      setExiting(true);
      timeout.current = window.setTimeout(onContinue, 450);
    }
  }
  const declarer = playerName(view, challenge.declarerId);
  const challenger = playerName(view, challenge.challengerId);
  return <ArenaDialog id="reaction-modal" titleId="reaction-title" placement="stage"
    className={`online-hologram online-collective local-stage-panel local-reaction ${challenge.truthful ? 'local-proof' : 'local-bluff'}`}>
    <div className="online-projection">
      <Claims view={view} declaration={challenge.declaration} block={challenge.block}
        result={{ truthful: challenge.truthful, on: challenge.block ? 'bloqueio' : 'acao', exiting }} />
    </div>
    <div className="online-reaction-controls">
      <h2 id="reaction-title">{challenge.truthful ? 'Carta confirmada!' : 'Blefe descoberto!'}</h2>
      <p id="reaction-desc">{challenge.truthful
        ? `${declarer} comprovou a carta. Ela voltou ao monte e uma nova carta aleatória foi comprada. ${challenger} perde uma influência.`
        : `${declarer} não tinha a carta declarada e perde uma influência.`}</p>
      <div id="reaction-actions">
        <button type="button" className="btn-pass" onClick={applyResult} disabled={exiting}>Aplicar resultado</button>
      </div>
    </div>
  </ArenaDialog>;
}

export function LossDialog({ view, phase, send, onReveal }: {
  view: GameView; phase: LossPhase; send: Send; onReveal: () => void;
}) {
  const victim = view.players.find((player) => player.id === phase.victimId);
  const revealed = view.revealed && view.privatePlayerId === phase.victimId;
  return <ArenaDialog key={String(revealed)} id="loss-modal" titleId="loss-title" placement="stage"
    className="local-stage-panel local-loss-stage">
    <div className="local-loss-heading">
      <span className="loss-kicker">ACESSO PRIVADO // INFLUÊNCIA COMPROMETIDA</span>
      <h2 id="loss-title">{victim?.name}, proteja sua mão</h2>
      <p id="loss-instruction">{revealed ? 'Agora escolha a influência que voltará ao monte.'
        : `Passe o dispositivo para ${victim?.name}. As cartas estão viradas para preservar suas influências.`}</p>
    </div>
    {!revealed && <button type="button" id="btn-reveal-loss-cards" className="btn-reveal-loss" onClick={onReveal}>
      VIRAR MINHAS CARTAS
    </button>}
    <div id="loss-cards" className={`hand${revealed ? '' : ' is-concealed'}`} aria-live="polite">
      {revealed ? view.choices.map((card) => <Card key={card.id} character={card.character}
        label={`Perder ${characterName[card.character]}`}
        onSelect={() => send({ type: 'lose', playerId: phase.victimId, cardId: card.id })} />)
        : Array.from({ length: victim?.influence ?? 0 }, (_, index) => <Card key={index} className="carta-escolha" />)}
    </div>
  </ArenaDialog>;
}

export function NegotiationDialog({ view, phase, send }: { view: GameView; phase: NegotiationPhase; send: Send }) {
  const [keep, setKeep] = useState<string[]>([]);
  return <ArenaDialog id="negotiation-modal" titleId="negotiation-title" placement="stage"
    className="online-broker-stage local-stage-panel local-broker-stage">
    <h2 id="negotiation-title">Negociação do Broker</h2>
    <p id="negotiation-instruction">Escolha {phase.keep} {phase.keep === 1 ? 'influência' : 'influências'} para manter</p>
    <div id="negotiation-cards" className="online-broker-offer" role="group" aria-labelledby="negotiation-instruction"
      style={{ '--broker-offer-count': view.choices.length || 1 } as CSSProperties}>
      {view.choices.map((card) => <Card key={card.id} character={card.character}
        label={`Manter ${characterName[card.character]}`} selected={keep.includes(card.id)}
        className={keep.includes(card.id) ? 'selected' : ''}
        onSelect={() => setKeep((ids) => ids.includes(card.id) ? ids.filter((id) => id !== card.id)
          : ids.length < phase.keep ? [...ids, card.id] : ids)} />)}
    </div>
    <div className="online-broker-controls">
      <output>{keep.length}/{phase.keep} selecionadas</output>
      <button type="button" id="btn-confirm-negotiation" className="btn-pass" disabled={keep.length !== phase.keep}
        onClick={() => send({ type: 'negotiate', playerId: phase.playerId, keepIds: keep })}>Confirmar Negociação</button>
    </div>
  </ArenaDialog>;
}

export function PauseDialog({ onClose, onExit }: { onClose: () => void; onExit: () => void }) {
  return <ArenaDialog id="pause-modal" titleId="pause-title" onEscape={onClose}>
    <div className="overlay-content pause-content">
      <span className="pause-kicker">PROTOCOLO SUSPENSO</span>
      <h2 id="pause-title">PAUSA</h2>
      <p>A partida permanece salva neste dispositivo.</p>
      <button type="button" id="btn-resume" className="btn-pass" onClick={onClose}>Retomar partida</button>
      <button type="button" id="btn-exit-to-menu" className="btn-danger" onClick={onExit}>Sair para o menu principal</button>
    </div>
  </ArenaDialog>;
}
