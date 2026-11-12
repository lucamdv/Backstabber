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
) {
  const [presence, setPresence] = useState<{ roomId: string; userIds: ReadonlySet<string> }>();

  useEffect(() => {
    if (!roomId) return;
    const topic = `room:${roomId}`;
    return subscribeAfterLeave(client, topic, isActive => {
      const channel = client.channel(topic, { config: { private: true, presence: { key: userId } } });
      return channel.on('broadcast', { event: 'invalidate' }, () => { if (isActive()) invalidate(); })
        .on('presence', { event: 'sync' }, () => {
          if (isActive()) setPresence({ roomId, userIds: new Set(Object.keys(channel.presenceState())) });
        })
        .subscribe(status => {
          if (!isActive()) return;
          if (status === 'SUBSCRIBED') {
            void channel.track({ connected: true }).catch(() => undefined);
            invalidate();
          } else {
            setPresence(current => current?.roomId === roomId ? undefined : current);
          }
        });
    });
  }, [client, roomId, userId, invalidate]);

  return presence?.roomId === roomId ? presence?.userIds : undefined;
}
