/**
 * Applies the SQL files in `db/migrations/` (in filename order) against
 * DATABASE_URL, tracking which have already run in a `_migrations` table so
 * re-running is a no-op. Plain hand-written SQL rather than `drizzle-kit
 * migrate` — see the header comment in migrations/0000_init.sql for why.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './client.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const pool = getPool();
  await pool.query(
    `create table if not exists _migrations (
       filename text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const alreadyAppliedRows = await pool.query('select filename from _migrations');
  const alreadyApplied = new Set(alreadyAppliedRows.rows.map((r: { filename: string }) => r.filename));

  const applied: string[] = [];
  for (const file of files) {
    if (alreadyApplied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations (filename) values ($1)', [file]);
      await client.query('commit');
      applied.push(file);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  return { applied, alreadyApplied: [...alreadyApplied] };
}
