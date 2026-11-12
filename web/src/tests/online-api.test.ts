import { expect, test, vi } from 'vitest';
import { createOnlineApi } from '../online/api';

test('includes same-origin preview access cookies while authenticating API with a bearer token', async () => {
  const send = vi.fn(async () => Response.json({ id: 'profile-1' }));
  const refreshToken = vi.fn(async () => null);
  const api = createOnlineApi({
    baseUrl: '/api/v1',
    getToken: async () => 'supabase-access-token',
    refreshToken,
    fetch: send as typeof fetch,
  });

  await expect(api.request('/profile')).resolves.toEqual({ id: 'profile-1' });
  expect(send).toHaveBeenCalledWith('/api/v1/profile', expect.objectContaining({
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    headers: expect.objectContaining({
      Authorization: 'Bearer supabase-access-token',
    }),
  }));
  expect(refreshToken).not.toHaveBeenCalled();
});
