# Progress

Tracks state: files touched per phase, delegations, open questions. See `docs/DECISIONS.md` for the reasoning behind choices — this file is allowed to go stale, that one isn't.

## Phase 0 — Scaffold

**Owner:** main agent (not delegated — Phase 0 belongs to the main agent per §14).

**Files touched:**

- `.claude/commands/build-llm-regression-suite.md` — added; was missing from the repo even though the four subagents in `.claude/agents/` all depend on reading it. Without it, delegation in later phases had nothing to read.
- Root: `package.json`, `tsconfig.json` (project references), `tsconfig.base.json`, `vitest.config.ts`, `.env.example`, `.nvmrc`, `scripts/build.mjs`
- `packages/core`: `package.json`, `tsconfig.json`, `drizzle.config.ts`, `src/db/schema.ts` (Drizzle translation of §4), `src/db/client.ts`, `src/anthropic.ts`, `src/index.ts`
- `packages/cli`: `package.json`, `tsconfig.json`, `src/index.ts` (commander, `llmreg --help`, `llmreg doctor`)
- `packages/api`: `package.json`, `tsconfig.json`, `src/server.ts` (Fastify stub, `/health`)
- `packages/web`: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts` (§8 palette wired in), `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `docs/DECISIONS.md` — seeded with the model-separation and in-repo-statistics decisions per rule 4, plus the scaffold-specific choices made along the way

**What's deliberately not built yet:** `packages/core/src/{dataset,runner,graders,stats,judge,report}` are empty — those are Phase 1 through Phase 5 work. Building stub files for them now would be exactly the "half-finished implementation" the workflow rules warn against.

**`llmreg doctor`:** not in the §7 CLI surface by name — the CLI table there lists `init`/`run`/`compare`/`calibrate`/`report`/`simulate`/`serve` but Phase 0's exit criteria requires a health check without naming the command. Added `doctor` as the obvious convention; flagging this as a naming choice in case a different name is preferred once `llmreg init` exists.

**`npm audit` findings resolved during install:** one high (drizzle-orm SQL-injection) and one critical (Vitest UI arbitrary file read) fixed by bumping dependency versions before any code depended on them — see `docs/DECISIONS.md`. One moderate (drizzle-kit's transitive esbuild dev-server advisory) left unresolved and documented as accepted, since drizzle-kit only runs as a one-shot CLI.

**Exit criteria status:**

- `llmreg --help` runs — **verified.** `node packages/cli/dist/index.js --help` exits 0 with the expected usage output; also verified through the npm-workspace bin symlink (`./node_modules/.bin/llmreg --help`).
- Health check reports db + Anthropic reachable, prints both pinned model IDs — the code path exists (`llmreg doctor`) and was verified to **fail closed** correctly: with no env vars set, it prints `(TARGET_MODEL not set)` / `(JUDGE_MODEL not set)`, reports both database and Anthropic API as unreachable, and exits `3` (infrastructure failure, per §7). It **cannot report an actual pass** without real `DATABASE_URL` and `ANTHROPIC_API_KEY` values — that's the CHECKPOINT blocker by design (rule 5: never invent an API key, connection string, or model ID).
- `packages/web` also verified independently: `tsc --noEmit` and `vite build` both succeed against the bumped Vite 8 / Tailwind 3 toolchain.

## Open questions for the CHECKPOINT

1. Railway `DATABASE_URL` — needed to verify db reachability.
2. `ANTHROPIC_API_KEY` with credit and a spend limit set — needed to verify Anthropic reachability.
3. Confirmation that `TARGET_MODEL=claude-sonnet-5` / `JUDGE_MODEL=claude-opus-5` (already in `.env.example` per §2) are the right pins, or should change.
