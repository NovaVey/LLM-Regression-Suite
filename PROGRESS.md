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

## Phase 4 — Comparison engine

**Owner:** `statistician` for the pure math (`pairing.ts`, `statistics.ts`) per §14 ("Phase 4 comparison math"), concurrently with `test-author` (Comparison test bucket, from spec) and a dedicated adversarial-review agent (spec + implementation, hunting specifically for false-regression/false-clear bugs) — orchestrated as a background Workflow given how consequential this file is. Main agent built `compare.ts` (DB orchestration) and the `llmreg compare` CLI concurrently against the same interface contract.

**Files:**
- `packages/core/src/comparison/pairing.ts` — `pairCases()`, per §5.1. Partitions cases into `paired` and `excluded` (5 reason codes), `difference = candidate − baseline`.
- `packages/core/src/comparison/statistics.ts` — `computeComparison()`. Wires all four Phase 1 primitives (bootstrap CI drives the verdict; McNemar always additionally computed as supplementary evidence over the same regressed/fixed counts, never overrides); regressed/fixed defined by pass/fail flip, not raw score movement; explicit `pairedCaseCount === 0` short-circuit (MDE = `Infinity`, not `0` — "cannot detect anything" must not read as "detects everything").
- `packages/core/src/comparison/compare.ts` (main agent) — fetches case_results/grades/cases for both runs, computes each case's weighted-average score (using `GraderConfig.weight`, previously-dead configuration), handles partial repeat-sample failure (errored only if *every* sample errored), calls pairing + statistics, persists to `comparisons`.
- `packages/cli`: `llmreg compare --suite --baseline-run --candidate-run [--bootstrap-iterations]`.
- `packages/core/test/comparison/{pairing,statistics}.test.ts` — 18 tests, the §10 Comparison bucket plus internal-consistency checks (McNemar b/c === regressed/fixed counts exactly).
- `docs/STATISTICS.md` — new "Comparison engine" section. `docs/DECISIONS.md` — statistician's entries (regressed/fixed-by-flip, bootstrap-always-drives-verdict, the n=0 value choices, the critical-flag OR-conflict resolution) plus the main agent's own (weighted scoring, partial-repeat-sample-failure handling).

**Adversarial review — 32 tests total (18 spec-derived + 14 self-authored adversarial), zero real bugs found.** Specifically tried and failed to break: null-score leakage into `paired`, exclusion-reason correctness across all 5 reason codes simultaneously, the `pairedCaseCount===0` short-circuit actually avoiding `bootstrapCI`, difference sign, McNemar/regressed-fixed internal consistency, critical-override precedence (including against `insufficient_data`, not just the CI-based checks), and self-comparison exactness. Full findings in the workflow transcript; I independently read both implementation files myself before accepting this, rather than relying on the report alone.

**One real interaction issue caught by `statistician` reading the concurrently-built `compare.ts`:** an `Infinity` MDE (the `pairedCaseCount===0` path) serializing to a Postgres `numeric` column via `String(Infinity)`. Verified directly — both raw SQL and the actual Drizzle insert path — that Postgres 14+ (confirmed: the local Postgres 16 used for testing, and Railway's Postgres 18 target) accepts the literal `'Infinity'` for `numeric`. No code change needed; confirmed rather than assumed.

**Exit criteria — verified end-to-end against a real local Postgres (fresh migration, real `persistRun`+`compareRuns` calls, not mocked):**

- Self-comparison → `delta: 0` (exact), `CI: [0, 0]` (contains 0), `verdict: no_detectable_difference`. ✓ (literal §9 Phase 4 wording)
- Deliberately broken variant (5 injected regressions, one critical) → `verdict: regression`, `regressedExternalIds` exactly the 5 injected cases, `criticalRegressed: 1`, and the *persisted* `comparisons.regressed_case_ids` (real case UUIDs, not externalIds) matched exactly. ✓ (literal §9 Phase 4 wording: "the right case list")
- Bonus: all-cases-excluded (`pairedCaseCount === 0`) → no throw, `verdict: insufficient_data`, `Infinity` MDE persisted and read back correctly.

No CHECKPOINT for Phase 4 per §9. Proceeding to Phase 5 (judge grader + calibration) once given the go-ahead — that phase has a CHECKPOINT.

## Phase 5 — Judge grader + calibration

**Owner:** `statistician` for `judge/kappa.ts` (Cohen's kappa), concurrently with `test-author` (Judge test bucket, from spec) — a background Workflow, per §14 ("kappa implementation" is statistician's). Main agent built the judge prompt/call, the runner's judge-grading integration, the calibration DB layer, the CLI's `llmreg calibrate`, and the calibration-gate enforcement inside `compare.ts`.

**Files:**

- `packages/core/src/judge/prompt.ts` — `buildJudgeSystemPrompt()` (the stable, hashed part: rubric + required-rationale response format) / `buildJudgeUserMessage()` (per-case, unhashed: conversation + candidate output). `rubricFromGraderConfig()` derives a `JudgeRubric` from a suite config's `judge:<name>` grader entry — shared by the runner, the comparison gate, and the calibrate CLI so all three hash an identical prompt for an identical rubric.
- `packages/core/src/judge/call.ts` — `callJudge()`, reusing Phase 3's `callTarget()` (same retry/backoff, same temperature-deprecation fallback) rather than duplicating it. `parseJudgeResponse()` validates `score ∈ [0,1]` and a non-empty `rationale`, throwing `JudgeResponseError` otherwise.
- `packages/core/src/judge/kappa.ts` (statistician) — `cohensKappa()`, standard unweighted 2-category Cohen's kappa. Explicit `Pe === 1` degenerate-case handling (returns `0`, not `NaN`/`1`/throw — see `docs/DECISIONS.md`).
- `packages/core/src/judge/calibration.ts` (main agent, pure) — `matchLabelsToJudgeGrades()` (pairs by `output_hash` only, per §5.5, never by `case_id`), `checkCalibrationGate()` (`passing`/`failing`/`missing`, matched against the *current* judge model + prompt hash), `computeBiasNote()`.
- `packages/core/src/judge/persist.ts` — DB-coupled: `hashOutput()` (sha256, computed on demand — no stored column), `getRunOutputsForCalibration()`, `getJudgeGradesForCalibration()`, `recordHumanLabel()`, `getHumanLabelsForGrader()`, `saveCalibration()`, `getCalibrationsForGrader()`.
- `packages/core/src/runner/persist.ts` (modified) — `persistRun()` now always performs judge grading for every `judge:*` grader (isolated per-(case,grader) failure, logged not thrown — a judge call failing is a materially smaller blast radius than the case itself erroring). The calibration gate is enforced downstream in `compare.ts`, not here — grading and trusting a grade are kept as separate questions.
- `packages/core/src/comparison/compare.ts` (modified) — `checkJudgeCalibrationGates()` throws the exact §5.5-specified rejection for any `judge:*` grader with `status: 'missing'`; graders with `status: 'failing'` go into an `advisoryGraders` set. `resolveJudgeGraderWeights()` forces those graders' weight to `0`. `weightedScore()` now returns `null` (not a false `0`) when every grade for a sample belongs to a zero-weighted grader, and `loadRunCaseData()` treats that identically to "no grades recorded at all" — the case is excluded from pairing, never scored as a fabricated zero.
- `packages/cli/src/commands/calibrate.ts` + `llmreg calibrate` — stratified-samples a run's judge-graded outputs (Phase 2's `stratifiedSample`, grouped by tag), labels them either interactively (`readline/promises`) or via `--labels-file` (a scripted/synthetic-labeling escape hatch — see `docs/DECISIONS.md`), computes kappa, and calls `saveCalibration()`.
- `packages/core/test/judge/{kappa,calibration}.test.ts` (test-author) — 14 tests: the three §10-named Judge-bucket tests (`an-uncalibrated-judge-cannot-produce-a-blocking-verdict`, `human-labels-attach-to-outputs-not-cases`, `changing-the-judge-prompt-invalidates-the-calibration`) plus the textbook-kappa, rubber-stamp-judge, `Pe===1`, and stale-calibration-precedence cases.
- `docs/STATISTICS.md` — new §7 (Cohen's kappa: what it measures, the `Po`/`Pe` derivation, the `Pe===1` edge case, assumptions). `docs/DECISIONS.md` — statistician's kappa entries (the `Pe===1` return-`0` choice and its three rejected alternatives; standard vs. weighted kappa) plus the main agent's own (missing-vs-failing gate behavior; the accepted `judge_prompt_hash`-column gap; `--labels-file` as a build-verification-only escape hatch).

**A real, accepted schema gap, not silently patched:** `grades` (§4's schema, followed verbatim) has no `judge_prompt_hash` column — only `judge_model`. The calibration gate can therefore only check a run's judge grades against the rubric hash in the *current* suite config, not whatever hash actually produced a given run's historical grades. This doesn't affect the normal `llmreg run` → `llmreg compare` workflow (both runs are always freshly graded under whatever's current), only the narrow case of comparing two old runs after editing the rubric in between. Extending §4's schema unilaterally to close this was considered and rejected — see `docs/DECISIONS.md`.

**Exit criteria — verified mechanically against a real local Postgres, using clearly-disclosed SYNTHETIC labels.** This sandbox has no real Anthropic API access (confirmed since Phase 0) and no human available to type 100–300 real judgments, so neither a genuine judge call nor a genuine labeling session could happen here. What *was* run for real: `ensureSuite`/`ensureCases`/`createVariant`, the real `llmreg calibrate` and `llmreg compare` CLI commands, `matchLabelsToJudgeGrades`, `cohensKappa`, `saveCalibration`, and `checkCalibrationGate` — against a real database, with only the judge's own model call and the human's own labeling replaced by synthetic stand-ins, every one labeled `[SYNTHETIC]` in the seed data itself.

1. **`compareRuns()` before any calibration exists → rejected, not warned:**
   ```
   Judge `helpfulness` has no passing calibration. Run `llmreg calibrate --grader judge:helpfulness`.
   ```
   (exit code 3, via the real `llmreg compare` CLI)

2. **A discriminating judge (synthetic: agrees with synthetic ground truth ~90% of the time) calibrated via the real `llmreg calibrate --labels-file` CLI, 20 stratified-sampled labels:**
   ```
   cohen's kappa: 0.615  raw agreement: 90.0%  floor: 0.6
   confusion matrix: bothPass=16 humanPassJudgeFail=0 humanFailJudgePass=2 bothFail=2
   result: PASSED — this judge may now drive a blocking verdict
   ```
   `llmreg compare` against the same (unedited) suite config then succeeds: `verdict: no_detectable_difference`, `paired: 20`.

3. **§5.5's core claim, demonstrated live, not just asserted:** a rubber-stamp judge (synthetic: always says "pass") calibrated against synthetic ground truth that is honestly 90% pass / 10% fail:
   ```
   cohen's kappa: 0.000  raw agreement: 90.0%  floor: 0.6
   confusion matrix: bothPass=27 humanPassJudgeFail=0 humanFailJudgePass=3 bothFail=0
   result: FAILED — judge scores remain advisory-only until recalibrated
   ```
   90% raw agreement, 0.000 kappa — exactly §5.5's "scores 90% agreement and knows nothing." `llmreg compare` against two runs graded solely by this failing judge does **not** throw (a `'failing'` calibration is advisory, not rejected): `verdict: insufficient_data`, `paired: 0`, `excluded: 30` — every case's only grader was zeroed out, so there was nothing left to pair, and the tool reports that honestly rather than crashing or fabricating a score.

4. **A stale calibration (rubric edited after calibrating) is rejected exactly like a missing one, through the real CLI:**
   ```
   $ llmreg compare --suite <suite-with-edited-rubric.json> --baseline-run <...> --candidate-run <...>
   Judge `helpfulness` has no passing calibration. Run `llmreg calibrate --grader judge:helpfulness`.
   ```
   (exit code 3) — confirming `checkCalibrationGate` correctly reads an edited-rubric hash as `missing`, not as the passing record it no longer matches.

All 108 tests pass (`npx vitest run`); full `tsc -b` build is clean. Verification script and generated suite/label JSON files were kept outside the tracked source tree and were not committed (per the standing rule from the Phase 2 incident) — only the reasoning and the real output above are recorded here.

**Full build + test:** `npm run build` (clean, no errors) and `npx vitest run` → **108/108 passed**.

## Phase 5 — CHECKPOINT

Per §9: "show me the kappa, the confusion matrix, and what happens when I try to compare with a stale calibration." Shown above, all against a real database via the real CLI, using disclosed synthetic data. Stopping here per rule 2 — this is a CHECKPOINT phase, not delegated, and needs the user's own real labels before calibration means anything beyond a pipeline smoke test. See the chat message for the full report and the open ask (100–300 real human labels).
