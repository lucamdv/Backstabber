import { useEffect, useRef, useState } from 'react';
import { MenuBackdrop } from '../components/menu/MenuBackdrop';
import { SetupPanel } from '../components/menu/SetupPanel';
import { TerminalPanel } from '../components/menu/TerminalPanel';
import { GameIcon } from '../components/shared/GameIcon';
import { Oracle } from '../components/shared/Oracle';
import '../components/menu/menu.css';

type MenuPageProps = {
  onStart: (names: string[]) => void;
  onResume?: () => void;
  onOnline?: () => void;
  onFriends?: () => void;
  notice?: string;
};

const entries = [
  { panel: 'jogar', className: 'menu-start-btn', label: 'START', text: 'START', icon: 'play' },
  { panel: 'amigos', className: 'menu-friends-btn', label: 'Amigos', text: 'Amigos', icon: 'users' },
  { panel: 'config', className: 'menu-settings-btn', label: 'Configurações', text: 'Configurações', icon: 'settings' },
  { panel: 'oracle', className: 'oracle-menu-btn', label: 'Abrir Oráculo', text: 'Oráculo', icon: 'help' },
] as const;

type Panel = typeof entries[number]['panel'];

export default function MenuPage({ onStart, onResume, onOnline, onFriends, notice }: MenuPageProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = () => setPanel(null);

  useEffect(() => {
    if (panel === null) launcher.current?.focus();
  }, [panel]);

  return (
    <>
      <MenuBackdrop paused={panel === 'oracle'} />
      <nav className="main-menu react-menu-controls" aria-label="Menu principal" inert={panel !== null}>
        {entries.map((entry) => (
          <button
            key={entry.panel}
            type="button"
            className={`menu-btn ${entry.className}${panel === entry.panel ? ' active' : ''}`}
            aria-label={entry.label}
            aria-haspopup={entry.panel === 'amigos' && onFriends ? undefined : 'dialog'}
            aria-controls={panel === entry.panel ? (entry.panel === 'oracle' ? 'oracle-modal' : `panel-${entry.panel}`) : undefined}
            aria-expanded={panel === entry.panel}
            onClick={(event) => {
              if (entry.panel === 'amigos' && onFriends) {
                onFriends();
                return;
              }
              launcher.current = event.currentTarget;
              setPanel(entry.panel);
            }}
          >
            <GameIcon name={entry.icon} />
            <span className={entry.panel === 'jogar' ? 'menu-start-label' : 'menu-desktop-label'}>{entry.text}</span>
          </button>
        ))}
      </nav>
      {notice && <p className="menu-notice" role="status">{notice}</p>}
      <SetupPanel active={panel === 'jogar'} onStart={onStart} onResume={onResume} onOnline={onOnline} onClose={close} />
      {panel === 'amigos' && (
        <TerminalPanel panel="amigos" title="AMIGOS" onClose={close}>
          <p className="glitch-text menu-offline-message">SINAL PERDIDO. NENHUM ALIADO ENCONTRADO NA REDE.</p>
        </TerminalPanel>
      )}
      {panel === 'config' && (
        <TerminalPanel panel="config" title="SISTEMA" onClose={close}>
          <p className="glitch-text menu-offline-message">ACESSO RESTRITO. REQUER CREDENCIAIS NÍVEL 4.</p>
        </TerminalPanel>
      )}
      {panel === 'oracle' && <Oracle onClose={close} />}
    </>
  );
}
