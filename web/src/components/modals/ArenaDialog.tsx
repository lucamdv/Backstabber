import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ArenaDialogProps {
  id: string;
  titleId: string;
  className?: string;
  placement?: 'stage';
  children: ReactNode;
  onEscape?: () => void;
}

export function ArenaDialog({ id, titleId, className = '', placement, children, onEscape }: ArenaDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  const inStage = placement === 'stage';
  return <div id={id} ref={dialog} className={inStage ? className : `overlay active ${className}`}
    role={inStage ? 'region' : 'dialog'} aria-modal={inStage ? undefined : true}
    aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last && first) {
        event.preventDefault();
        first.focus();
      }
    }}>{children}</div>;
}
