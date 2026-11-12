// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createApi, supabaseAuthenticator } from './http';

const request = () => new Request('http://local.test/api/v1/profile', {
  headers: { Authorization: 'Bearer test-session' },
});

describe('recuperação de falhas da API', () => {
  it.each(['55P03', '40P01', '57014', '40001'])('responde 503 e desfaz a transação após %s', async code => {
    const statements: string[] = [];
    const release = vi.fn();
    const tx = {
      query: async (sql: string) => {
        statements.push(sql);
        if (/^select\b/i.test(sql.trim())) throw Object.assign(new Error('fixture SQL failure'), { code });
      },
      release,
    } as unknown as PoolClient;
    const api = createApi(async () => tx, async () => 'user');
    const response = await api(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
    expect(statements).toContain('rollback');
    expect(statements).not.toContain('commit');
    expect(release).toHaveBeenCalledOnce();
  });

  it('descarta a conexão quando o rollback falha', async () => {
    const release = vi.fn();
    const tx = {
      query: async (sql: string) => {
        if (/^(select|rollback)\b/i.test(sql.trim())) throw Object.assign(new Error('fixture disconnected'), { code: '08006' });
      },
      release,
    } as unknown as PoolClient;
    const response = await createApi(async () => tx, async () => 'user')(request());
    expect(response.status).toBe(503);
    expect(release).toHaveBeenCalledWith(true);
  });

  it('diferencia indisponibilidade de Auth de token inválido', async () => {
    const down = (async () => { throw new TypeError('fixture network outage'); }) as typeof fetch;
    const denied = (async () => Response.json({}, { status: 401 })) as typeof fetch;
    const connect = async () => { throw Error('Authentication must precede database checkout'); };
    const unreachable = await createApi(connect, supabaseAuthenticator('https://auth.test', 'public-test', down))(request());
    expect(unreachable.status).toBe(503);
    const expired = await createApi(connect, supabaseAuthenticator('https://auth.test', 'public-test', denied))(request());
    expect(expired.status).toBe(401);
  });
});
