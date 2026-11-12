import { useCallback, useEffect, useRef, useState } from 'react';
import { createClientId } from '../game/application/clientId';
import type { OnlineCommand, OnlineView } from '../game/application/online-contracts';
import { ArenaOnline } from './ArenaOnline';
import { OnlineApiError } from './api';
import type { OnlineApi } from './api';

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

export function OnlineMatch({ matchId, roomId, api, connectedIds, matchInvalidation, onExit, startedFromLobby }: {
  matchId: string;
  roomId: string;
  api: OnlineApi;
  connectedIds: string[];
  matchInvalidation: number;
  onExit: () => void;
  startedFromLobby?: boolean;
}) {
  const [view, setView] = useState<OnlineView>();
  const [playIntro, setPlayIntro] = useState(Boolean(startedFromLobby));
  const [error, setError] = useState<string>();
  const [connectionError, setConnectionError] = useState(false);
  const [accessError, setAccessError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const accessEpoch = useRef(0);
  const path = `/matches/${matchId}`;

  useEffect(() => {
    if (view && playIntro) setPlayIntro(false);
  }, [playIntro, view]);

  const accept = useCallback((next: OnlineView) => {
    setView(current => !current || (next.revision >= current.revision && (!current.closed || next.closed)) ? next : current);
  }, []);

  const loadSnapshot = useCallback(async (isCurrent: () => boolean = () => true) => {
    const epoch = accessEpoch.current;
    try {
      const next = await api.request<OnlineView>(path);
      if (isCurrent() && epoch === accessEpoch.current) {
        accept(next);
        setAccessError(undefined);
        setConnectionError(false);
      }
      return next;
    } catch (failure) {
      if (isCurrent() && epoch === accessEpoch.current) {
        if (failure instanceof OnlineApiError && [401, 403, 404].includes(failure.status)) {
          accessEpoch.current++;
          setView(undefined);
          setAccessError(failure.status === 401 ? messages.UNAUTHENTICATED : messages.NOT_FOUND);
        } else {
          setConnectionError(true);
        }
      }
      throw failure;
    }
  }, [accept, api, path]);

  useEffect(() => {
    let disposed = false;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        await loadSnapshot(() => !disposed);
      } catch {
        // The snapshot loader reports failure in the arena.
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
  }, [loadSnapshot, matchInvalidation]);

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
          const fresh = await loadSnapshot();
          if (command.type !== 'vote' || fresh.window?.id !== command.windowId || !fresh.window.options.length
            || attempt >= 9 || fresh.revision <= revision) throw failure;
          revision = fresh.revision;
        }
      }
      await loadSnapshot();
    });
  }

  return <>
    <link rel="stylesheet" href="css/style-game.css" />
    {view ? <ArenaOnline view={view} connectedIds={connectedIds} busy={busy} playIntro={playIntro}
      error={error ?? (connectionError ? 'Reconectando à partida…' : undefined)}
      send={send} onExit={onExit}
      onRematch={() => void run(async () => {
        await api.request<OnlineView>(`${path}/rematch`, 'POST');
        await loadSnapshot();
      })}
      onCloseMatch={() => void run(async () => {
        await api.request(`/rooms/${roomId}/close`, 'POST');
        await loadSnapshot();
      })} /> : <main className="overlay active">
      <p role={accessError ? 'alert' : 'status'}>{accessError ?? (connectionError ? 'Reconectando à partida…' : 'Carregando partida…')}</p>
      <button className="btn-pass" onClick={onExit}>Sair da arena</button>
    </main>}
  </>;
}
