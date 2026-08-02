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

## Phase 2 — Dataset + suite config

**Split three ways, concurrently:** main agent built the schema/loader/CLI infrastructure; `dataset-curator` authored the 240-case dataset; `test-author` wrote the loader/split tests from spec. All three worked from one interface contract (`Case`/`GraderConfig`/`SuiteConfig` + the exact `loadSuiteConfig`/`loadCases`/`stratifiedSample` signatures) the main agent defined upfront, so none blocked on the others.

**Files:**
- `packages/core/src/dataset/{schema,load,split}.ts` — types, hand-rolled validation (`DatasetValidationError` with a specific, field-naming message on every malformed path), and a deterministic stratified sampler for Phase 5's calibration draw.
- `packages/cli/src/commands/init.ts` — `llmreg init [directory]` scaffolds `suite.json` + a 2-case `dataset.json`, refuses to overwrite.
- `packages/core/test/dataset/{load,split}.test.ts` — 38 tests, every guard verified to fail red against a deliberately-broken independent reference implementation before the real one was read (it wasn't read at all, per the discipline).
- `examples/support-agent/dataset.json` — 240 cases, 30 critical, full tag coverage (`refunds`/`escalation`/`out-of-scope`/`tone`/`safety` × `clean`/`ambiguous`/`adversarial`/`edge`). No prompt variants — explicitly Phase 10's job.
- `examples/support-agent/README.md` — case counts, critical-case breakdown by what they protect, coverage gaps named explicitly (English-only, shallow multi-turn, no tool-use, sparse sub-tags, single fictional policy).
- `docs/DECISIONS.md` — two new entries: JSON over YAML, hand-rolled validation over Zod (both to avoid a dependency outside §2 when a zero-dependency option already satisfied the requirement).

**Independently re-verified by the main agent, not trusted from either subagent's self-report:**
- Ran the real `loadCases()` against `dataset.json` directly — 240 cases, 30 critical, all `externalId`s unique, passes strict validation with zero errors.
- Recomputed every number in the README from the raw file myself (tag counts, difficulty counts, the full cross-tab, multi-turn count, structural invariants) — all matched exactly.
- Grepped the dataset for real-looking emails, phone numbers, and card numbers — none found.
- Ran the full 56-test suite and full `tsc -b` build after every commit in this phase.

**Incident, self-caught by the subagent, independently reconfirmed clean by the main agent:** `test-author`'s scratch-verification method (drop an independent reference implementation into `src/dataset/`, run tests, restore) collided with the main agent committing real files into the same shared working tree mid-run — briefly overwriting/deleting committed files. Caught via `git status`, fixed via `git restore`, and the main agent independently reconfirmed afterward (`git diff HEAD` empty, full build and 56/56 tests green). Process note for future delegations: have subagents do this kind of scratch verification in an isolated location, not the real source tree, to remove the collision risk rather than rely on catching it.

**Exit criteria status:** the example support-agent suite loads with 240 cases — met, independently verified. Validation rejects a malformed config with a specific message — met: 9+ distinct malformations each produce a message naming the exact field and problem (see `docs/DECISIONS.md` and the test suite).

No CHECKPOINT for Phase 2 per §9. Proceeding to Phase 3 (runner + cache + deterministic graders) once given the go-ahead.

## Phase 3 — Runner, cache, deterministic graders

**Owner:** main agent for all infrastructure per rule 11 ("the main agent owns... the runner, graders"); `test-author` for the §10 Runner test bucket, concurrently.

**Files:**
- `packages/core/src/graders/{exact,contains,regex,json,latency}.ts` + `registry.ts` — the five deterministic graders. `json_schema` is a deliberately small hand-rolled subset, not `ajv`.
- `packages/core/src/runner/{cache,concurrency,execute,persist}.ts` — sha256 response cache per §5.7; fixed-lane concurrency limiter; orchestration with per-case error isolation and **injectable cache/target-caller** (so tests never need a real DB or API key); DB persistence (suites/cases/variants/runs/case_results/grades).
- `packages/core/src/db/{migrate.ts,migrations/0000_init.sql}` — added mid-phase after discovering the real Railway DB had never actually been migrated (see incident below).
- `packages/core/src/anthropic.ts` — `callTarget()` with retry/backoff (delegated to the SDK's own `maxRetries`, not hand-rolled) and a fallback for models that reject an explicit `temperature` (discovered live, see incident below).
- `packages/cli`: `llmreg migrate` and `llmreg run --suite --dataset --label [options]`.
- `examples/support-agent/suite.json` — added (was missing since Phase 2; only the dataset existed).
- `packages/core/test/runner/{cache,execute}.test.ts` — 20 tests, the full §10 Runner bucket plus `computeCacheKey` coverage.
- `docs/DECISIONS.md` — 3 new entries: SDK-delegated retry over hand-rolled, hand-rolled `json_schema` over `ajv`, and the temperature-deprecation fallback.

**Two real incidents found and fixed during exit-criteria verification, not caught by any test because neither is something a test written in advance could have predicted:**

1. **The real Railway database had no tables.** Every DB-touching check up to this point (Phase 0's `doctor`, this phase's cache/persist verification) ran against a local test Postgres in the build sandbox, which I created and migrated by hand — never against the real Railway instance. First real `llmreg run` on the user's machine failed with "relation suites does not exist." Fixed by checking in a proper migration (`0000_init.sql`, the exact §4 DDL) and an `llmreg migrate` command, verified end-to-end against a freshly created empty local Postgres before pushing back to the user.
2. **`claude-sonnet-5` rejects an explicit `temperature` parameter.** A 400, not a warning: `` `temperature` is deprecated for this model``. This directly touches §2's temperature-0 determinism guarantee. Fixed with a retry-without-temperature fallback in `callTarget()` rather than either unconditionally dropping the parameter (would silently stop honoring it for models that do accept it) or hard-failing the run. **This is a real, open gap, not fully resolved**: for models that reject the parameter, the tool cannot force temperature-0 sampling via this mechanism, and whatever the model defaults to is what actually runs. Documented in `docs/DECISIONS.md`, not silently patched over — revisit if Anthropic exposes a different determinism control for these models.

**Exit criteria — verified with real output, on the user's machine (this sandbox has no real Anthropic API access and cannot reach the real Railway DB, confirmed in Phase 0):**

```
$ node --env-file=.env packages/cli/dist/index.js run --suite examples/support-agent/suite.json --dataset examples/support-agent/dataset.json --label test-run --limit 5
Run a2697653-ae2d-4fca-b738-aee9991dbd1e complete.
  cases: 5, samples: 5, cache hits: 0 (0.0%)
  errors: 0

$ node --env-file=.env packages/cli/dist/index.js run --suite examples/support-agent/suite.json --dataset examples/support-agent/dataset.json --label test-run --limit 5
Run 6541ca02-4919-454f-8f3c-bc8a318cdcc8 complete.
  cases: 5, samples: 5, cache hits: 5 (100.0%)
  errors: 0
```

- "Full suite runs against the target model" — met (5-case subset deliberately, not the full 240, to keep real API cost sane during infrastructure verification; nothing about the mechanism is case-count-dependent).
- "Second identical run is ~100% cache hits" — met exactly (100.0%).
- "A single case erroring does not fail the run and is reported as an error, not a zero" — met, verified via 20 automated tests (including `one-failing-case-does-not-abort-the-run`, each confirmed able to fail against a targeted broken reference implementation) plus the main agent's own local DB-backed verification with a synthetic failing case, rather than by deliberately breaking a real API call just to watch it happen live.

No CHECKPOINT for Phase 3 per §9. Proceeding to Phase 4 (comparison engine) once given the go-ahead.
