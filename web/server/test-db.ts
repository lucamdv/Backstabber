import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';

const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);

export async function createTestDatabase() {
  const database = await PGlite.create();
  try {
    // Minimal Supabase primitives for executing the actual migration locally.
    // Realtime delivery and OAuth require separate service-level tests.
    await database.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      create schema realtime;
      create table realtime.messages (
        topic text, extension text, payload jsonb, event text, private boolean
      );
      alter table realtime.messages enable row level security;
      grant usage on schema realtime to anon, authenticated;
      grant select, insert on realtime.messages to anon, authenticated;
      create function realtime.topic() returns text language sql stable as
        $$ select current_setting('realtime.topic', true) $$;
      create function realtime.send(jsonb, text, text, boolean)
      returns void language sql as
        $$ insert into realtime.messages values ($3, 'broadcast', $1, $2, $4) $$;
    `);
    const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
    if (!migrations.length) throw new Error('No SQL migrations found for tests.');
    for (const file of migrations) await database.exec(await readFile(new URL(file, migrationDirectory), 'utf8'));
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

export function transaction<T>(database: PGlite, run: (client: PoolClient) => Promise<T>) {
  return database.transaction((tx) => run(tx as unknown as PoolClient));
}
