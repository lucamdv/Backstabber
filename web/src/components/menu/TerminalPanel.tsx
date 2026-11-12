import type { ReactNode } from 'react';
import { useDialogKeyboard } from '../shared/useDialogKeyboard';

type TerminalPanelProps = {
  panel: 'jogar' | 'amigos' | 'config';
  title: string;
  focusClose?: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function TerminalPanel({ panel, title, focusClose = true, onClose, children }: TerminalPanelProps) {
  const keyboard = useDialogKeyboard<HTMLDivElement>(onClose);
  return (
    <div
      {...keyboard}
      id={`panel-${panel}`}
      className="terminal-modal active-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`title-${panel}`}
    >
      <button type="button" className="close-btn" aria-label="Fechar painel" data-initial-focus={focusClose ? true : undefined} onClick={onClose}>✖</button>
      <h2 className="neon-text" id={`title-${panel}`}>{title}</h2>
      {children}
    </div>
  );
}
