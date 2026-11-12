import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { ArenaShuffle } from '../components/modals/ArenaCinematics';
import './arena-intro.css';

export const ONLINE_INTRO_DURATION = 5000;

export function OnlineArenaIntro({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(onComplete, reduced ? 700 : ONLINE_INTRO_DURATION);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return <div className="online-arena-intro" role="status" aria-label="Preparando a arena">
    <div className="online-intro-shuffle" aria-hidden="true">
      <ArenaShuffle />
      <span>Embaralhando influências</span>
    </div>
    <div className="online-intro-tunnel" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => <i key={index} style={{ '--ring': index } as CSSProperties} />)}
      <img src="images/isotipo.png" alt="" />
    </div>
    <span className="online-intro-arrival" aria-hidden="true">Bem-vindo à arena</span>
    <span className="online-intro-reduced" aria-hidden="true">Preparando a arena</span>
  </div>;
}
