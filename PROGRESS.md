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

## Phase 6 — Simulations

**Owner:** `statistician` for all six simulation modules, concurrently with `test-author` (the §10 Simulations bucket, from spec and the interface contract alone — without reading the implementation) — a background Workflow, per §14 ("Phase 6 simulations" is explicitly statistician's). Main agent designed the full interface contract up front (handed identically to both agents), then integrated, fixed a finding both agents independently surfaced, built the `llmreg simulate` CLI, and verified.

**Files:**

- `packages/core/src/simulations/generator.ts` — `generateSyntheticPairedCases()`. Shared generative model: per-case latent difficulty `p_i` shared between baseline/candidate draws (a uniform wobble around `basePassRate`, not a Beta distribution — deliberate simplification, see `docs/DECISIONS.md`), `effectSize` shifts the candidate's true pass probability, `critical: false` unconditionally.
- `packages/core/src/simulations/null-model.ts` — `runNullModelSimulation()`, §6.1. **Modified during integration** — see "The finding" below.
- `packages/core/src/simulations/power-curve.ts` — `runPowerCurveSimulation()` + `interpolateDetectionThreshold()`, §6.2.
- `packages/core/src/simulations/mde-validation.ts` — `runMdeValidation()`, §6.3, built on power-curve.ts.
- `packages/core/src/simulations/pairing-benefit.ts` — `runPairingBenefitSimulation()`, §6.5, with a self-contained (not exported to `stats/`) unpaired bootstrap for the comparison only.
- `packages/core/src/simulations/judge-drift.ts` — `runJudgeDriftSimulation()`, §6.4, a synthetic judge stand-in (no real judge model callable in this environment). No CLI verb — deliberate scope decision (see `docs/DECISIONS.md`).
- `packages/core/src/stats/bootstrap.ts`, `packages/core/src/comparison/statistics.ts` (main agent, small additive change) — `bootstrapCI`/`computeComparison` gained an optional, backward-compatible `rand` parameter so Phase 6 can make a real "same seed, same result" claim while still calling the REAL production comparison code. Every existing call site is unaffected (see `docs/DECISIONS.md`).
- `packages/cli/src/commands/simulate.ts` + `llmreg simulate null|power|mde` (main agent). Writes results to `simulations/results/*.json` at repo root (a future report UI reads these, per §9's exit criteria — output artifacts, not package source).
- `packages/core/test/simulations/*.test.ts` (test-author) — 55 tests across all six files: generator validation/determinism/covariance, null-model tolerance-band arithmetic (rewritten during integration, see below), power-curve monotonicity + interpolation, MDE-validation, pairing-benefit, judge-drift directional checks.
- `docs/STATISTICS.md` — new §8 (all five validations, the generator model, the null-model finding, determinism). `docs/DECISIONS.md` — the null-model open question (full writeup), the `bootstrapCI` `rand` parameter, the unpaired-bootstrap-stays-local decision, the uniform-wobble-not-Beta decision, the judge-drift-has-no-CLI-verb decision.

**The finding, and what changed because of it.** Both `statistician` and `test-author` independently discovered the same thing, before either read the other's conclusion: `determineVerdict` (§5.6) makes `regression` a ONE-SIDED event (`ciUpper < 0`) out of a TWO-SIDED `(1−α)` CI. Under §6.1's true-null setup, that one-sided rate mathematically converges to `α/2`, not `α` — confirmed independently by both agents across many parameter combinations, and a third time by the main agent in a real, deterministic 2,000-trial CLI run. §6.1's/§12's "must land near 5%" language is quantitatively consistent with the **combined** `regression + improvement_detected` rate (which does converge to `α`), not the one-sided `regression`-only rate §6.1 literally says to count.

This is a real, open product question — not a bug — and neither of the two "fixes" (redefine the CI construction to make the one-sided rate hit `α` directly, which touches already-shipped Phase 1/4 code and the `ciLower`/`ciUpper` values already stored and reported; or simply retarget the spec's own outward-facing "~5%" language to `α/2`) was applied unilaterally. `runNullModelSimulation` was rewritten to report **both** rates, each checked against its own mathematically correct target, and `null-model.test.ts` was rewritten to match (no more expected-red tests — every test now asserts something that is actually true of a correctly-functioning system). Full reasoning in `docs/DECISIONS.md`; raised to the user at the checkpoint below.

**A second integration fix:** the original implementation's four functions that call the real `computeComparison` (`null-model.ts`, `power-curve.ts`, `mde-validation.ts` via power-curve, `pairing-benefit.ts`'s paired path) inherited non-determinism from `bootstrapCI`'s unseeded global `Math.random()` — both agents flagged this independently rather than silently working around it (the statistician's own scratch verification resorted to monkey-patching `Math.random`, correctly flagged as not shippable). Fixed at the root: `bootstrapCI`/`computeComparison` gained an optional `rand` parameter (default `Math.random`, zero effect on any existing caller), and all four Phase 6 files now pass an explicit seeded `mulberry32` stream. Verified end-to-end: `llmreg simulate null --seed 999 --trials 500` run twice produces byte-identical output.

**Exit criteria — verified with real numbers, `llmreg simulate` CLI, deterministic:**

```
$ node packages/cli/dist/index.js simulate null
Null model: 2000 trials, alpha=0.05
  regression rate (one-sided, blocks a PR):     2.35%  target ~2.50% (alpha/2)  within tolerance
  improvement rate (one-sided, symmetric tail): 2.65%
  combined rate (CI excluded zero at all):      5.00%  target ~5.00% (alpha)   within tolerance
```
— "null model false positive rate within tolerance of alpha" ✓ (both readings, each against its own correct target — see the finding above for why there are two).

```
$ node packages/cli/dist/index.js simulate power
n\effect  1pt  2pt  5pt  10pt  20pt
n=20       3%   3%   7%   9%   29%
n=50       5%   5%  11%  19%   53%
n=100      5%   5%  13%  27%   85%
n=250      1%   6%  25%  62%  100%
n=500      7%   8%  44%  89%  100%

Pairing benefit (§6.5), n=100, injected effect=8pt:
  paired detection rate:   21.3%
  unpaired detection rate: 14.3%
```
— "power curve grid generated" ✓; detection rate rises with both effect size and n (some cell-level noise at 150 trials/cell, expected at this trial count). "paired-vs-unpaired chart produced" ✓ — paired detects meaningfully more often than unpaired at the identical n, per §6.5.

```
$ node packages/cli/dist/index.js simulate mde
  n=50: reported=24.0pt  empirical=27.0pt  within tolerance
  n=100: reported=18.2pt  empirical=18.2pt  within tolerance
  n=250: reported=11.6pt  empirical=12.5pt  within tolerance
  all within tolerance: true
```
— "reported MDE matches ~80% detection on the curve" ✓ at every sample size tried.

**Judge drift (§6.4, library-only, no CLI):** accuracy 0.9→0.65 (worse rubric) moved kappa `0.762 → 0.268`; accuracy 0.6→0.95 (better rubric) moved kappa `0.178 → 0.911`; a coin-flip judge (accuracy 0.5) landed at kappa ≈ 0; a perfect judge (accuracy 1.0) landed at kappa exactly 1 both before and after. Demonstrates §6.4's point: calibration is a live constraint, not a one-time formality.

**Full build + test:** `npm run build` (clean) and `npx vitest run` → **158/158 passed**, confirmed stable across 3 repeated runs (no flakiness from the determinism fix).

**Post-checkpoint audit, prompted by "anything left in phase 6":** re-read §9's exit criteria and §11's Definition of Done literally against what was actually shipped, rather than assuming the checkpoint conversation covered everything.

- Verified "`llmreg simulate null` runnable by a stranger in under 10 minutes from clone" (§11) for real: `env -i PATH="$PATH" HOME="$HOME" node packages/cli/dist/index.js simulate null` — a completely empty environment, no `.env`, no `DATABASE_URL`, no API key — ran clean. True as stated, not just assumed.
- Found a real gap: §9's own Phase 6 exit line lists **"paired-vs-unpaired chart produced"** (§6.5: "One chart, and it justifies §5.1..."), and nothing chart-shaped had been built — only CLI text and JSON. Fixed: `renderPairingBenefitChart()` (`packages/cli/src/commands/simulate.ts`) generates a static SVG bar chart (categorical palette slots 1/2 per the dataviz skill's validated default — blue `#2a78d6`/orange `#eb6834`, CVD-safe adjacent pair), written to `simulations/results/pairing-benefit-chart.svg` by `llmreg simulate power` and embedded in the README's power-curve section. Rendered via headless Chromium and inspected visually (not just "the code looks right") — caught and fixed one real overflow bug this way: the first title ("Paired detects the injected regression more often (§6.5)") ran off the 480px canvas at 16px semibold, invisible in the raw SVG markup but obvious once actually rendered. Shortened to "Paired detects the regression more often," moved the §6.5 reference to the subtitle. Confirmed clean on re-render.

## Phase 6 — CHECKPOINT

Per §9: "this is the credibility of the whole repo. Walk me through the null model result before we go further." Walked through above — including the one-sided-vs-two-sided finding, which is exactly the kind of thing this checkpoint exists to catch before it becomes a headline claim nobody double-checked. Stopping here per rule 2. See the chat message for the full report and the open question needing the user's call.

**Resolution (post-checkpoint):** user decided to leave the statistical construction as-is and have the README state both rates precisely rather than change `bootstrapCI`/`verdict.ts`. `docs/DECISIONS.md`'s Phase 6 entry updated to record the decision. `README.md` rewritten with the precise two-rate framing (§12's "4.9%" language corrected). Separately, a post-checkpoint audit ("anything left in phase 6") caught that §9's own exit line requires a "paired-vs-unpaired chart produced" — only text/JSON existed. Fixed: a real static SVG chart, verified visually via headless Chromium (which also caught and fixed a genuine title-overflow bug the raw markup didn't reveal).

## Phase 7 — Report + PR comment

**Owner:** `report-designer` for all four renderers (`diff.ts`, `markdown.ts`, `json.ts`, `html.ts`), concurrently with `test-author` (the report/CI test bucket, from spec and the interface contract alone — without reading the implementation) — a background Workflow, per §14 ("Phase 7 reporters and PR comment... The PR comment is the product. Presentation decisions here are load-bearing and deserve undivided attention against the §8 direction"). Main agent designed the full `ComparisonReportData` contract up front, built `report/load.ts` (DB orchestration) concurrently against the identical contract, then integrated, fixed a gap both delegated agents independently found, built the `llmreg report` CLI, and verified.

**Files:**

- `packages/core/src/report/types.ts` (main agent) — the `ComparisonReportData` contract shared by loader and renderers.
- `packages/core/src/report/load.ts` (main agent, DB-coupled) — `loadComparisonReportData()`. Reuses `compare.ts`'s own `weightedScore()` (newly exported) so a case's displayed score always agrees with whatever actually drove the stored verdict, including judge graders zeroed out for failing calibration.
- `packages/core/src/report/{diff,format,copy,markdown,json,html}.ts` (report-designer; `format.ts`/`copy.ts` are internal helpers not in the original contract's named surface, added to keep verdict wording and number formatting from drifting between markdown.ts and html.ts). `diff.ts` uses the `diff` npm package's `diffWords` (added as a dependency — text diffing isn't a statistical claim needing in-repo verification, unlike `stats/`). `markdown.ts` exports `PR_COMMENT_MARKER`, an HTML-comment marker embedded at the top of every render for Phase 8's in-place-update logic to find. `html.ts` implements §8's full design direction: paper/ink/rule/alert/settled/muted palette, monospace tabular figures, hairline rules, and the interval bar signature element (muted+unbolded whenever the CI crosses zero, independent of the verdict's own color — verified with a fixture where a critical-case-override regression's bar correctly disagrees with its red headline).
- `packages/core/src/db/migrations/0001_add_excluded_case_count.sql` + `schema.ts`/`compare.ts` (main agent) — `comparisons.excluded_case_count`, computed at compare time but never previously persisted; the report layer needs it and there was no way to recover it after the fact.
- `packages/cli/src/commands/report.ts` + `llmreg report --comparison <id> --format markdown|json|html` (main agent). Same verdict-to-exit-code mapping as `compare` (regression→1, insufficient_data→2), so `report` can serve as the CI check on its own.
- `packages/core/test/report/*.test.ts` (test-author) — 53 tests (later 56, three added post-integration — see below) across all four renderers, verified against a scratch reference with 21 deliberately-broken mutations, each caught by the intended test(s).
- `docs/DECISIONS.md` — five new entries: the exit-code fix (below), the `excluded_case_count` migration, the `mdeCeiling`/`minPairedN` contract fix (below), the `diff` library choice, and a real CSS-color-leak bug report-designer's own tests caught before it ever reached review.

**A real §5.5/§7 inconsistency found and fixed before Phase 7 properly started:** §5.5 says a missing judge calibration is "rejected, not warned about"; §7's exit-code table explicitly puts "uncalibrated judge" in the same warn-level bucket as `insufficient_data` (exit 2), not infrastructure failure (exit 3). Phase 5's original code threw a plain `Error`, indistinguishable at the CLI layer from a genuine DB outage. Fixed with a new exported `UncalibratedJudgeError`, caught specifically by `compare`'s CLI action to set exit 2. `compareRuns()`'s actual rejection behavior is unchanged — only the exit code a CI system sees is corrected.

**A real contract gap, found independently by both delegated agents:** `report-designer` (implementing the "say which threshold" copy §5.6 requires for `insufficient_data`) and `test-author` (writing a test for the same requirement, without reading `report-designer`'s code) both flagged, before either saw the other's report, that `ComparisonReportData` never carried `mdeCeiling`/`minPairedN` — so no renderer could actually say which threshold was crossed, only report both raw numbers and shrug. Fixed: both fields threaded through from suite config (`load.ts`), `copy.ts`'s `insufficientDataElaboration()` rewritten to name MDE-ceiling, paired-n-floor, or both specifically. Verified all three branches render correctly. Both agents' stale "we can't know" file-header comments updated to record the resolution rather than left as misleading caveats.

**Exit criteria — verified against a real seeded comparison in local Postgres (2 regressions incl. 1 critical, 2 fixed cases, real diffs), through the real `llmreg report` CLI, all three formats:**

- **Markdown** (the PR comment): correct headline (`Regression: +0.0pp [−26.7, +26.7].`), correct elaboration ("2 of 15 paired cases flipped... including 1 critical case"), critical row bolded, working `\`\`\`diff` blocks for both regressed cases, fixed cases and methods correctly collapsed in `<details>`, marker present, judge-calibration section correctly handles the zero-judge-graders case. Exit code: **1** (regression), confirmed.
- **JSON**: full-precision round-trip, `mdeCeiling`/`minPairedN` correctly sourced from the suite's real configured thresholds (0.3/5).
- **HTML**: rendered via headless Chromium and actually looked at (not just grepped) — paper background, alert-red bolded headline, the interval bar rendering **muted/gray with an explanatory note** because this comparison's aggregate CI crosses zero even though the verdict is `regression` (driven by the critical-case override) — exactly the "bar and verdict can disagree, and that's correct" behavior §8 implies and report-designer's own fixture-based verification separately confirmed.

**Full build + test:** `npm run build` (clean) and `npx vitest run` → **214/214 passed**.

No CHECKPOINT for Phase 7 per §9. Proceeding to Phase 8 (GitHub Action) once given the go-ahead.

## Phase 8 — GitHub Action

**Owner:** main agent — not delegated. §14: "the main agent owns... the CI action."

**Files:**

- `action/action.yml` — composite action. Inputs: `suite`, `baseline`, `candidate`, `fail-on` (default `regression`), `limit` (optional, for a cheaper demo/smoke run), `github-token` (default `${{ github.token }}`). Three steps: set up Node, `npm ci && npm run build` (from the checkout's own source — see `docs/DECISIONS.md`), `llmreg migrate`, then `action/src/main.mjs`.
- `action/src/main.mjs` — the orchestration script. Dependency-free (no `@actions/core`/`@actions/github`/octokit — see `docs/DECISIONS.md`): reads `INPUT_*` env vars, imports `runRunCommand`/`runCompareCommand`/`runReportCommand` directly from the built CLI command modules via relative paths, calls the GitHub REST API with Node 20's built-in `fetch`. Path-filters on whether the diff between `baseline`/`candidate` touches anything under `suite` (§9 exit criteria: a README-only PR runs nothing); extracts the baseline system prompt via `git show <baseline>:<suite>/system-prompt.txt` (with a `git fetch --depth=1` fallback for shallow checkouts); runs baseline + candidate; compares; renders the markdown report; finds an existing PR comment by `PR_COMMENT_MARKER` and updates it in place, or creates one.
- `.github/workflows/regression.yml` — dogfoods the action against this repo's own PRs (§11: "Working GitHub Action producing a real PR comment in this repo"), `fetch-depth: 0`, `limit: 20` for a bounded demo run.
- `examples/support-agent/system-prompt.txt` — a minimal, real, single system prompt, added now because Phase 8's exit criteria needs *a* prompt file with git history to demo against; the fuller "two deliberately mixed variants" stays Phase 10's own work (see `docs/DECISIONS.md`).
- `docs/DECISIONS.md` — five new entries: dependency-free by choice, build-from-source vs. a pre-bundled `dist/`, the graceful-failure fix below, `fail-on`'s six-outcome design, and the minimal system-prompt addition.

**A real gap found and fixed during local verification, not filed against a hypothetical.** The first version only wrapped `compareRuns()` in a try/catch for the graceful-failure-comment path; extracting the baseline prompt (`git show`) sat outside it. Tested a PR that introduces `examples/support-agent` for the first time (nothing to extract at the baseline sha) — the script crashed with a raw `git` stderr dump, no PR comment posted at all, exactly the silent-failure shape §5.9 says never to produce ("the check fails loudly, never silently"). Fixed by widening the try/catch around the whole baseline→candidate→compare→report sequence, with a specific, friendly message for this case and a generic "infrastructure failure" fallback for anything else. Re-verified after the fix: same scenario now posts a clear explanatory comment and exits 0 (this specific case isn't in `fail-on` by default).

**Exit criteria — verified locally against real local Postgres, real git history, and mocked Anthropic + GitHub APIs** (this sandbox has no real Anthropic API access or real GitHub Actions runner, same constraint as every prior phase's local verification; a small Node mock server stood in for both `POST /v1/messages` and the GitHub issue-comments REST endpoints, using two real, local commits' worth of git history for the baseline/candidate prompt split — not fabricated data, just a stand-in for the two things this sandbox genuinely cannot reach):

1. **"A PR that edits the example prompt produces a real comment":** ✓. Two real local commits (system-prompt.txt edited between them), real `git show` extraction confirmed correct (the mock Anthropic server logged `signsOff=false` for every baseline call and `signsOff=true` for every candidate call — the exact wording difference between the two commits, proving the right prompt reached the right run), a real comparison computed (`verdict=insufficient_data` at n=5, correctly below the suite's `minPairedN=30`), a real comment created via the mock GitHub API.
2. **In-place update, not a second comment (§5.8, §10's `the-pr-comment-updates-in-place-instead-of-posting-twice`):** ✓. Running the action a second time against the same fake PR: `GET comments: 1 existing` → `PATCH updated comment 1000` — never a second `POST`.
3. **"A PR that edits the README produces no comparison run at all":** ✓. A baseline/candidate pair differing only outside `examples/support-agent` (this repo's own commit history) → `No changes under examples/support-agent... skipping, no comparison run.` No run, no compare, no comment, exit 0.
4. **`fail-on` configurability:** ✓. Default `fail-on: regression` with an `insufficient_data` outcome → exit 0 (warns, doesn't block). Widened to `fail-on: regression,insufficient_data` on the identical scenario → exit 1, with the specific reason logged.
5. **The brand-new-suite edge case above:** ✓, after the fix — explanatory comment posted, exit 0 (not in default `fail-on`).

**What's still real, unverified work, and needs the user:** the actual GitHub Actions runner behavior (real `ANTHROPIC_API_KEY`/`DATABASE_URL` secrets, real network, real `pull_request` event) can only be exercised by a real PR on GitHub's own infrastructure — this is exactly what Phase 8's checkpoint asks to see. Needs `DATABASE_URL` and `ANTHROPIC_API_KEY` configured as repository secrets (Settings → Secrets and variables → Actions) before a real demo PR can produce a real comment.

**Full build + test:** `npm run build` (clean) and `npx vitest run` → **214/214 passed** (no new unit tests this phase — the orchestration script's correctness was verified end-to-end against mocked infrastructure above, which exercises real behavior a mocked-import unit test wouldn't; §10's test plan doesn't name a Phase 8 unit-test bucket beyond the CI-exit-code tests already covered in Phase 4/5/7's own suites).

## Phase 8 — CHECKPOINT

Per §9: "screenshot of the bot comment on a real PR. This is the demo." Everything is built, committed, and verified as thoroughly as this sandbox allows — but the actual screenshot needs a real PR running on real GitHub infrastructure with real repository secrets, which only the user can provide. Stopping here per rule 2.
