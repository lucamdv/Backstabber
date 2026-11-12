import type { CSSProperties, ReactNode } from 'react';
import { Card } from '../components/game/Card';
import { ArenaDialog } from '../components/modals/ArenaDialog';
import type { Card as Influence } from '../game/application/contracts';

export function OnlineResult({ won, winner, cards, busy, onRematch, onExit, children }: {
  won: boolean;
  winner: string;
  cards: Influence[];
  busy: boolean;
  onRematch?: () => void;
  onExit: () => void;
  children?: ReactNode;
}) {
  const title = won ? 'VITÓRIA' : 'DERROTA';

  return <ArenaDialog id="online-result" titleId="online-result-title"
    className={`online-result ${won ? 'online-result-win' : 'online-result-loss'}`}>
    <div className="online-result-field" aria-hidden="true">
      {won && Array.from({ length: 12 }, (_, index) => <i key={index} style={{
        '--x': `${10 + (index * 37) % 80}%`,
        '--y': `${18 + (index * 19) % 62}%`,
        '--delay': `${index * 35}ms`,
      } as CSSProperties} />)}
    </div>
    <section className="online-result-sheet">
      <img className="online-result-mark" src="images/isotipo.png" alt="" />
      <p className="online-result-kicker">{won ? 'CONTROLE DA MESA CONFIRMADO' : 'SINAL INTERROMPIDO'}</p>
      <h2 id="online-result-title">{title}</h2>
      <p className="online-result-winner"><strong>{winner}</strong> dominou a mesa.</p>
      {!won && <p>Sua influência caiu. A mesa tem um novo operador no comando.</p>}
      {won && cards.length > 0 && <div className="online-result-cards">
        <p>INFLUÊNCIAS RESTANTES</p>
        <div className="hand">
          {cards.map(card => <Card key={card.id} character={card.character} />)}
        </div>
      </div>}
      <div className="online-decision-buttons">
        {onRematch && <button type="button" className="btn-challenge" disabled={busy} onClick={onRematch}>Jogar revanche</button>}
        <button type="button" className="btn-pass" onClick={onExit}>Sair da arena</button>
      </div>
      {!onRematch && <p className="online-result-wait">O anfitrião pode iniciar a revanche.</p>}
      {children}
    </section>
  </ArenaDialog>;
}
