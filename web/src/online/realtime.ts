import { useEffect, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

const releasing = new WeakMap<SupabaseClient, Map<string, Promise<unknown>>>();

function subscribeAfterLeave(
  client: SupabaseClient, topic: string, open: (isActive: () => boolean) => RealtimeChannel,
) {
  let closing = releasing.get(client);
  if (!closing) {
    closing = new Map();
    releasing.set(client, closing);
  }
  const pendingLeaves = closing;
  let active = true;
  let channel: RealtimeChannel | undefined;
  const begin = () => { if (active) channel = open(() => active); };
  const previous = pendingLeaves.get(topic);
  // The SDK reuses a channel with the same topic until its async leave finishes.
  if (previous) void previous.then(begin);
  else begin();

  return () => {
    active = false;
    if (!channel) return;
    const leaving = client.removeChannel(channel);
    const release = Promise.resolve(leaving).catch(() => undefined);
    pendingLeaves.set(topic, release);
    void release.then(() => {
      if (pendingLeaves.get(topic) === release) pendingLeaves.delete(topic);
    });
  };
}

export function usePrivateBroadcast(client: SupabaseClient, topic: string, invalidate: () => void) {
  useEffect(() => subscribeAfterLeave(client, topic, isActive => {
    const refresh = () => { if (isActive()) invalidate(); };
    return client.channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'invalidate' }, refresh)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') refresh();
      });
  }), [client, topic, invalidate]);
}

export function useRoomRealtime(
  client: SupabaseClient, roomId: string | undefined, userId: string, invalidate: () => void,
  refreshPresence: () => void,
) {
  const [presence, setPresence] = useState<{ roomId: string; userIds: ReadonlySet<string> }>();
  const [unavailableRoom, setUnavailableRoom] = useState<string>();

  useEffect(() => {
    setPresence(undefined);
    setUnavailableRoom(undefined);
    if (!roomId) return;
    const topic = `room:${roomId}`;
    let presenceTimer: number | undefined;
    let failureTimer: number | undefined;
    let observedRoster: string | undefined;
    const release = subscribeAfterLeave(client, topic, isActive => {
      const channel = client.channel(topic, { config: { private: true, presence: { key: userId } } });
      return channel.on('broadcast', { event: 'invalidate' }, () => { if (isActive()) invalidate(); })
        .on('presence', { event: 'sync' }, () => {
          if (!isActive()) return;
          const ids = Object.keys(channel.presenceState()).sort();
          setPresence({ roomId, userIds: new Set(ids) });
          window.clearTimeout(presenceTimer);
          if (!ids.includes(userId)) {
            observedRoster = undefined;
            return;
          }
          const roster = JSON.stringify(ids);
          if (observedRoster === undefined) observedRoster = roster;
          if (observedRoster !== roster) presenceTimer = window.setTimeout(() => {
            observedRoster = roster;
            refreshPresence();
          }, 1000);
        })
        .subscribe(status => {
          if (!isActive()) return;
          if (status === 'SUBSCRIBED') {
            window.clearTimeout(failureTimer);
            failureTimer = undefined;
            setUnavailableRoom(current => current === roomId ? undefined : current);
            void channel.track({ connected: true }).catch(() => undefined);
            invalidate();
          } else {
            window.clearTimeout(presenceTimer);
            observedRoster = undefined;
            failureTimer ??= window.setTimeout(() => setUnavailableRoom(roomId), 2000);
            setPresence(current => current?.roomId === roomId ? undefined : current);
          }
        });
    });
    return () => {
      window.clearTimeout(presenceTimer);
      window.clearTimeout(failureTimer);
      release();
    };
  }, [client, roomId, userId, invalidate, refreshPresence]);

  return {
    presence: presence?.roomId === roomId ? presence?.userIds : undefined,
    realtimeUnavailable: roomId !== undefined && unavailableRoom === roomId,
  };
}
