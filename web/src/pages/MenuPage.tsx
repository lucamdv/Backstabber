import { useEffect, useRef, useState } from 'react';
import { MenuBackdrop } from '../components/menu/MenuBackdrop';
import { SetupPanel } from '../components/menu/SetupPanel';
import { TerminalPanel } from '../components/menu/TerminalPanel';
import { Oracle } from '../components/shared/Oracle';
import '../components/menu/menu.css';

type MenuPageProps = {
  onStart: (names: string[]) => void;
  onResume?: () => void;
  onOnline?: () => void;
  notice?: string;
};

const entries = [
  { panel: 'jogar', className: 'menu-start-btn', label: 'Jogar', mobile: 'START', iconClass: 'menu-mobile-label' },
  { panel: 'amigos', className: 'menu-friends-btn', label: 'Amigos', mobile: '', iconClass: 'menu-icon menu-icon-profile' },
  { panel: 'config', className: 'menu-settings-btn', label: 'Configurações', mobile: '⚙', iconClass: 'menu-icon menu-icon-settings' },
  { panel: 'oracle', className: 'oracle-menu-btn', label: 'Abrir Oráculo', mobile: '?', iconClass: 'menu-icon menu-icon-help' },
] as const;

type Panel = typeof entries[number]['panel'];

export default function MenuPage({ onStart, onResume, onOnline, notice }: MenuPageProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = () => setPanel(null);

  useEffect(() => {
    if (panel === null) launcher.current?.focus();
  }, [panel]);

  return (
    <>
      <MenuBackdrop paused={panel === 'oracle'} />
      <nav className="main-menu" aria-label="Menu principal" inert={panel !== null}>
        {entries.map((entry) => (
          <button
            key={entry.panel}
            type="button"
            className={`menu-btn ${entry.className}${panel === entry.panel ? ' active' : ''}`}
            aria-label={entry.label}
            aria-haspopup={entry.panel === 'amigos' && onOnline ? undefined : 'dialog'}
            aria-controls={panel === entry.panel ? (entry.panel === 'oracle' ? 'oracle-modal' : `panel-${entry.panel}`) : undefined}
            aria-expanded={panel === entry.panel}
            onClick={(event) => {
              if (entry.panel === 'amigos' && onOnline) {
                onOnline();
                return;
              }
              launcher.current = event.currentTarget;
              setPanel(entry.panel);
            }}
          >
            <span className="menu-desktop-label">{entry.panel === 'oracle' ? '? ORÁCULO' : `▶ ${entry.label.toUpperCase()}`}</span>
            <span className={entry.iconClass} aria-hidden="true">{entry.mobile}</span>
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
