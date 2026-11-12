import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { matchRoute } from './match-store.js';
import { socialRoute } from './social.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Authenticate = (token: string) => Promise<string>;
export type Connect = () => Promise<PoolClient>;
const unavailableCodes = new Set(['55P03', '40P01', '57014', '40001', '53300', '57P01']);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : '';
}

export function supabaseAuthenticator(url: string, key: string, fetcher = fetch): Authenticate {
  return async token => {
    if (!url || !key) {
      console.error('Backstabber auth configuration missing', { hasUrl: Boolean(url), hasPublishableKey: Boolean(key) });
      throw new ApiError('SERVICE_UNAVAILABLE', 503);
    }
    let response: Response;
    try {
      const endpoint = new URL('/auth/v1/user', url);
      if (endpoint.protocol !== 'https:' && (endpoint.protocol !== 'http:' || !loopbackHosts.has(endpoint.hostname))) {
        throw new Error('Invalid Auth endpoint');
      }
      response = await fetcher(endpoint, {
        headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000),
      });
    } catch (error) {
      console.error('Backstabber auth upstream unreachable', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorCode: errorCode(error) || 'UNKNOWN',
      });
      throw new ApiError('SERVICE_UNAVAILABLE', 503);
    }
    if (response.status === 401 || response.status === 403) throw new ApiError('UNAUTHENTICATED', 401);
    if (!response.ok) {
      console.error('Backstabber auth upstream unavailable', { httpStatus: response.status });
      throw new ApiError('SERVICE_UNAVAILABLE', 503);
    }
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
    let discardClient = false;
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
      try {
        tx = await connect();
      } catch (error) {
        console.error('Backstabber database connection unavailable', {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorCode: errorCode(error) || 'UNKNOWN',
        });
        throw new ApiError('SERVICE_UNAVAILABLE', 503);
      }
      await tx.query('begin');
      // These limits belong to the transaction and work with transaction poolers.
      await tx.query("set local lock_timeout = '3s'");
      await tx.query("set local statement_timeout = '8s'");
      await tx.query("set local idle_in_transaction_session_timeout = '10s'");
      const result = await matchRoute(tx, userId, request.method, path, body)
        ?? await socialRoute(tx, userId, request.method, path, body, url.searchParams);
      if (result === undefined) throw new ApiError('NOT_FOUND', 404);
      await tx.query('commit');
      return Response.json(result, { headers });
    } catch (error) {
      const sqlCode = errorCode(error);
      discardClient = /^08\d{3}$/.test(sqlCode);
      if (tx) await tx.query('rollback').catch(() => { discardClient = true; });
      if (error instanceof ApiError) return Response.json({ error: error.code }, { status: error.status, headers });
      if (unavailableCodes.has(sqlCode) || discardClient) {
        return Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503, headers });
      }
      console.error('Backstabber API request failed', { type: error instanceof Error ? error.name : 'UnknownError' });
      return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500, headers });
    } finally {
      tx?.release(discardClient);
    }
  };
}

// node-postgres overwrites explicit SSL options when the URI has sslmode.
// Keep project CA trust and hostname validation active for remote databases.
export function verifiedPostgresConnection(connectionString: string, pem?: string) {
  const url = new URL(connectionString);
  if (loopbackHosts.has(url.hostname)) return { connectionString: url.href };
  const ca = pem?.replace(/\\n/g, '\n').trim();
  if (!ca?.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    console.error('Backstabber database TLS root CA not configured');
    throw new ApiError('SERVICE_UNAVAILABLE', 503);
  }
  for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) {
    url.searchParams.delete(name);
  }
  return { connectionString: url.href, ssl: { ca, rejectUnauthorized: true } };
}

let pool: Pool | undefined;
export function handleRequest(request: Request, attachPool?: (pool: Pool) => void) {
  return createApi(async () => {
    if (!process.env.DATABASE_URL) throw new ApiError('SERVICE_UNAVAILABLE', 503);
    if (!pool) {
      const connection = verifiedPostgresConnection(process.env.DATABASE_URL, process.env.SUPABASE_DB_CA_CERT);
      const instance = new Pool({ ...connection, max: 3, idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 5000 });
      instance.on('error', () => console.error('Backstabber idle database connection closed'));
      attachPool?.(instance);
      pool = instance;
    }
    return pool.connect();
  }, supabaseAuthenticator(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_PUBLISHABLE_KEY ?? ''),
  process.env.BACKSTABBER_ALLOWED_ORIGIN)(request);
}
