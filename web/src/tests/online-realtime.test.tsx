import { act, renderHook } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, test, vi } from 'vitest';
import { usePrivateBroadcast, useRoomRealtime } from '../online/realtime';

test('waits for a private channel to leave before rejoining the same topic', async () => {
  let finishLeave: () => void = () => undefined;
  const leave = new Promise<void>(resolve => { finishLeave = resolve; });
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  const sdk = { channel: vi.fn().mockReturnValue(channel), removeChannel: vi.fn().mockReturnValue(leave) };
  const client = sdk as unknown as SupabaseClient;
  const onInvalidate = vi.fn();
  const first = renderHook(() => usePrivateBroadcast(client, 'user:eva', onInvalidate));
  first.unmount();
  renderHook(() => usePrivateBroadcast(client, 'user:eva', onInvalidate));

  expect(sdk.channel).toHaveBeenCalledTimes(1);
  await act(async () => { finishLeave(); await leave; });
  expect(sdk.channel).toHaveBeenCalledTimes(2);
  expect(sdk.channel).toHaveBeenLastCalledWith('user:eva', { config: { private: true } });
});

test('estabiliza o Presence antes de atualizar a sala e ignora sinais de uma inscrição reiniciada', () => {
  vi.useFakeTimers();
  try {
    let sync = () => {};
    let subscribe: (status: string) => void = () => {};
    let roster = { eva: [{}], bia: [{}] } as Record<string, unknown[]>;
    const channel = {
      on(event: string, _filter: object, handler: () => void) {
        if (event === 'presence') sync = handler;
        return this;
      },
      subscribe(handler: (status: string) => void) {
        subscribe = handler;
        return this;
      },
      track: vi.fn().mockResolvedValue('ok'),
      presenceState: () => roster,
    };
    const client = { channel: () => channel, removeChannel: vi.fn() } as unknown as SupabaseClient;
    const refresh = vi.fn();
    const hook = renderHook(({ roomId }) => useRoomRealtime(client, roomId, 'eva', refresh, refresh),
      { initialProps: { roomId: 'first' } });
    act(() => { subscribe('SUBSCRIBED'); sync(); });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      roster = { eva: [{}] };
      sync();
      vi.advanceTimersByTime(400);
      roster = { eva: [{}], bia: [{}] };
      sync();
      vi.advanceTimersByTime(1200);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { roster = { eva: [{}] }; sync(); vi.advanceTimersByTime(1000); });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => { subscribe('CHANNEL_ERROR'); vi.advanceTimersByTime(1999); });
    expect(hook.result.current.realtimeUnavailable).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current.realtimeUnavailable).toBe(true);
    expect(hook.result.current.presence).toBeUndefined();
    hook.rerender({ roomId: 'second' });
    expect(hook.result.current.realtimeUnavailable).toBe(false);
    expect(hook.result.current.presence).toBeUndefined();
    act(() => { subscribe('SUBSCRIBED'); sync(); vi.advanceTimersByTime(1000); });
    expect(refresh).toHaveBeenCalledTimes(3);
    hook.rerender({ roomId: 'first' });
    expect(hook.result.current.realtimeUnavailable).toBe(false);
    expect(hook.result.current.presence).toBeUndefined();
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
