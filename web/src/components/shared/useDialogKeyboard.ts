import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';

export function useDialogKeyboard<T extends HTMLElement>(onClose: () => void) {
  const dialog = useRef<T>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const node = dialog.current;
    const initialFocus = node?.querySelector<HTMLElement>('[data-initial-focus]');
    (initialFocus ?? node)?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<T>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const items = dialog.current?.querySelectorAll<HTMLElement>(focusable);
    const first = items?.[0];
    const last = items?.[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { ref: dialog, onKeyDown };
}
