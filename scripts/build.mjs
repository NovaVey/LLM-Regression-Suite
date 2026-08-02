// Builds packages/core, cli, api in dependency order via TypeScript project
// references (tsc -b), then marks the CLI entry point executable. Kept as a
// single command (no `&&` chaining) per the workflow's Windows-dev-environment rule.
import { execSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync } from 'node:fs';

execSync('npx tsc -b', { stdio: 'inherit' });

// tsc only compiles .ts files -- migrate.ts resolves its .sql files relative
// to its own compiled location (dist/db/migrations), so those need copying
// alongside it explicitly, same as any other non-TS build asset would.
const migrationsSrc = 'packages/core/src/db/migrations';
const migrationsDist = 'packages/core/dist/db/migrations';
if (existsSync(migrationsSrc)) {
  cpSync(migrationsSrc, migrationsDist, { recursive: true });
}

const cliEntry = 'packages/cli/dist/index.js';
if (existsSync(cliEntry)) {
  chmodSync(cliEntry, 0o755);
}
