import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { ReachabilityResult } from '../types.js';
import * as schema from './schema.js';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function checkDatabaseReachable(): Promise<ReachabilityResult> {
  try {
    await getPool().query('select 1');
    return { reachable: true };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
