import { act, renderHook } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, test, vi } from 'vitest';
import { usePrivateBroadcast } from '../online/realtime';

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
