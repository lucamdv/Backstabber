import type { ReactNode } from 'react';

const shapes = {
  identity: <><path d="M6 8a6 6 0 0 1 12 0v3m-15 2V9a9 9 0 1 1 18 0v5M5 19l1-6m3 9c2-4 3-8 3-13m4 12a28 28 0 0 0 2-7M9 15l.5-6a2.5 2.5 0 0 1 5 0c0 4-.5 7-1.5 10m7.5-1.5-.5 2" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M2 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6m2 3a4 4 0 0 1 4 4v2" /></>,
  addUser: <><circle cx="9" cy="8" r="3" /><path d="M2 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M19 6v8m-4-4h8" /></>,
  rooms: <path d="M4 21h16M6 21V3h11v18M11 12h2m4-9 3 2v14l-3 2" />,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /></>,
  send: <path d="m3 10 18-7-6 18-4-8-8-3Zm8 3L21 3" />,
  trash: <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15m-8 4v7m4-7v7" />,
  plus: <path d="M12 4v16M4 12h16" />,
  enter: <path d="M14 4h6v16h-6M3 12h12m-4-4 4 4-4 4" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  exit: <path d="M10 4H4v16h6m0-8h11m-4-4 4 4-4 4" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M16 5V3H4v14h2" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  play: <path d="M7 4v16l13-8-13-8Z" />,
  local: <><rect x="3" y="5" width="18" height="12" rx="1" /><path d="M8 21h8m-4-4v4m-5-10h4m-2-2v4m6-2h1m1-2h1" /></>,
  network: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01" /></>,
  settings: <><path d="m10 3-.5 2.5-2 1-2.5-.8-2 3.4 1.8 1.8v2.2L3 15l2 3.4 2.5-.8 2 1 .5 2.4h4l.5-2.4 2-1 2.5.8 2-3.4-1.8-1.9v-2.2L21 9l-2-3.3-2.5.8-2-1L14 3Z" /><circle cx="12" cy="12" r="3" /></>,
} satisfies Record<string, ReactNode>;

export type GameIconName = keyof typeof shapes;

export function GameIcon({ name }: { name: GameIconName }) {
  return <svg className="game-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
