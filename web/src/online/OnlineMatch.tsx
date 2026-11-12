import { useEffect, useRef, useState } from 'react';
import { createClientId } from '../game/application/clientId';
import type { OnlineCommand, OnlineView } from '../game/application/online-contracts';
import { ArenaOnline } from './ArenaOnline';
import type { OnlineApi } from './api';

const mobile = '(max-width: 900px), (max-height: 600px) and (pointer: coarse)';
const messages: Record<string, string> = {
  STALE_REVISION: 'A partida avançou. Confira o estado atualizado.',
  ALREADY_RESPONDED: 'Sua resposta já foi registrada.',
  INVALID_PHASE: 'Esta decisão não está mais disponível.',
  INVALID_COMMAND: 'A jogada foi rejeitada.',
  NOT_AUTHORIZED: 'Essa decisão pertence a outro jogador.',
  UNAUTHENTICATED: 'A sessão expirou. Entre novamente.',
  NOT_FOUND: 'Partida indisponível.',
};

function code(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

export function OnlineMatch({ matchId, roomId, api, connectedIds, matchInvalidation, onExit }: {
  matchId: string;
  roomId: string;
  api: OnlineApi;
  connectedIds: string[];
  matchInvalidation: number;
  onExit: () => void;
}) {
  const [view, setView] = useState<OnlineView>();
  const [error, setError] = useState<string>();
  const [connectionError, setConnectionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const path = `/matches/${matchId}`;

  function accept(next: OnlineView) {
    setView(current => !current || (next.revision >= current.revision && (!current.closed || next.closed)) ? next : current);
  }

  useEffect(() => {
    let disposed = false;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const next = await api.request<OnlineView>(path);
        if (!disposed) {
          accept(next);
          setConnectionError(false);
        }
      } catch {
        if (!disposed) setConnectionError(true);
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    window.addEventListener('online', refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
    };
  }, [api, path, matchInvalidation]);

  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
    } catch (failure) {
      setError(messages[code(failure)] ?? 'Falha ao comunicar com a partida. Tente novamente.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    const next = await api.request<OnlineView>(path);
    accept(next);
    return next;
  }

  function send(command: OnlineCommand) {
    if (!view) return;
    void run(async () => {
      const commandId = createClientId();
      const submit = (expectedRevision: number) => api.request(`${path}/commands`, 'POST', {
        protocolVersion: 1, commandId, expectedRevision, command,
      });
      let revision = view.revision;
      // At most nine other eligible participants can race this vote in one window.
      for (let attempt = 0; ; attempt++) {
        try {
          await submit(revision);
          break;
        } catch (failure) {
          if (code(failure) !== 'STALE_REVISION') throw failure;
          const fresh = await refresh();
          if (command.type !== 'vote' || fresh.window?.id !== command.windowId || !fresh.window.options.length
            || attempt >= 9 || fresh.revision <= revision) throw failure;
          revision = fresh.revision;
        }
      }
      await refresh();
    });
  }

  return <>
    <link rel="stylesheet" href="css/style-game.css" />
    <link rel="stylesheet" href="css/mobile-game.css" media={mobile} />
    {view ? <ArenaOnline view={view} connectedIds={connectedIds} busy={busy}
      error={error ?? (connectionError ? 'Reconectando à partida…' : undefined)}
      send={send} onExit={onExit}
      onRematch={() => void run(async () => accept(await api.request<OnlineView>(`${path}/rematch`, 'POST')))}
      onCloseMatch={() => void run(async () => {
        await api.request(`/rooms/${roomId}/close`, 'POST');
        await refresh();
      })} /> : <main className="overlay active">
      <p role="status">{connectionError ? 'Reconectando à partida…' : 'Carregando partida…'}</p>
      <button className="btn-pass" onClick={onExit}>Sair da arena</button>
    </main>}
  </>;
}
