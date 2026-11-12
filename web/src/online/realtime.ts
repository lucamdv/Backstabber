import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function usePrivateBroadcast(client: SupabaseClient, topic: string, invalidate: () => void) {
  useEffect(() => {
    const channel = client.channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'invalidate' }, invalidate)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') invalidate();
      });
    return () => { void client.removeChannel(channel); };
  }, [client, topic, invalidate]);
}

export function useRoomRealtime(
  client: SupabaseClient, roomId: string | undefined, userId: string, invalidate: () => void,
) {
  const [presence, setPresence] = useState<{ roomId: string; userIds: ReadonlySet<string> }>();

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const channel = client.channel(`room:${roomId}`, { config: { private: true, presence: { key: userId } } });
    channel.on('broadcast', { event: 'invalidate' }, invalidate)
      .on('presence', { event: 'sync' }, () => {
        if (active) setPresence({ roomId, userIds: new Set(Object.keys(channel.presenceState())) });
      })
      .subscribe(status => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          void channel.track({ connected: true });
          invalidate();
        } else {
          setPresence(current => current?.roomId === roomId ? undefined : current);
        }
      });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, roomId, userId, invalidate]);

  return presence?.roomId === roomId ? presence?.userIds : undefined;
}
