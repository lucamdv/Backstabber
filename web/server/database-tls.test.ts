import { afterEach, expect, test, vi } from 'vitest';
import { verifiedPostgresConnection } from './http';

afterEach(() => vi.restoreAllMocks());

test('requires a trusted CA for remote PostgreSQL without silently disabling certificate verification', () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => verifiedPostgresConnection(
    'postgresql://user:pass@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
  )).toThrow();
  expect(errorLog).toHaveBeenCalledWith('Backstabber database TLS root CA not configured');
});

test('preserves hostname verification and explicit CA even if URL contains sslmode', () => {
  const ca = '-----BEGIN CERTIFICATE-----\\nAQIDBA==\\n-----END CERTIFICATE-----';
  const config = verifiedPostgresConnection(
    'postgresql://postgres.project:encoded@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
    ca,
  );
  expect(config.ssl).toEqual({
    ca: ca.replace(/\\n/g, '\n'),
    rejectUnauthorized: true,
  });
  expect(config.connectionString).toContain('aws-0-sa-east-1.pooler.supabase.com:6543');
  expect(config.connectionString).not.toContain('sslmode');
});

test('allows local PostgreSQL without a remote CA certificate', () => {
  expect(verifiedPostgresConnection('postgresql://user:password@localhost:5432/postgres')).toEqual({
    connectionString: 'postgresql://user:password@localhost:5432/postgres',
  });
});
