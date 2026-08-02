// Builds packages/core, cli, api in dependency order via TypeScript project
// references (tsc -b), then marks the CLI entry point executable. Kept as a
// single command (no `&&` chaining) per the workflow's Windows-dev-environment rule.
import { execSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';

execSync('npx tsc -b', { stdio: 'inherit' });

const cliEntry = 'packages/cli/dist/index.js';
if (existsSync(cliEntry)) {
  chmodSync(cliEntry, 0o755);
}
