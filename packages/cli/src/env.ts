/**
 * Loads `.env` from the current working directory into `process.env`,
 * before anything else in the CLI runs. Every command up to now assumed
 * the caller had already sourced `.env` into their shell -- true in this
 * repo's own local-verification sessions (which always ran commands after
 * `set -a; source .env; set +a`), but not documented anywhere a real user
 * would see it, and not true in a fresh shell. Real friction against this
 * repo's own promise ("a stranger clones and gets this working in under 10
 * minutes," SS9 Phase 10's exit criteria) -- see docs/DECISIONS.md.
 *
 * Deliberately dependency-free (no `dotenv` package), matching the
 * project's existing precedent for small, single-purpose parsing (the
 * GitHub Action's own `action/src/main.mjs`). Only sets a key if it is not
 * already present in `process.env` -- real environment variables (a CI
 * runner's injected secrets, a shell export) always win over `.env`,
 * standard dotenv semantics, so this is safe to run unconditionally in
 * every environment, not just local development.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadDotEnv(cwd: string = process.cwd()): void {
  const path = join(cwd, '.env');
  if (!existsSync(path)) {
    return;
  }

  const contents = readFileSync(path, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key !== '' && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
