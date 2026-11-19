import { afterEach, expect, test, vi } from 'vitest';
import { validateBuildEnvironment } from '../../build-environment';
import { realtimeTopic } from '../online/environment';

afterEach(() => vi.unstubAllEnvs());

test('keeps production topics by default and isolates both staging topic types', () => {
  vi.stubEnv('VITE_GAME_SCHEMA', undefined);
  expect(realtimeTopic('user', 'eva')).toBe('user:eva');
  expect(realtimeTopic('room', 'mesa')).toBe('room:mesa');
  vi.stubEnv('VITE_GAME_SCHEMA', 'public');
  expect(realtimeTopic('user', 'eva')).toBe('user:eva');
  vi.stubEnv('VITE_GAME_SCHEMA', 'bs_staging');
  expect(realtimeTopic('user', 'eva')).toBe('hml:user:eva');
  expect(realtimeTopic('room', 'mesa')).toBe('hml:room:mesa');
});

test.each(['other', 'hml:', 'bs_staging ', 'PUBLIC'])('rejects an arbitrary schema or topic prefix: %s', schema => {
  vi.stubEnv('VITE_GAME_SCHEMA', schema);
  expect(() => realtimeTopic('user', 'eva')).toThrow(/VITE_GAME_SCHEMA/);
  expect(() => validateBuildEnvironment({ VITE_GAME_SCHEMA: schema })).toThrow(/VITE_GAME_SCHEMA/);
});

test('leaves default and production builds compatible with the existing relative API', () => {
  expect(() => validateBuildEnvironment({})).not.toThrow();
  expect(() => validateBuildEnvironment({ VERCEL: '1', VERCEL_ENV: 'production', VITE_API_URL: '/api/v1' })).not.toThrow();
});

test.each([undefined, '', '/api/v1', 'http://api.example.test/api/v1', 'http://localhost.evil.test/api/v1', 'not a URL'])(
  'staging refuses a missing or insecure remote API: %s', api => {
    expect(() => validateBuildEnvironment({ VITE_GAME_SCHEMA: 'bs_staging', VITE_API_URL: api })).toThrow(/VITE_API_URL/);
  },
);

test('staging accepts HTTPS and permits exact loopback HTTP only outside Vercel', () => {
  expect(() => validateBuildEnvironment({ VITE_GAME_SCHEMA: 'bs_staging', VITE_API_URL: 'https://api.example.test/api/v1' })).not.toThrow();
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const environment = { VITE_GAME_SCHEMA: 'bs_staging', VITE_API_URL: `http://${host}:8080/api/v1` };
    expect(() => validateBuildEnvironment(environment)).not.toThrow();
    expect(() => validateBuildEnvironment({ ...environment, VERCEL: '1' })).toThrow(/VITE_API_URL/);
  }
});

test('the Java branch Preview fails closed until staging and an explicit HTTPS API are selected', () => {
  const preview = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/av3-sprint-03-spring-boot' };
  expect(() => validateBuildEnvironment(preview)).toThrow(/bs_staging/);
  expect(() => validateBuildEnvironment({ ...preview, VITE_API_URL: 'https://api.example.test/api/v1' })).toThrow(/bs_staging/);
  expect(() => validateBuildEnvironment({ ...preview, VITE_GAME_SCHEMA: 'bs_staging', VITE_API_URL: '/api/v1' })).toThrow(/VITE_API_URL/);
  expect(() => validateBuildEnvironment({ ...preview, VITE_GAME_SCHEMA: 'bs_staging', VITE_API_URL: 'https://api.example.test/api/v1' })).not.toThrow();
  expect(() => validateBuildEnvironment({ ...preview, VERCEL_GIT_COMMIT_REF: 'feature/node-change', VITE_API_URL: '/api/v1' })).not.toThrow();
});

test('the Java branch Preview refuses an inherited Node database connection without disclosing it', () => {
  const preview = {
    VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/av3-sprint-03-spring-boot',
    VITE_GAME_SCHEMA: 'bs_staging', VITE_API_URL: 'https://api.example.test/api/v1',
  };
  const databaseUrl = 'postgresql://fake:fixture-only@database.invalid/legacy';
  let failure: unknown;
  try { validateBuildEnvironment({ ...preview, DATABASE_URL: databaseUrl }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/DATABASE_URL/);
  expect((failure as Error).message).not.toContain(databaseUrl);
  expect(() => validateBuildEnvironment(preview)).not.toThrow();
  expect(() => validateBuildEnvironment({ ...preview, DATABASE_URL: '' })).not.toThrow();
  expect(() => validateBuildEnvironment({ ...preview, VERCEL_ENV: 'production', DATABASE_URL: databaseUrl })).not.toThrow();
  expect(() => validateBuildEnvironment({ ...preview, VERCEL_GIT_COMMIT_REF: 'feature/node-change', DATABASE_URL: databaseUrl })).not.toThrow();
});
