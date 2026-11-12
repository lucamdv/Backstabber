import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Action, GameView } from '../../game/application/contracts';
import { Card } from './Card';
import { actions, characterName, playerName } from './gameDisplay';

type Drawer = 'tribunal' | 'cemetery' | 'scoreboard';

interface ArenaBoardProps {
  view: GameView;
  blocked: boolean;
  hideHand: boolean;
  onAction: (action: Action) => void;
  onOracle: () => void;
  onPause: () => void;
  online?: {
    viewerId: string;
    connectedIds: string[];
    panel: ReactNode;
    showActions: boolean;
    actionsDisabled: boolean;
  };
}

function PlayerStats({ view, online }: Pick<ArenaBoardProps, 'view' | 'online'>) {
  return view.players.map((player) => {
    const connected = online?.connectedIds.includes(player.id);
    return <div key={player.id} aria-current={player.id === view.activeId || undefined}
      className={`player-stat${player.id === view.activeId ? ' active' : ''}${online?.viewerId === player.id ? ' online-viewer' : ''}`}>
      <strong title={player.name}>{player.name}</strong>
      <span className="player-resources">
        <span className="player-resource player-credits"><b key={online ? player.credits : undefined}>{player.credits}</b><small>CRÉDITOS</small></span>
        <span className="player-resource player-influences"><b key={online ? player.influence : undefined}>{player.influence}</b><small>INFL.</small></span>
      </span>
      {online && <span className="online-player-presence" data-connected={connected}>
        {connected ? 'Conectado' : 'Desconectado'}
        {player.influence === 0 && ' · Eliminado'}
      </span>}
    </div>;
  });
}

function Scoreboard({ view, onOracle, onPause, online }: Pick<ArenaBoardProps, 'view' | 'onOracle' | 'onPause' | 'online'>) {
  return <header className="hud-header">
    <div className="header-logo" role="img" aria-label="Backstabber">
      <img className="brand-isotipo" src="images/isotipo.png" alt="" />
      <span className="brand-isologo-frame" aria-hidden="true">
        <img className="brand-isologo" src="images/isologo.png" alt="" />
      </span>
    </div>
    <div className="header-center">
      <span className="turn-label">{online ? 'ARENA ONLINE' : 'STATUS DA MESA'}</span>
      <div id="scoreboard" className="scoreboard-bar" role={online ? 'group' : undefined}
        aria-label={online ? 'Placar e conexão dos jogadores' : undefined}>
        <PlayerStats view={view} online={online} />
      </div>
    </div>
    <div className="header-right">
      <div className="header-tools" aria-label="Controles da partida">
        <button type="button" className="header-tool-btn" aria-label="Abrir Oráculo" title="Oráculo" onClick={onOracle}>?</button>
        <button type="button" className="header-tool-btn" id="btn-pause"
          aria-label={online ? 'Abrir opções da partida' : 'Abrir menu de pausa'}
          title={online ? 'Opções da partida' : 'Pausar'} onClick={onPause}>☰</button>
      </div>
      <p>TRUST<br />IS A<br />CURRENCY.</p>
    </div>
  </header>;
}

function Playmat({ children }: { children?: ReactNode }) {
  return <div className="playmat-arena" aria-hidden={children ? undefined : true}>
    {children ?? <>
      <div className="crosshair top-left">+</div>
      <div className="crosshair top-right">+</div>
      <div className="crosshair bottom-left">+</div>
      <div className="crosshair bottom-right">+</div>
      <div className="arena-center-logo">👑</div>
      <div className="arena-border-label top">SISTEMA ONLINE</div>
      <div className="arena-border-label bottom">LADO ATIVO</div>
    </>}
  </div>;
}

export function ArenaBoard({ view, blocked, hideHand, onAction, onOracle, onPause, online }: ArenaBoardProps) {
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const openDrawer = blocked ? null : drawer;
  const tribunalTrigger = useRef<HTMLButtonElement>(null);
  const cemeteryTrigger = useRef<HTMLButtonElement>(null);
  const scoreboardTrigger = useRef<HTMLButtonElement>(null);
  const closeTribunal = useRef<HTMLButtonElement>(null);
  const closeCemetery = useRef<HTMLButtonElement>(null);
  const closeScoreboard = useRef<HTMLButtonElement>(null);
  const activeTrigger = openDrawer === 'tribunal' ? tribunalTrigger : openDrawer === 'cemetery' ? cemeteryTrigger : scoreboardTrigger;
  const activeClose = openDrawer === 'tribunal' ? closeTribunal : openDrawer === 'cemetery' ? closeCemetery : closeScoreboard;
  const currentPlayer = playerName(view, view.activeId);
  const handOwner = online?.viewerId ?? view.activeId;
  const handLabel = online ? 'Minhas influências' : `Influências de ${currentPlayer}`;

  function toggleDrawer(next: Drawer) {
    setDrawer((current) => current === next ? null : next);
  }

  function closeDrawer() {
    activeTrigger.current?.focus();
    setDrawer(null);
  }

  useEffect(() => {
    if (!openDrawer) return;
    activeClose.current?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setDrawer(null);
      activeTrigger.current?.focus();
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [activeClose, activeTrigger, openDrawer]);

  return <div className="hud-container" inert={blocked || undefined}>
    <Scoreboard view={view} online={online} onOracle={() => { setDrawer(null); onOracle(); }}
      onPause={() => { setDrawer(null); onPause(); }} />
    <main className="hud-body">
      <nav className="mobile-table-nav mobile-only" aria-label="Informações da mesa">
        <button type="button" ref={tribunalTrigger} id="btn-mobile-tribunal" className="mobile-table-button"
          aria-controls="mobile-tribunal-panel" aria-expanded={openDrawer === 'tribunal'} onClick={() => toggleDrawer('tribunal')}>
          <span aria-hidden="true">▤</span><small>REGISTRO</small>
        </button>
        <div className="mobile-deck-status" aria-label="Cartas restantes no baralho">
          <img src="images/verso_card.png" alt="" />
          <span>DECK <strong id="mobile-deck-count">{view.deckCount}</strong></span>
        </div>
        <button type="button" ref={cemeteryTrigger} id="btn-mobile-cemetery" className="mobile-table-button"
          aria-controls="mobile-cemetery-panel" aria-expanded={openDrawer === 'cemetery'} onClick={() => toggleDrawer('cemetery')}>
          <span aria-hidden="true">✦</span><small>DESCARTE</small>
        </button>
        {online && <button type="button" ref={scoreboardTrigger} className="mobile-table-button" aria-label="Mesa"
          aria-controls="mobile-scoreboard-panel" aria-expanded={openDrawer === 'scoreboard'} onClick={() => toggleDrawer('scoreboard')}>
          <span aria-hidden="true">◈</span><small>MESA</small>
        </button>}
      </nav>
      <aside className={`panel-left${openDrawer === 'tribunal' ? ' is-mobile-open' : ''}`}
        id="mobile-tribunal-panel" aria-label="Registro da mesa">
        <button type="button" className="mobile-panel-close mobile-only" aria-label="Fechar registro"
          ref={closeTribunal} tabIndex={openDrawer === 'tribunal' ? 0 : -1} onClick={closeDrawer}>✕</button>
        <div className="hud-box tribunal-box">
          <h3 className="box-title">TRIBUNAL</h3>
          <div className="tribunal-header"><span>JOGADOR</span><span>AÇÃO</span></div>
          <div className="log-scroll">
            <table id="action-log">
              <tbody id="action-log-body" aria-live="polite">
                {view.history.slice(0, 5).map((entry, index) => <tr key={index}><td>{entry.player}</td><td>{entry.text}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="deck-box">
          <img className="deck-card" src="images/verso_card.png" alt="Verso do baralho" />
          <div className="deck-info"><span>DECK</span><small id="deck-count">{view.deckCount} RESTANTES</small></div>
        </div>
      </aside>
      {online && openDrawer === 'scoreboard' && <aside className="panel-left online-scoreboard-drawer is-mobile-open mobile-only"
        id="mobile-scoreboard-panel" aria-label="Jogadores da mesa">
        <button type="button" className="mobile-panel-close" aria-label="Fechar placar" ref={closeScoreboard} onClick={closeDrawer}>✕</button>
        <h3 className="box-title">JOGADORES DA MESA</h3>
        <div className="online-scoreboard-list">
          <PlayerStats view={view} online={online} />
        </div>
      </aside>}
      <section className={`panel-center${online && !online.showActions ? ' online-no-action-bar' : ''}`}>
        <Playmat>{online?.panel}</Playmat>
        <div className="player-hand-container">
          <div className="turn-indicator"><span>{online ? 'JOGADOR ATIVO' : 'TERMINAL ATIVO'}</span><h2 id="current-player-name" key={online ? view.activeId : undefined} aria-live="polite">{currentPlayer}</h2></div>
          {online && !hideHand && <span className="online-hand-caption">SUAS INFLUÊNCIAS</span>}
          <div className="hand" id="player-hand" role={online ? 'group' : undefined} aria-live="polite" aria-label={handLabel}>
            {!hideHand && view.revealed && view.privatePlayerId === handOwner
              && view.hand.map((card) => <Card key={card.id} character={card.character} />)}
          </div>
        </div>
        {(!online || online.showActions) && <div className="actions-bar" id="action-panel">
          {(Object.keys(actions) as Action[]).map((action) => {
            const display = actions[action];
            return <button key={action} type="button" className="btn-action" id={`btn-${action}`}
              data-action={action} disabled={blocked || online?.actionsDisabled || !view.availableActions.includes(action)} onClick={() => onAction(action)}>
              {display.title}<span className="action-effect">{display.effect}</span>
              <small aria-hidden="true" data-mobile={display.mobile}>{display.note}</small>
              <span className="arena-sr-only">{display.note}</span>
            </button>;
          })}
        </div>}
      </section>
      <aside className={`panel-right${openDrawer === 'cemetery' ? ' is-mobile-open' : ''}`}
        id="mobile-cemetery-panel" aria-label="Cartas descartadas">
        <button type="button" className="mobile-panel-close mobile-only" aria-label="Fechar cemitério"
          ref={closeCemetery} tabIndex={openDrawer === 'cemetery' ? 0 : -1} onClick={closeDrawer}>✕</button>
        <div className="hud-box cemetery-box">
          <h3 className="box-title">CEMITÉRIO</h3>
          <ul id="cemetery-list" aria-live="polite">
            {view.cemetery.map((character, index) => <li key={index} data-personagem={characterName[character]}>
              <Card className="cemetery-card-art" character={character} label={`Carta descartada: ${characterName[character]}`} />
              <span className="cemetery-card-name">{characterName[character]}</span>
            </li>)}
          </ul>
        </div>
      </aside>
    </main>
    {openDrawer && <button type="button" id="mobile-drawer-scrim" className="mobile-drawer-scrim mobile-only is-open"
      aria-label="Fechar painel de informações" onClick={closeDrawer} />}
  </div>;
}
