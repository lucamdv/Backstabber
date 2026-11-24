// Auth-js can log transport exceptions during background restoration/refresh.
// Keep its input errors free of provider messages, URLs and credential payloads.
const safeCodes = new Set(['email_not_confirmed', 'invalid_credentials', 'weak_password',
  'over_request_rate_limit', 'over_email_send_rate_limit', 'otp_expired', 'otp_disabled',
  'user_not_found', 'email_not_found', 'session_not_found', 'refresh_token_not_found',
  'refresh_token_already_used', 'same_password', 'reauthentication_needed']);

export function authFetch(fetcher: typeof fetch = (...args) => fetch(...args), allowPasswordUpdate?: (authorization: string) => boolean): typeof fetch {
  return async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.startsWith('/auth/v1/')) return fetcher(input, options);
    try {
      if (url.pathname === '/auth/v1/user' && options?.method?.toUpperCase() === 'PUT'
        && typeof options.body === 'string' && Object.hasOwn(JSON.parse(options.body), 'password')) {
        const authorization = new Headers(options.headers).get('authorization') ?? '';
        if (allowPasswordUpdate && !allowPasswordUpdate(authorization)) throw new Error('Identity changed');
      }
      const response = await fetcher(input, { ...options, redirect: 'error' });
      if (response.status === 204) return response;
      let body: Record<string, unknown>;
      try { body = await response.clone().json(); }
      catch { return Response.json({ code: 'unexpected_failure', message: 'Authentication service unavailable' }, { status: 502 }); }
      if (response.ok) return response;
      const code = typeof body.code === 'string' && safeCodes.has(body.code) ? body.code : 'unexpected_failure';
      return Response.json({ code, message: 'Authentication request failed' }, { status: response.status,
        headers: { 'Cache-Control': 'no-store', 'X-Supabase-Api-Version': '2024-01-01' } });
    } catch { throw new Error('Authentication transport unavailable'); }
  };
}
