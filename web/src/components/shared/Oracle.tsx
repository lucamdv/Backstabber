import type { CSSProperties } from 'react';
import { useDialogKeyboard } from './useDialogKeyboard';

const cards = [
  {
    name: 'Magnata',
    image: 'magnata',
    action: 'Recebe 3 Créditos do tesouro ao declarar Taxa.',
    blocks: 'Patrocínio — impede qualquer jogador de receber 2 Créditos.',
    blockedBy: 'Ninguém. A Taxa não pode ser bloqueada.',
  },
  {
    name: 'Executor',
    image: 'executor',
    action: 'Paga 3 Créditos para eliminar uma influência de outro jogador.',
    blocks: 'Nenhuma ação.',
    blockedBy: 'Sentinela.',
  },
  {
    name: 'Sentinela',
    image: 'sentinela',
    action: 'Não possui ação própria no turno.',
    blocks: 'Executor — protege sua influência da eliminação.',
    blockedBy: 'Não se aplica, pois não possui ação própria.',
  },
  {
    name: 'Mercenário',
    image: 'mercenario',
    action: 'Rouba até 2 Créditos de outro jogador.',
    blocks: 'Outro Mercenário.',
    blockedBy: 'Mercenário ou Broker.',
  },
  {
    name: 'Broker',
    image: 'broker',
    action: 'Compra 2 cartas, escolhe quais influências manter e devolve 2 cartas ao baralho.',
    blocks: 'Mercenário — impede que seus Créditos sejam roubados.',
    blockedBy: 'Ninguém. A negociação não pode ser bloqueada.',
  },
] as const;

export function Oracle({ onClose }: { onClose: () => void }) {
  const keyboard = useDialogKeyboard<HTMLDivElement>(onClose);

  return (
    <div
      {...keyboard}
      id="oracle-modal"
      className="oracle-overlay is-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oracle-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <OraclePanel onClose={onClose} />
    </div>
  );
}

export function OraclePanel({ onClose }: { onClose: () => void }) {
  return <section className="oracle-shell" tabIndex={0} aria-label="Cartas do Oráculo">
    <header className="oracle-header">
      <div>
        <span className="oracle-kicker">BANCO DE DADOS // INFLUÊNCIAS</span>
        <h2 id="oracle-title">ORÁCULO</h2>
        <p>Consulte ações, defesas e vulnerabilidades antes de declarar sua jogada.</p>
      </div>
      <button type="button" className="oracle-close" aria-label="Fechar Oráculo" data-initial-focus onClick={onClose}>✕</button>
    </header>
    <div className="oracle-grid">
      {cards.map(({ name, image, action, blocks, blockedBy }, index) => (
        <article key={image} className="oracle-card" style={{ '--oracle-index': index } as CSSProperties}>
          <img className="oracle-card-image" src={`images/${image}_card.png`} alt={`Carta ${name}`} loading="lazy" />
          <div className="oracle-card-content">
            <h3>{name}</h3>
            <section><h4>AÇÃO</h4><p>{action}</p></section>
            <section><h4>BLOQUEIA</h4><p>{blocks}</p></section>
            <section><h4>PODE SER BLOQUEADO POR</h4><p>{blockedBy}</p></section>
          </div>
        </article>
      ))}
    </div>
  </section>;
}
