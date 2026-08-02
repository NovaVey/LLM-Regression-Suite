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

**`llmreg doctor`:** not in the §7 CLI surface by name — the CLI table there lists `init`/`run`/`compare`/`calibrate`/`report`/`simulate`/`serve` but Phase 0's exit criteria requires a health check without naming the command. Resolved: keeping `doctor` — it's a well-established convention for exactly this kind of diagnostic (`npm doctor`, `brew doctor`, `flutter doctor` all mean "check my environment and tell me what's wrong"), not an arbitrary pick.

**`npm audit` findings resolved during install:** one high (drizzle-orm SQL-injection) and one critical (Vitest UI arbitrary file read) fixed by bumping dependency versions before any code depended on them — see `docs/DECISIONS.md`. One moderate (drizzle-kit's transitive esbuild dev-server advisory) left unresolved and documented as accepted, since drizzle-kit only runs as a one-shot CLI.

**Exit criteria status:**

- `llmreg --help` runs — **verified.** `node packages/cli/dist/index.js --help` exits 0 with the expected usage output; also verified through the npm-workspace bin symlink (`./node_modules/.bin/llmreg --help`).
- Health check reports db + Anthropic reachable, prints both pinned model IDs — the code path exists (`llmreg doctor`) and was verified to **fail closed** correctly: with no env vars set, it prints `(TARGET_MODEL not set)` / `(JUDGE_MODEL not set)`, reports both database and Anthropic API as unreachable, and exits `3` (infrastructure failure, per §7). It **cannot report an actual pass** without real `DATABASE_URL` and `ANTHROPIC_API_KEY` values — that's the CHECKPOINT blocker by design (rule 5: never invent an API key, connection string, or model ID).
- `packages/web` also verified independently: `tsc --noEmit` and `vite build` both succeed against the bumped Vite 8 / Tailwind 3 toolchain.

## Railway Postgres provisioned

Created via the Railway API, in the existing **Upwork Portfolio** project (per instruction — not a new project), production environment, alongside the account's other services:

- Service: `Postgres-LLMRegSuite` (id `0f2bbd77-b045-4ce6-a15a-9c7961408a61`), image `ghcr.io/railwayapp-templates/postgres-ssl:18` — same image the account's other Postgres services already run, found by inspecting one of them rather than guessing.
- Persistent volume attached at `/var/lib/postgresql/data` (`postgres-llmregsuite-volume`) — without this the database resets on every redeploy.
- Database name `llmreg` (not the default `railway`, since this account has multiple Postgres instances and a generic name would be confusing later).
- Deployed and verified healthy: runtime logs show `database system is ready to accept connections`.

**Public connectivity: done.** User enabled the TCP Proxy via the Railway dashboard (`Postgres-LLMRegSuite` → Settings → Networking). `DATABASE_PUBLIC_URL` set on the service to match the pattern the account's other Postgres services already use. (The specific proxy hostname/port aren't recorded here deliberately — this repo goes public per §11's definition of done, and there's no reason to commit that detail even though it's not itself a credential; check the Railway dashboard or the service's own variables for the current value.)

**Could not verify connectivity from this session.** A `pg` connection attempt and a raw `/dev/tcp` probe to the proxy host:port both hung with no response (killed after timeout). The agent-proxy status (`$HTTPS_PROXY/__agentproxy/status`) shows this sandbox's egress is configured for HTTP(S) through a proxy plus a specific allowlist — arbitrary outbound TCP on the proxy's port for the Postgres wire protocol isn't part of that path. This reads as a constraint of the sandbox this session runs in, not evidence of a problem with the Railway setup — the actual dev environment (the user's Windows machine, and later GitHub Actions) has normal outbound TCP and isn't subject to it. Flagged to the user rather than assumed either way. Later confirmed reachable from the user's own machine (see below).

No credentials are written to any file in this repo — they go in the user's local `.env` (gitignored) and, later, GitHub Actions secrets for Phase 8.

**Connectivity confirmed from the user's own machine.** First retest after the TCP proxy came up reported `database: unreachable (DATABASE_URL is not set)` — a real bug, not a Railway problem: `checkDatabaseReachable()` returned a bare boolean, so `doctor` could only ever print `unreachable` with no reason. Fixed to return the same `{ reachable, error }` shape the Anthropic check already used (see `docs/DECISIONS.md` and commit `800bdb8`). That surfaced the actual cause — `.env` had the key names but no values after `=` — which the user then fixed. Final result, from `node --env-file=.env packages/cli/dist/index.js doctor` on the user's Windows machine:

```
target model : claude-sonnet-5
judge model  : claude-opus-5
database     : reachable
anthropic api: reachable
```

**Considered and declined: moving the database to Supabase.** The user has an existing "Upwork Portfolio" Supabase project; asked whether to use it instead of Railway once the connectivity issue surfaced. Inspecting it first showed it already has a `crm` schema plus live `auth`/`storage` — real infrastructure backing other client-facing apps, not empty. Given a choice between that shared production database and the dedicated, isolated Railway Postgres already matching §2, the user chose to keep debugging Railway rather than share blast radius with other client work. It turned out not to be a Railway problem at all — see above.

## Phase 0 — CHECKPOINT CLOSED

All three items resolved:

1. Railway `DATABASE_URL` — reachable, verified on the user's machine with real credentials.
2. `ANTHROPIC_API_KEY` — set, with credit (verified reachable via `models.retrieve`, which needs a valid, working key). Spend limit not independently re-confirmed here, but §2 only requires it "before Phase 3" (the first phase that spends real API budget at volume) — revisit then, not blocking Phase 1.
3. `TARGET_MODEL=claude-sonnet-5` / `JUDGE_MODEL=claude-opus-5` — confirmed valid: `models.retrieve` succeeded for both against the user's real account.

Proceeding to Phase 1.

## Phase 1 — Statistics core

**Delegated per §14:** `statistician` (implementation) and `test-author` (tests) ran concurrently, from an interface contract the main agent defined upfront from §5 so neither needed to see the other's work. `test-author` never read `packages/core/src/stats/`, confirmed via its own `git status` check.

**Files:**
- `packages/core/src/stats/{bootstrap,mcnemar,mde,verdict}.ts` — the four contracted pure functions, plus `normal-distribution.ts` (shared erf / inverse-normal-CDF / chi-square(1) numerics both mcnemar.ts and mde.ts need — not one of the four contracted files, added to avoid duplicating ~40 lines twice).
- `packages/core/test/stats/{bootstrap,mcnemar,mde,verdict}.test.ts` — 18 tests, each independently confirmed able to fail: `test-author` built its own reference implementations from spec, ran the real tests against them, then injected 11 distinct realistic bugs one at a time and confirmed each test catches its target before restoring.
- `docs/STATISTICS.md` — new; plain-language sections for pairing, bootstrap CI, McNemar, MDE, verdict logic, each with assumptions and real verification numbers.
- `docs/DECISIONS.md` — four new Phase 1 entries (continuity correction, percentile-vs-BCa bootstrap, z-vs-t MDE approximation, verdict precedence).

**Real disagreement caught and resolved:** `test-author` derived the uncorrected McNemar statistic from §5.2 alone (which doesn't specify correction) and its test initially failed against `statistician`'s continuity-corrected implementation — the exact scenario concurrent from-spec delegation exists to catch. Resolved in favor of the implementation (matches R's `mcnemar.test()` default; the uncorrected form is anti-conservative exactly at the small discordant-pair counts this tool's target suite sizes will often hit, which cuts against §6.1's false-positive-rate mandate). Full reasoning in `docs/DECISIONS.md`.

**Open question, documented not guessed at:** both agents independently flagged the same verdict-precedence gap — whether `pairedN < minPairedN` should gate a CI-based `regression` the way it gates `insufficient_data`. No test currently asserts either answer. Left as current behavior (regression overrides unconditionally), explicitly deferred to Phase 4 (first real caller) and Phase 6 (empirical false-positive check) rather than resolved by a third round of armchair reasoning in this file.

**Independently re-verified by the main agent** (not just trusting either subagent's self-report): reran the actual functions against a fresh random sample and the adversarial verdict cases before the first commit; reran the full test suite and full `tsc -b` build after the McNemar fix.

**Exit criteria status:** statistics module fully unit-tested with no dependency on the rest of the repo — met. 18/18 tests pass, full build clean.

## Phase 1 — CHECKPOINT

Bootstrap CI recovering a known interval and McNemar matching a hand-computed example — both demonstrated with real, independently-verified numbers above and in `docs/STATISTICS.md`.
