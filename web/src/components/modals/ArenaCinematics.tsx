import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { GameEvent, GameView } from '../../game/application/contracts';
import { Card } from '../game/Card';
import { playerName } from '../game/gameDisplay';
import { ArenaDialog } from './ArenaDialog';

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function ArenaShuffle() {
  return <div className="intro-deck" aria-hidden="true">
    {(['magnata', 'executor', 'mercenario'] as const).map((character, index) =>
      <div className="intro-card" id={`icard-${index + 1}`} key={character}>
        <div className={`intro-face intro-front carta carta-${character}`} />
        <div className="intro-face intro-back carta carta-verso" />
      </div>)}
  </div>;
}

export function ArenaIntro({ onComplete }: { onComplete: () => void }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (reducedMotion()) {
      onComplete();
      return;
    }
    const duration = document.documentElement.dataset.fx === 'lite' ? 1800 : 3000;
    const fade = window.setTimeout(() => setFading(true), duration);
    const end = window.setTimeout(onComplete, duration + 500);
    return () => { window.clearTimeout(fade); window.clearTimeout(end); };
  }, [onComplete]);

  return <div id="intro-overlay" role="status" className={fading ? 'arena-intro-fading' : undefined}>
    <ArenaShuffle />
    <div className="intro-text">EMBARALHANDO DADOS...</div>
  </div>;
}

function playImpact(): (() => void) | undefined {
  let context: AudioContext | undefined;
  try {
    const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    context = new Audio();
    const time = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.34, time + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.72);
    gain.connect(context.destination);

    const impact = context.createOscillator();
    impact.type = 'sawtooth';
    impact.frequency.setValueAtTime(92, time);
    impact.frequency.exponentialRampToValueAtTime(34, time + 0.62);
    impact.connect(gain);
    impact.start(time);
    impact.stop(time + 0.72);

    const noise = context.createBufferSource();
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.22), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
    }
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.18, time + 0.1);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    noise.buffer = buffer;
    noise.connect(noiseGain);
    noiseGain.connect(context.destination);
    noise.start(time + 0.1);
    noise.stop(time + 0.35);
  } catch {
    void context?.close().catch(() => undefined);
    return;
  }
  const audioContext = context;
  const close = () => {
    if (audioContext.state !== 'closed') void audioContext.close().catch(() => undefined);
  };
  const timeout = window.setTimeout(close, 900);
  return () => { window.clearTimeout(timeout); close(); };
}

export function ArenaCinematic({ view, event, onComplete, allowAudio = true }: {
  view: GameView; event: GameEvent; onComplete: () => void; allowAudio?: boolean;
}) {
  const backstab = event.kind === 'backstab';
  useEffect(() => {
    const reduced = reducedMotion();
    const timeout = window.setTimeout(onComplete, reduced ? 350 : backstab ? 2500 : 1750);
    const stopAudio = backstab && !reduced && allowAudio ? playImpact() : undefined;
    if (backstab && !reduced) navigator.vibrate?.([45, 35, 110]);
    return () => {
      window.clearTimeout(timeout);
      stopAudio?.();
      if (backstab && !reduced) navigator.vibrate?.(0);
    };
  }, [allowAudio, backstab, onComplete]);

  const actor = playerName(view, event.playerId);
  if (!backstab) return <div id="defeat-cinematic" className="defeat-cinematic active" role="status">
    <div className="defeat-scanlines" aria-hidden="true" />
    <div className="defeat-content">
      <img className="defeat-isotipo" src="images/isotipo.png" alt="" />
      <span>SINAL PERDIDO</span>
      <strong>ELIMINADO</strong>
      <p id="defeat-player">{actor} perdeu todas as influências</p>
    </div>
  </div>;

  return <div id="backstab-cinematic" className="backstab-cinematic active" role="status">
    {['curtain curtain-left', 'curtain curtain-right', 'noise', 'rift rift-main', 'rift rift-echo', 'shockwave']
      .map((decoration) => <div className={decoration.split(' ').map((name) => `backstab-${name}`).join(' ')}
        key={decoration} aria-hidden="true" />)}
    <div className="backstab-impact-content">
      <span className="backstab-eyebrow">PROTOCOLO IRREVERSÍVEL // 7 CRÉDITOS</span>
      <div className="backstab-logo-frame" aria-hidden="true"><img src="images/isologo.png" alt="" /></div>
      <strong className="backstab-impact-title" data-text="BACKSTAB">BACKSTAB</strong>
      <p id="backstab-impact-message">{actor} rompeu a defesa de {playerName(view, event.targetId ?? '')}</p>
    </div>
  </div>;
}

const particleColors = ['#00f3ff', '#ffffff', '#ff0055', '#5effff'];
const particleCounts: Record<string, number> = { reduced: 0, lite: 10, balanced: 18, full: 28 };

function VictoryParticles() {
  const count = particleCounts[document.documentElement.dataset.fx ?? 'full'] ?? 28;
  return <div id="victory-particles" className="victory-particles" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <i className="victory-particle" key={index} style={{
      '--particle-x': `${(index * 37) % 101}%`,
      '--particle-size': `${3 + (index % 5)}px`,
      '--particle-color': particleColors[index % particleColors.length],
      '--particle-speed': `${3.4 + (index % 7) * 0.38}s`,
      '--particle-delay': `${(index % 9) * -0.37}s`,
      '--particle-drift': `${-80 + (index % 11) * 16}px`,
      '--particle-rotation': `${index * 19}deg`,
    } as CSSProperties} />)}
  </div>;
}

export function VictoryDialog({ view, onRematch, onExit, online }: {
  view: GameView;
  onRematch?: () => void;
  onExit: () => void;
  online?: { viewerId: string; busy: boolean; details?: ReactNode };
}) {
  if (view.phase.kind !== 'finished') return null;
  const cards = !online || online.viewerId === view.phase.winnerId ? view.phase.cards : [];
  return <ArenaDialog id="victory-modal" titleId="victory-title"
    className={`victory-overlay${online ? ' online-victory' : ''}`}>
    <div className="victory-grid" aria-hidden="true" />
    <div className="victory-rays" aria-hidden="true" />
    <VictoryParticles />
    <section className="victory-content">
      <div className="victory-emblem" aria-hidden="true">
        <span className="victory-emblem-ring" />
        <img className="victory-isotipo" src="images/isotipo.png" alt="" />
      </div>
      <span className="victory-kicker">TRANSMISSÃO CONCLUÍDA // ÚLTIMO SOBREVIVENTE</span>
      <h2 id="victory-title" data-text="VITÓRIA">VITÓRIA</h2>
      <p className="victory-announcement"><strong id="victory-player">{playerName(view, view.phase.winnerId)}</strong><span>DOMINOU A MESA</span></p>
      {cards.length > 0 && <div className="victory-card-vault">
        <span className="victory-cards-label">INFLUÊNCIAS RESTANTES</span>
        <div id="victory-cards" className="victory-cards" aria-live="polite">
          {cards.map((card, index) => <Card className="victory-card" key={card.id} character={card.character}
            animationDelay={`${index * 120}ms`} />)}
        </div>
      </div>}
      <div className={`victory-actions${!onRematch ? ' victory-single-action' : ''}`}>
        {onRematch && <button type="button" id="btn-play-again" className="btn-victory-primary" disabled={online?.busy}
          onClick={onRematch}>{online ? 'Jogar revanche' : 'Jogar novamente'}</button>}
        <button type="button" id="btn-victory-menu" className="btn-victory-secondary" onClick={onExit}
          title={online ? 'Voltar ao menu principal' : undefined}>
          {online ? 'Sair da arena' : 'Voltar ao menu principal'}
        </button>
      </div>
      {online?.details}
    </section>
  </ArenaDialog>;
}
