import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import { matchRoute } from './match-store';
import { socialRoute } from './social';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Authenticate = (token: string) => Promise<string>;
export type Connect = () => Promise<PoolClient>;

export function supabaseAuthenticator(url: string, key: string, fetcher = fetch): Authenticate {
  return async token => {
    if (!url || !key) throw new ApiError('SERVICE_UNAVAILABLE', 503);
    const response = await fetcher(new URL('/auth/v1/user', url), {
      headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000),
    });
    if (response.status === 401 || response.status === 403) throw new ApiError('UNAUTHENTICATED', 401);
    if (!response.ok) throw new ApiError('SERVICE_UNAVAILABLE', 503);
    const user: unknown = await response.json();
    if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !uuid.test(user.id)
      || ('is_anonymous' in user && user.is_anonymous === true)) throw new ApiError('UNAUTHENTICATED', 401);
    return user.id;
  };
}

export function createApi(connect: Connect, authenticate: Authenticate, origin?: string) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const allowedOrigin = request.headers.get('Origin');
    if (allowedOrigin && origin?.split(',').map(value => value.trim()).includes(allowedOrigin)) {
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
    }
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return new Response(null, { status: 204, headers });
    }
    let tx: PoolClient | undefined;
    try {
      const url = new URL(request.url);
      const path = url.pathname.startsWith('/api/v1/') ? url.pathname.slice('/api/v1'.length)
        : url.pathname === '/api/index' ? '/' + (url.searchParams.get('__route') ?? '') : '';
      if (!path) throw new ApiError('NOT_FOUND', 404);
      const token = /^Bearer ([\w.-]+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!token) throw new ApiError('UNAUTHENTICATED', 401);
      const userId = await authenticate(token);
      let body: Record<string, unknown> = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        const raw = await request.text();
        if (raw.length > 16384) throw new ApiError('PAYLOAD_TOO_LARGE', 413);
        if (raw) {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error();
            body = parsed as Record<string, unknown>;
          } catch {
            throw new ApiError('INVALID_JSON');
          }
        }
      }
      tx = await connect();
      await tx.query('begin');
      const result = await matchRoute(tx, userId, request.method, path, body)
        ?? await socialRoute(tx, userId, request.method, path, body, url.searchParams);
      if (result === undefined) throw new ApiError('NOT_FOUND', 404);
      await tx.query('commit');
      return Response.json(result, { headers });
    } catch (error) {
      if (tx) await tx.query('rollback').catch(() => {});
      if (error instanceof ApiError) return Response.json({ error: error.code }, { status: error.status, headers });
      console.error('Backstabber API request failed', { type: error instanceof Error ? error.name : 'UnknownError' });
      return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500, headers });
    } finally {
      tx?.release();
    }
  };
}

let pool: Pool | undefined;
export function handleRequest(request: Request) {
  return createApi(async () => {
    if (!process.env.DATABASE_URL) throw new ApiError('SERVICE_UNAVAILABLE', 503);
    pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
      connectionTimeoutMillis: 5000, statement_timeout: 8000 });
    return pool.connect();
  }, supabaseAuthenticator(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_PUBLISHABLE_KEY ?? ''),
  process.env.BACKSTABBER_ALLOWED_ORIGIN)(request);
}
