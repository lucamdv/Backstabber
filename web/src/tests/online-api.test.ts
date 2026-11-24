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

test('renews an expired token and retries the API request once', async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ id: 'profile-1' }));
  const refreshToken = vi.fn(async () => 'renewed-token');
  const api = createOnlineApi({
    baseUrl: '/api/v1',
    getToken: async () => 'expired-token',
    refreshToken,
    fetch: send,
  });

  await expect(api.request('/profile')).resolves.toEqual({ id: 'profile-1' });
  expect(refreshToken).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer renewed-token' });
});

test('prompts for login without requiring Google when renewal fails', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
  const api = createOnlineApi({
    baseUrl: '/api/v1',
    getToken: async () => 'expired-token',
    refreshToken: async () => null,
    fetch: send,
  });

  await expect(api.request('/profile')).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
    message: 'Sua sessão expirou. Entre novamente.',
  });
  expect(send).toHaveBeenCalledTimes(1);
});
