# Decisions

Real alternatives considered and rejected, recorded when the choice was made. See `.claude/commands/build-llm-regression-suite.md` rule 4 — this file records reasoning and must stay true; `PROGRESS.md` records state and is allowed to go stale.

## Phase 0

### Statistics implemented in-repo, not from a library

**Decision:** Bootstrap resampling, McNemar's test, and MDE are hand-written in `packages/core/src/stats`, not pulled from a stats package.

**Alternative:** `simple-statistics`, `jstat`, or similar.

**Why it lost:** A dependency you cannot verify line-by-line is a liability in the one place this repo must be trustworthy. Each of these functions is under 40 lines and needs to be unit-tested against a known answer in Phase 6 regardless — writing them in-repo means the test can assert against the actual implementation, not against a black box. See §2.

### The judge model must not equal the target model

**Decision:** `TARGET_MODEL` and `JUDGE_MODEL` are pinned to two different models (`claude-sonnet-5` and `claude-opus-5`).

**Alternative:** Use one model for both generation and grading — simpler, one API surface, one bill.

**Why it lost:** A model scoring its own outputs favours its own style and phrasing, and that bias is invisible in the resulting numbers — there's no signal in the data that would reveal it. Using a separate, generally stronger model as judge keeps the measurement instrument independent of the thing being measured. See §2.

### npm workspaces, no additional monorepo tool

**Decision:** `packages/*` are wired with native npm workspaces plus TypeScript project references (`tsc -b`) for build ordering.

**Alternative:** Turborepo or Nx for task orchestration and caching.

**Why it lost:** At four packages with a simple dependency graph (`core` ← `cli`/`api`), `tsc -b`'s own reference graph already gives correct build order for free. Neither tool is in §2, and rule 6 requires asking before adding a dependency outside it — the graph is small enough that asking wasn't worth it when the built-in mechanism suffices.

### No `dotenv` dependency

**Decision:** The CLI and API read `process.env` directly; nothing in the repo parses `.env` files.

**Alternative:** Add `dotenv` and call `config()` at each entry point, which is the common pattern.

**Why it lost:** `dotenv` isn't in §2, and rule 6 asks that dependencies outside it be raised before adding. Node's own `--env-file` flag (stable since Node 20.6) does the same job with zero new dependencies, so there was nothing to ask about. Documented in each package's README once Phase 10 writes it; for now: run with `node --env-file=.env dist/index.js` or export the vars in the shell.

### Anthropic reachability check uses `models.retrieve`, not a completion call

**Decision:** `checkAnthropicReachable()` in `packages/core/src/anthropic.ts` calls `models.retrieve` for both pinned model IDs.

**Alternative:** Send a 1-token `messages.create` call to prove the API round-trips.

**Why it lost:** `models.retrieve` is a metadata lookup — it confirms the key is valid and both pinned model IDs actually exist, with no completion tokens billed. A `doctor`/health command that's run repeatedly during setup and CI shouldn't cost money every time it's invoked.

### Dependency versions bumped past initial pins to clear `npm audit` findings

**Decision:** During Phase 0, `npm install` surfaced 9 advisories. Three were fixed by bumping past what was first pinned:

- `drizzle-orm` `^0.36.0` → `^0.45.2` — fixes a high/critical SQL-injection advisory in identifier escaping (GHSA for improperly escaped SQL identifiers).
- `vite` `^5.4.0` → `^8.2.0` (with `@vitejs/plugin-react` `^4.3.0` → `^6.0.5` for the matching peer range) and `vitest` `^2.1.0` → `^4.1.10` — fixes a **high** Vite advisory (path traversal in optimized-deps `.map` handling, plus an NTLMv2 hash disclosure via UNC path handling **on Windows** — directly relevant since rule 8 makes Windows the dev environment) and a **critical** Vitest advisory (arbitrary file read/execute when the Vitest UI server is listening).
- `@anthropic-ai/sdk` `^0.32.0` → `^0.65.0` — not audit-driven; 0.32 predates the SDK's `models` resource entirely, which `checkAnthropicReachable()` depends on.

**Alternative:** Pin to whatever the first-draft version was and defer the bump to whichever phase first touches that code.

**Why it lost:** Phase 0 is the cheapest possible point to absorb a major-version bump — no application code depends on these APIs yet. Waiting means re-verifying compatibility after Phase 1–9 code has been written against the older APIs, which is strictly more expensive than doing it now. All three bumps were verified: `npm run build` (tsc -b across core/cli/api), `vite build` and `tsc --noEmit` in `packages/web`, and `vitest run` all succeed against the bumped versions.

**Left unfixed:** `drizzle-kit` transitively depends on the deprecated `@esbuild-kit/esm-loader` (merged upstream into `tsx`, but drizzle-kit hasn't dropped the old dependency as of `0.31.10`), which pulls a moderate-severity esbuild advisory ("esbuild enables any website to send any requests to the development server and read the response"). No drizzle-kit version in the actively maintained range is clean of it — the `npm audit fix --force` suggestion downgrades to `0.18.1`, which predates APIs this schema relies on. Accepted as-is: `drizzle-kit` runs as a one-shot CLI (`drizzle-kit generate`), never as a long-lived dev server exposed to the network, so the advisory's actual attack surface doesn't apply here. Revisit if drizzle-kit cuts a release that drops the dependency.

## Phase 1

### McNemar's test uses the continuity-corrected chi-square statistic, always

**Decision:** `mcnemarTest()` in `packages/core/src/stats/mcnemar.ts` always computes `statistic = (|b - c| - 1)² / (b + c)` (Edwards' continuity correction) rather than exposing a corrected/uncorrected switch, and derives the p-value from the chi-square(1) distribution via a hand-written normal CDF rather than the exact binomial distribution of the discordant pairs.

**Alternative:** Either (a) the uncorrected statistic `(b - c)²/(b + c)`, or (b) the exact binomial (sign) test — `p = 2 × P(X ≤ min(b,c))` for `X ~ Binomial(b+c, 0.5)` — which several statisticians argue is the more defensible choice whenever `b + c` is small (rules of thumb range from `< 25` to `< 50`), since it doesn't rely on a continuous approximation to a discrete quantity at all.

**Why it lost:** Continuity correction is the standard default for "McNemar's test" as taught and as implemented by the tools people already trust (it's what R's `mcnemar.test()` applies unless `correct = FALSE` is passed explicitly), and it costs nothing at the large end (its effect vanishes as `b + c` grows) while meaningfully improving the chi-square approximation at the small end — which is exactly where eval suites in this tool's target range (tens to low hundreds of cases, per §11's 240-case example) will usually sit. The exact binomial test is arguably *more* correct at small `b + c` and was seriously considered; it lost mainly because the interface this module was built against (`McNemarResult` with a single `statistic`/`pValue` pair) is shaped around "the chi-square statistic," and switching the underlying test family would be a bigger interface change than a Phase 1 pure-function module should make unilaterally. Verified in `docs/STATISTICS.md` §3: on a hand-computed `b=9, c=3` case, the continuity-corrected p-value (`0.148915`) sits close to the independently-derived exact binomial p-value (`0.145996`), which is the expected relationship — not identical, but close, and on the conservative side. If Phase 6's null-model simulation shows the false positive rate materially exceeding alpha specifically on McNemar-graded (binary) suites with small discordant counts, revisit toward the exact binomial test.

**Resolution note (main agent):** `test-author` derived the uncorrected form independently from §5.2 alone (which doesn't specify), without reading this implementation, and its test initially failed against the continuity-corrected code — exactly the scenario delegation rule 5 exists to catch. Both readings are legitimate; the test was updated to match the implementation's choice above, for the reasoning already stated in this entry (R's default, and the anti-conservative direction of the uncorrected form is the wrong one to risk given §6.1's false-positive-rate mandate). Two agents independently converging on "this needs an explicit call" — one flagging it while writing the code, the other while writing the test from spec alone — is itself evidence the ambiguity was real, not manufactured.

### Percentile bootstrap, not BCa or bootstrap-t

**Decision:** `bootstrapCI()` uses the plain percentile method — resample, recompute the mean, take the `[alpha/2, 1-alpha/2]` percentiles of the resampled means directly.

**Alternative:** The bias-corrected-and-accelerated (BCa) bootstrap, or the bootstrap-t (studentized bootstrap), both of which are known to have better coverage properties than the plain percentile method when the underlying distribution is skewed or the sample is small.

**Why it lost:** Both alternatives are real methods worth knowing about, not strawmen — BCa in particular is often recommended as the default in modern statistical practice specifically because it corrects for the percentile method's known small-sample bias. It lost here because it is meaningfully harder to implement and verify by hand (BCa requires estimating both a bias-correction constant from the proportion of bootstrap replicates below the observed statistic, and an acceleration constant via jackknife resampling of the original sample — two more numerically fiddly pieces, each with its own way to get subtly wrong) and because the spec's own framing of this decision (§2: "each function is under 40 lines and needs to be unit-tested against a known answer") points at the simpler, more auditable method. The percentile method's under-coverage in small/skewed samples is a real, documented limitation, stated plainly in `docs/STATISTICS.md` rather than hidden. Revisit if Phase 6's simulations show coverage that's off by more than expected at the sample sizes this tool actually ships with.

### MDE formula uses the normal (z) approximation, not the exact t-distribution

**Decision:** `minimumDetectableEffect()` computes `(z_(alpha/2) + z_power) × SD/√n` using z-scores from a hand-written inverse normal CDF.

**Alternative:** The equivalent formula using t-distribution critical values instead of z, which is more exact at small n (a paired comparison is, after all, closer to a one-sample t-test than a large-sample z-test).

**Why it lost:** An exact t-quantile function requires inverting the incomplete beta function (or an equivalent numerical root-find over the t-distribution's CDF) — real, nontrivial numerical code, for a correction that is under ~1% by n≈60 and shrinks fast from there. The spec's own target sample size (§11: a 240-case example suite) is well past where this matters. The z-approximation's one real cost is that it slightly *understates* the true MDE at small n (a few dozen cases or fewer) — documented explicitly in `docs/STATISTICS.md` as a known direction of error, so a team relying on the reported MDE for a small suite knows to treat it as an optimistic (too-small) floor rather than an exact figure.

### Verdict precedence: `regression` overrides `insufficient_data` unconditionally — left as-is, flagged as open

**Decision:** `determineVerdict()` checks `regression` first (via `ciUpper < 0` OR `criticalRegressed > 0`), before checking `insufficient_data` (via `mde > mdeCeiling` OR `pairedN < minPairedN`). This means a comparison with too few paired cases to trust — `pairedN` below the floor — can still emit a blocking `regression` verdict, via either trigger, if the numbers happen to line up that way.

**Alternative:** Make `pairedN < minPairedN` override *everything*, including a critical-case regression and a CI-based regression, so `insufficient_data` always wins when the dataset itself is too small to trust — on the reasoning that a floor which a regression can bypass isn't really a floor.

**Why it's undecided, not resolved:** Both `statistician` and `test-author` independently flagged this exact fork — one while writing the implementation, one while writing the tests from spec alone, neither having seen the other's reasoning. Neither the implementation nor the tests assert a specific answer for the overlap case, so there's no current bug, just an open question. My own read splitting the two triggers apart:

- A **critical-case regression** (`criticalRegressed > 0`) is a directly observed fact about one specific case — it doesn't get less true because the *rest* of the suite paired too few cases to compute a trustworthy aggregate statistic. Overriding `insufficient_data` here seems right.
- A **CI-based regression** (`ciUpper < 0`) is an *inference drawn from the very sample* that might be too small to trust. Trusting "the interval is entirely below zero" while simultaneously knowing "this sample is too small to trust" is in tension — arguably `pairedN < minPairedN` should gate this specific path, forcing `insufficient_data` instead.

I have not changed the implementation to split these two triggers apart, for two reasons: it's a bigger interface/logic change than either delegated agent was asked to make unilaterally, and the project's own stated methodology (§6, §6.1 specifically) has a way to answer this empirically rather than by more armchair reasoning — Phase 6's null-model simulation, and Phase 4's comparison engine (the first real caller that will decide whether to even attempt a CI when `pairedN` is below floor), are better positioned to settle this with actual data than a fourth guess added to this file. Flagging for explicit resolution then, not now.

## Phase 2

### Suite config and case datasets are JSON, not YAML

**Decision:** `llmreg init` scaffolds `suite.json` and `dataset.json`; `loadSuiteConfig`/`loadCases` in `packages/core/src/dataset/load.ts` only parse JSON.

**Alternative:** YAML, which §2 explicitly allows ("YAML/JSON suite config") and which is arguably friendlier for hand-authoring 240 cases — comments, less punctuation noise, multi-line strings without escape sequences.

**Why it lost:** Node has no built-in YAML parser, so supporting it means adding a dependency (`yaml` or `js-yaml`) that isn't in §2's stack list, and rule 6 asks that dependencies outside it be raised before adding. Since the spec's own wording already sanctions JSON as an equally valid choice ("YAML/JSON"), there was nothing to actually ask about — JSON satisfies the requirement with zero new dependencies. The real cost is on the dataset-authoring side (no comments; `criticalReason` has to be a JSON field rather than an inline comment, which it already needs to be anyway since it's machine-validated). Revisit if hand-authoring JSON at scale (Phase 10's 240 cases, or a client's real dataset per §13) turns out to be painful enough in practice to justify asking about `yaml` explicitly.

### Dataset/config validation is hand-rolled, not a schema library

**Decision:** `loadSuiteConfig`/`loadCases` validate field-by-field with explicit `if` checks and a custom `DatasetValidationError`, rather than a schema library (Zod, ajv, etc.) generating validation from a schema definition.

**Alternative:** Zod — the de facto standard for this in a TypeScript codebase, would cut the validation code by more than half and centralize the schema as data rather than procedural checks.

**Why it lost:** Not in §2's stack, so same as above — rule 6 says ask first, and there was a zero-new-dependency option that satisfies the actual requirement (Phase 2's exit criteria: "validation rejects a malformed config with a specific message"). More specifically here, though: this repo's whole posture in `docs/DECISIONS.md`'s very first entry is that dependencies in places the tool must be trustworthy are worth writing by hand so they can be verified line by line — config validation is exactly this project's first line of "fails loudly, never silently, with a specific reason" (§5.9), and a library's generic error shape (`"invalid_type" at path ["thresholds", "significanceAlpha"]`) would need translating into this project's voice (`thresholds.significanceAlpha must be strictly between 0 and 1, got 5`) regardless of which approach was used. Revisit if the validation surface grows enough (many more config shapes, e.g. per-grader config schemas in Phase 3) that hand-rolling becomes the more error-prone option — that's a real tradeoff Zod would win eventually, just not yet.

## Phase 3

### Retry/backoff delegates to the Anthropic SDK's built-in `maxRetries`, not a hand-rolled loop

**Decision:** `callTarget()` in `packages/core/src/anthropic.ts` passes `{ maxRetries: 3 }` as a per-request option to `anthropic.messages.create()` rather than wrapping the call in an application-level retry loop.

**Alternative:** Hand-roll retry/backoff (matching this repo's general stance of writing verifiable logic in-repo — the stats module, the dataset validator).

**Why it lost:** Checked the installed SDK's source directly rather than assuming: it already retries exactly the transient conditions worth retrying — HTTP 429 and >=500 — with exponential backoff, and that logic is officially maintained by Anthropic against their own API's actual failure modes. Hand-rolling would mean re-deriving the same two conditions and shipping a strictly worse, unmaintained copy of logic the vendor SDK (already a dependency, already trusted for every other call in this repo) gets for free. This is a different situation from the stats/dataset-validation calls elsewhere in this file: those were about auditability of *novel, project-specific* logic where a library's correctness can't be taken on faith; HTTP retry/backoff for a well-known vendor API is neither novel nor project-specific, and the SDK's behavior is directly inspectable (and was inspected) rather than trusted blindly.

### `json_schema` grader is a hand-rolled subset (`type`/`required`/`properties`/`items`/`enum`), not a library

**Decision:** `packages/core/src/graders/json.ts` implements a small recursive validator supporting only `type`, `required`, `properties`, `items`, and `enum` — no `$ref`, `oneOf`/`anyOf`/`allOf`, `pattern`, `format`, or numeric bounds.

**Alternative:** `ajv`, the standard JSON Schema validator for Node/TypeScript, which would give full draft-07/2020-12 compliance.

**Why it lost:** Same reasoning as Phase 2's dataset validation and the in-repo statistics module (§2, and the very first entry in this file): `ajv` isn't in §2's stack, and rule 6 asks that dependencies outside it be raised before adding — there was a zero-dependency option (a documented subset) that satisfies what this grader is actually for, which is checking that a target's structured output roughly matches an expected shape, not acting as a general-purpose schema validator. The subset covers what real grader configs are likely to need (an object with required fields of known types, an array of a known item type, an enum of allowed values) without the surface area of the full spec. Revisit if a real use case needs `oneOf`/`$ref`/pattern matching that the subset genuinely can't express — that's a real ceiling this approach has, unlike the stats functions which don't have an analogous "eventually you'll need the full thing" pressure.

### `claude-sonnet-5` rejects an explicit `temperature` parameter — retry-without-temperature fallback, not a silent workaround

**Decision:** `callTarget()` in `packages/core/src/anthropic.ts` first tries the request with `temperature` set; if the API returns the specific 400 confirmed live against the real target model (`` `temperature` is deprecated for this model``), it retries once with `temperature` omitted entirely, rather than never sending `temperature` at all or crashing every case in the run.

**Alternative 1:** Never send `temperature`, unconditionally — simpler, and would have avoided the error outright.

**Why it lost:** Untested assumption that *no* target or judge model this tool might ever point at accepts the parameter. §2's env template (`TARGET_TEMPERATURE=0.0`) and the `variants.temperature` column exist because temperature-0 determinism is a named, load-bearing design principle (§2: "the opposite of the extraction pipeline... run-to-run variance inflates the paired difference and manufactures false regressions") — dropping the parameter unconditionally would silently stop honoring it for any model that *does* still accept it, with no signal that anything changed.

**Alternative 2:** Treat this as a hard failure and require the user to fix their configuration (e.g. by unsetting temperature) before running.

**Why it lost:** This is exactly the failure mode §5.1/§5.9 exist to prevent when it happens per-case (a case that can't be graded is excluded and reported, never silently zeroed) — but this isn't per-case, it's every case against this model, and the fix (drop one field) is unambiguous and safe. Failing the entire run over a parameter the API itself says is merely deprecated (not that the request is otherwise malformed) would be pedantic at the cost of the tool actually working against a real, current model.

**What this costs:** for models where the parameter truly is rejected, the tool cannot force temperature 0 via this parameter, and whatever sampling behavior the model defaults to is what actually runs — a real, open gap against the temperature-0 guarantee, not resolved by this fallback, only kept from being a hard crash. `variants.temperature` still records the *configured* value (what `.env`/`--temperature` asked for) — it does not claim the API call actually honored it. If Anthropic exposes a different determinism control for these newer models, this fallback should be replaced with using it, not left in place indefinitely.

**Found live, not predicted:** first real `llmreg run` against `claude-sonnet-5` (Phase 3's exit-criteria verification, run on the user's machine since this sandbox has no real API access) failed on 5/5 cases with this exact error before the fallback was added.

## Phase 4

### "Regressed" and "fixed" are defined by a pass/fail flip, not raw score movement

**Decision:** `computeComparison()` in `packages/core/src/comparison/statistics.ts` counts a paired case as regressed iff `baselinePassed === true && candidatePassed === false`, and fixed iff the reverse. A case whose score moved (e.g. 0.9 → 0.7) but whose pass/fail status didn't is not counted as either.

**Alternative:** Define regressed/fixed by raw score movement — e.g. any negative/positive `difference` beyond some epsilon — which would surface more cases in the "regressed" table and wouldn't require a `passed` boolean to exist at all.

**Why it lost:** §5.6's "a critical case regressed" and §5.8's "Regressed cases table" sit directly alongside §5.2's McNemar framing, which is explicitly about discordant pairs — pass→fail and fail→pass — and nothing else. A raw-score-movement definition would make `criticalRegressed` (and the PR comment's regressed-cases table) sensitive to noise inside the passing band, which is exactly the kind of movement the rest of this document argues against treating as signal. It also keeps `criticalRegressed` a clean, unambiguous count (critical cases inside `regressedExternalIds`) and keeps McNemar's `discordantB`/`discordantC` in exact agreement with `regressedExternalIds.length`/`fixedExternalIds.length` by construction, rather than by two independently-tunable definitions that could drift apart. Verified directly in the Phase 4 verification output: `mcnemar.discordantB === regressedExternalIds.length` and `mcnemar.discordantC === fixedExternalIds.length` on every constructed case, including a mixed case with 5 regressions and 3 fixes among 12 concordant cases.

### The verdict is always driven by the bootstrap CI; McNemar is always computed but never drives it

**Decision:** `computeComparison()` always calls `bootstrapCI` (when `pairedCaseCount > 0`) and feeds its `ciLower`/`ciUpper` into `determineVerdict`. It also always calls `mcnemarTest` over the same paired cases and reports the result on `mcnemar`, but that result never reaches `determineVerdict`. The `test` field is therefore always `'paired_bootstrap'`, and the top-level `pValue` is always `null`.

**Alternative:** Let McNemar drive the verdict for suites where every case is graded pass/fail only (no continuous score), since McNemar is "the correct paired test for dichotomous outcomes" (§5.2) and a bootstrap CI on a `{-1, 0, +1}`-valued difference vector is a coarser instrument than a purpose-built binary test.

**Why it lost, for now:** `determineVerdict()`'s signature (`VerdictInput`) only accepts a two-sided CI (`ciLower`/`ciUpper`), not a McNemar statistic or p-value — building a second verdict path would be a bigger interface change than this module should make unilaterally, and the `comparisons` table (§4) has a single `test`/`p_value` pair per comparison, not one slot per method, which reads as the schema's author having one test in mind per row. Since the bootstrap CI is the only Phase 1 primitive that produces the two-sided interval `determineVerdict` needs, and it degrades gracefully to the binary case (a `{-1, 0, +1}` difference vector is a perfectly valid input to `bootstrapCI`), it was kept as the single source of truth for the verdict. McNemar is still always computed and reported — its `discordantB`/`discordantC` double as an internal-consistency check on `regressedExternalIds`/`fixedExternalIds` (see the decision above) and give a reader a second, independently-derived p-value to look at even though it isn't what the verdict is based on. Revisit if a real binary-only suite (all graders pass/fail, no continuous score) shows the bootstrap CI behaving noticeably worse than McNemar in Phase 6's simulations — that would be the concrete evidence needed to justify the bigger interface change.

**Consequence for `pValue`:** because the verdict is always `paired_bootstrap`-driven, and the percentile bootstrap as implemented (`bootstrap.ts`) returns only a mean and two percentile bounds — not a p-value, which would require access to the full vector of resampled means that `BootstrapResult` doesn't expose — `ComparisonStats.pValue` is always `null`. McNemar's own p-value remains available on `mcnemar.pValue`, deliberately not copied up into the top-level field, since that field is documented as describing whichever test is named in `test`, and attaching McNemar's p-value to a row labeled `paired_bootstrap` would misrepresent which test produced it. Extending `bootstrap.ts` to return a bootstrap p-value (e.g. `2 * min(P(mean <= 0), P(mean >= 0))` over the resampled distribution) was considered but is out of this module's scope — it's a Phase 1 primitive change, not a Phase 4 wiring change, and nothing in the spec's exit criteria for either phase requires it.

### `pairedCaseCount === 0`: `mde = Infinity`, not `0`; `delta`/`ciLower`/`ciUpper = 0`; `mcnemar = null`; `verdict = 'insufficient_data'`

**Decision:** When every case in a comparison is excluded on at least one side (`paired.length === 0`), `computeComparison()` short-circuits before calling `bootstrapCI` (which throws on an empty array by design) and returns a fixed, coherent result rather than letting that error propagate: `delta: 0, ciLower: 0, ciUpper: 0, mde: Infinity, mcnemar: null, verdict: 'insufficient_data'`.

**Alternative for `mde`:** `0`, which is the other option the interface contract explicitly allowed ("mde: 0 or Infinity — your call, document which and why").

**Why `Infinity` won:** MDE means "the smallest true difference this dataset could reliably detect." With zero paired cases, the dataset cannot reliably detect *any* effect, no matter how large — the honest value for "cannot detect anything" is unboundedly large, not zero. `0` would read as "this dataset is maximally sensitive, it can detect even an infinitesimal effect," which is the exact opposite of the truth and the opposite failure direction from the one §5.4 exists to prevent (an under-reported MDE hiding a suite's blind spots). `Infinity` also composes correctly with `determineVerdict`'s own logic without any special-casing: `mde > mdeCeiling` is true for any finite ceiling, which is the same branch that (via `pairedN < minPairedN`) would fire anyway — the short-circuit in `computeComparison` and the verdict `determineVerdict` would have produced if it *had* been called are in agreement, not contradictory.

**Why `delta`/`ciLower`/`ciUpper = 0` rather than, say, `NaN` or omitting the fields:** the interface contract requires numbers, not nullable numbers, on these fields (`ComparisonStats.delta: number`, not `number | null`) — `NaN` would violate "no crash, coherent result" in spirit even if it doesn't throw (a `NaN` flowing into a report renderer or a database `numeric` column is its own failure mode). `0`/`0`/`0` paired with `verdict: 'insufficient_data'` (never `no_detectable_difference`, which is reserved for "we looked and found nothing" per §5.4) is unambiguous: a reader sees "insufficient data" and knows not to read the zeros as a real finding.

**Flag for the DB-orchestration layer (`comparison/compare.ts`, out of this module's scope):** `mde: Infinity` will `String()` to `"Infinity"` before being written to the `comparisons.mde` column (`numeric` in the §4 schema). Postgres's `numeric` type only gained support for the `Infinity`/`NaN` special values in PG 14+; on an older server, or if the driver/ORM doesn't pass the string through as a special value, this insert could fail specifically on the `pairedCaseCount === 0` path. Not fixed here since it's a persistence concern in a file this module doesn't own — flagging so whoever owns `compare.ts` can confirm the target Postgres version handles it, or clamp/cast `mde` at the DB boundary (e.g. store a large finite sentinel, or leave the column nullable and treat `null` as "undefined/unbounded") rather than relying on `numeric` accepting the literal.

### Critical flag conflict between baseline and candidate outcomes resolved via logical OR

**Decision:** `pairCases()` in `packages/core/src/comparison/pairing.ts` sets a paired case's `critical` to `baseline.critical || candidate.critical` when the two sides disagree (a data inconsistency pairing cannot itself rule out, since `critical` is a property of the underlying `cases` row that both `CaseOutcome`s for the same `externalId` should agree on).

**Alternative:** Trust the baseline side unconditionally (it's processed first in the pairing loop), or throw on disagreement and force the caller to reconcile it upstream.

**Why OR won:** under-flagging a critical case is the more dangerous failure direction here — §5.6's critical-case override exists specifically so a single bad case can't hide inside an aggregate, and silently dropping that protection because of an upstream data inconsistency would be the wrong direction to err in. Throwing was considered and rejected as disproportionate for a pure function whose contract is "compute a result from the given data," not "validate the caller's data model" — the inconsistency, if it ever occurs, is a bug in whatever assembles the `CaseOutcome` arrays (almost certainly `compare.ts`, since both sides should be reading `critical` from the same `cases` row), and is better caught there or in that layer's own tests than by adding a throw path to a Phase 4 pure function with no I/O to report the problem through.

### compare.ts: a case's aggregate score is the weighted mean of its grades

**Decision:** `weightedScore()` in `packages/core/src/comparison/compare.ts` combines a case's grades into one score via `sum(score * weight) / sum(weight)`, using each grader's `config.weight` from the suite config (default `1` when unset).

**Alternative 1:** Unweighted mean (ignore `GraderConfig.weight` entirely).

**Why it lost:** `weight` is a real, already-existing field on `GraderConfig` (§4/Phase 2's schema) with no other consumer — ignoring it here would make it dead configuration. A suite author who marks `judge:helpfulness` weight 3 and `latency` weight 1 clearly means for helpfulness to dominate the aggregate; silently averaging them equally would misrepresent that intent.

**Alternative 2:** Require unanimous pass (AND across all graders) rather than a continuous weighted score, with `passed` becoming the primary signal and `score` derived from it.

**Why it lost:** this suite's example config (`examples/support-agent/suite.json`) and the general grader model (§3: `exact.ts`, `contains.ts`, `regex.ts`, `json_schema.ts`, `latency.ts`, eventually `judge.ts`) are score-producing, not just pass/fail-producing — a continuous weighted score is strictly more informative for the bootstrap CI (which needs real-valued differences, not just a binary signal) and still reduces to a pass/fail via the existing `score >= 0.5` threshold (the same convention Phase 3's `averagePerCaseScores` already established) for McNemar and the regressed/fixed classification. Using AND-across-graders would have thrown away the magnitude information the bootstrap CI depends on.

### compare.ts: a case counts as errored only if *every* repeat sample errored

**Decision:** `loadRunCaseData()` scores a case from whichever of its repeat samples succeeded, and only reports the case as errored (`score: null`) to pairing if literally none of its samples produced a usable grade.

**Alternative:** Any single sample erroring marks the whole case errored, discarding the successful samples too.

**Why it lost:** §5.3 treats each repeat sample as an independent measurement ("run each case k times... average the per-case scores"), and §5.1/§5.9's exclusion rule is about a case having no valid result to score, not about *some* attempts failing. A case with 2 successful samples and 1 infrastructure hiccup (rate limit, transient timeout) still has real signal — discarding it entirely would shrink `pairedCaseCount` for a reason unrelated to case quality, working against the tool's own stated goal of using every case it validly can. The conservative alternative was rejected as *more* conservative than the spec actually asks for, not less.

## Phase 5

### `cohensKappa()` returns `0`, not `NaN`/throw/`1`, when `Pe === 1`

**Decision:** `cohensKappa()` in `packages/core/src/judge/kappa.ts` special-cases `Pe === 1` (both human and judge unanimous in the identical direction across the entire labeled sample — every label "pass," or every label "fail") and returns `cohensKappa: 0` rather than evaluating the raw formula, which divides `0` by `0` in exactly this case (Pe=1 implies Po=1 too, by construction — a true indeterminate, not an ordinary divide-by-zero with a nonzero numerator).

**Alternative 1:** Let the formula run and return whatever `(Po - Pe) / (1 - Pe)` produces, i.e. `NaN`.

**Why it lost:** `KappaResult.cohensKappa` is typed `number`, and the value's only real consumer is a direct comparison against `JUDGE_KAPPA_FLOOR` (§5.5: "Kappa below `JUDGE_KAPPA_FLOOR` → the judge is `passed = false`"). `NaN` fails every numeric comparison, including `>=`, which means a naive `kappa >= JUDGE_KAPPA_FLOOR` check silently evaluates to `false` (arguably the *safe* outcome here, by luck) but a differently-written check (`!(kappa < floor)`) would silently evaluate to `true` and let a degenerate, uninformative calibration pass the gate — the failure mode this whole statistic exists to prevent. Propagating `NaN` also risks reaching a Postgres `numeric` column (`judge_calibrations.cohens_kappa`, §4) or a report renderer downstream, the same category of problem flagged for `mde: Infinity` in the Phase 4 decision above. Rather than trust every future caller to special-case `NaN` correctly, the function makes the decision once, centrally.

**Alternative 2:** Return `1` (raw agreement is, after all, literally 100% in this case — every label matches).

**Why it lost:** This is the actively dangerous direction. `Pe === 1` arises specifically when the labeled sample had zero variance in *both* raters — e.g. every sampled output happened to be a human-labeled pass, and the judge also said pass on all of them. That calibration run never tested whether the judge can correctly call a *failing* output a failure, because it never saw one. Reporting `1` — the maximum possible kappa — for a run that tested nothing about discrimination is the same shape of error as the `mde: 0` alternative rejected for the Phase 4 `pairedCaseCount === 0` case: it reads as "flawless," the opposite of the truth ("untested"), in the one place (a judge calibration gate that determines whether a verdict is allowed to block a PR) where an optimistic error is the expensive one.

**Alternative 3:** Throw, forcing the caller to handle the degenerate case explicitly.

**Why it lost:** Unlike the length-mismatch and empty-array checks (which indicate a caller bug — mismatched arrays are never valid input), `Pe === 1` is a real, reachable state produced by *valid* input: a small or unlucky calibration sample can easily contain zero labeled failures, especially early in a project when most outputs are already good. Throwing here would mean every caller of `cohensKappa` — the calibration CLI flow in particular — needs a try/catch specifically for a case that isn't a programming error, just a data shape the statistic can't resolve. Returning a real, load-bearing number (`0`, which fails the floor by design) keeps the function's contract simple: it always returns a `KappaResult`, and the result's own shape (`confusionMatrix` with only one cell populated) tells a human reader exactly why the kappa came out the way it did.

**What this costs:** a genuinely well-calibrated judge validated only against a sample with no negative examples will show `cohensKappa: 0` and fail the gate, identically to a judge that is actually bad at discrimination — this function cannot and does not distinguish "the judge is uninformative" from "the sample never tested informativeness." That distinction is visible in `confusionMatrix` (only `bothPass` or only `bothFail` populated, and nothing in the opposite category) to whoever reads the calibration record, but it is not encoded in the `cohensKappa` number itself. Revisit if calibration sampling (§5.5: "stratified across score range and tags") turns out to reliably prevent this in practice — if a stratified sample can never actually produce `Pe === 1`, this branch becomes dead code that's still correct to keep as a safety net.

### Standard (unweighted, 2-category) kappa, not a weighted/ordinal variant

**Decision:** `cohensKappa()` takes two `boolean[]` arrays (pass/fail) and computes the textbook 2×2-table kappa — no partial credit for "close" disagreements.

**Alternative:** A weighted kappa (quadratic-weighted is the common default), computed directly on the continuous `score` (0–1) each grader already produces, so that a human score of 0.9 versus a judge score of 0.7 counts as a smaller disagreement than a human score of 0.9 versus a judge score of 0.1.

**Why it lost:** §5.5 itself frames the whole calibration discussion in binary pass/fail terms — the motivating example ("a judge that says 'pass' unconditionally scores 90% agreement and knows nothing") is a statement about a binary classifier, and `JUDGE_KAPPA_FLOOR` (§2's env template) is a single scalar threshold with no accompanying weighting scheme specified anywhere in the spec. The `grades` table (§4) already stores both a continuous `score` and a derived `passed: boolean` per grade — pass/fail is not a lossy simplification invented for this function, it's a first-class column the rest of the schema (McNemar, the critical-case override, the regressed/fixed case tables in §5.8) is already built around. Weighted kappa on the raw score is a real, defensible statistic and would use strictly more information than the binary version — but it introduces a genuine new design surface (which weighting scheme; how many ordinal bins the 0–1 score should be treated as having; whether the weighting should be linear or quadratic) that nothing in §5.5 specifies, and building it unilaterally inside a Phase 5 pure-function module would be inventing an interface the spec doesn't ask for. Revisit if a future grader design moves away from a binary `passed` flag as the thing `JUDGE_KAPPA_FLOOR` gates on.

### compare.ts: a "missing" calibration rejects the whole comparison; a "failing" one only zeroes that judge's weight

**Decision:** `checkJudgeCalibrationGates()` in `packages/core/src/comparison/compare.ts` treats `checkCalibrationGate`'s three statuses differently. `'missing'` (never calibrated, or the only calibration on record doesn't match the current judge model + prompt hash) throws immediately, rejecting the entire `compareRuns()` call before any scoring happens. `'failing'` (a calibration exists and matches, but its `cohensKappa` was below `JUDGE_KAPPA_FLOOR`) does not throw — the grader's name is added to an `advisoryGraders` set, and `resolveJudgeGraderWeights()` forces that grader's weight to `0` for both runs being compared.

**Alternative:** Treat both statuses identically — either both throw, or both silently continue with the judge's score included at full weight.

**Why it lost:** §5.5 draws this exact distinction in its own wording: an uncalibrated judge is "rejected, not warned about" (a hard stop — the comparison literally cannot proceed, because there is no earned trust in the model's scores at all), while a judge that *has* been calibrated and *failed* "reports its scores as advisory only, never as a blocking verdict" (the comparison should still run — a human still wants to see the paired stats, the MDE, and any deterministic-grader signal — the failing judge's scores just cannot be the thing that flips the verdict). Collapsing these to the same behavior would either be too strict (blocking a comparison entirely over a judge grader that isn't even the one being investigated this cycle) or too permissive (letting a judge known to disagree with humans worse than chance quietly count at full weight toward `regression`).

**What zeroing the weight actually does, mechanically:** `weightedScore()` divides by `totalWeight`; if a case's *only* configured grader is an advisory judge, `totalWeight` is `0` and `weightedScore()` returns `null` — the same "no usable score" signal `loadRunCaseData()` already uses for a case with zero recorded grades. That case is then excluded from `pairedCaseCount` by the ordinary pairing exclusion path (Phase 4), not by any special-cased judge-advisory logic. If every case in the suite depends solely on that one advisory judge, the comparison still runs but resolves to `insufficient_data` (paired count below `minPairedN`) rather than a crash — verified directly (see PROGRESS.md Phase 5 exit criteria) with a suite whose only grader is a deliberately uncalibrated-and-failing judge.

### The calibration gate checks the CURRENT suite config's rubric hash, not whatever hash actually produced a run's historical grades

**Decision:** `checkJudgeCalibrationGates()` computes `judgePromptHash` by re-hashing the rubric found in the `SuiteConfig` it was handed (via `rubricFromGraderConfig` + `buildJudgeSystemPrompt` + `hashPromptTemplate`) — not by reading back whatever hash was actually in effect when a run's `grades` rows were written.

**Why this is a real, accepted gap, not an oversight:** the `grades` table (§4's schema, followed verbatim in `packages/core/src/db/schema.ts`) has no `judge_prompt_hash` column — only `judge_model`. Adding one would mean extending the committed schema unilaterally beyond what §4 specifies, for a gap that only manifests in a specific, avoidable sequence: comparing two *already-graded* runs after editing a judge rubric *in between* grading them and comparing them. The normal workflow (`llmreg run` immediately followed by `llmreg compare`, which is what CI does on every PR) never hits this, because both runs are always graded under whatever rubric is current at comparison time — there is no "in between" for CI to land in. Someone deliberately holding onto old run IDs across a rubric edit and comparing them anyway is a real but narrow misuse case; extending the schema now, speculatively, to guard against it would be building for a hypothetical rather than the workflow §5 actually describes. Revisit if a real workflow surfaces where runs are compared long after they were generated.

### `llmreg calibrate --labels-file` as an escape hatch for scripted labeling, alongside the interactive flow §7 specifies

**Decision:** The CLI's `calibrate` command supports two label-collection modes: the interactive `readline`-driven prompt loop §7 describes ("interactive labeling session, computes kappa"), and an alternate `--labels-file <path>` flag that reads a JSON map of `{ externalId: score }` and records those as human labels without prompting.

**Why it exists:** a real calibration run requires 100–300 genuine human judgments per §5.5 — this build environment has no human available to type them and no way to fabricate them without defeating the entire point of calibration (a judge "validated" against labels the same process that built the judge also invented proves nothing). `--labels-file` exists so the calibration *pipeline* — sampling, `recordHumanLabel`, `matchLabelsToJudgeGrades`, `cohensKappa`, `saveCalibration`, and the downstream gate in `compare.ts` — could be mechanically verified against a real database using clearly-synthetic label data (see PROGRESS.md's Phase 5 exit criteria), without either skipping verification entirely or silently passing off synthetic labels as a real calibration. It is not a replacement for real labeling and every place it's used in this repo's own verification says so explicitly.

**Alternative:** Interactive-only, matching §7's CLI surface literally, with no scripted path.

**Why `--labels-file` was added anyway:** without it, the calibration gate's actual behavior (missing → reject; failing → advisory-only, not blocking; passing → verdict-eligible; stale rubric → reverts to missing) would be verifiable only by manual, real-time interactive typing during this build — not repeatable, not something a future contributor could re-run to confirm the gate still works after a refactor. The flag is intentionally undocumented in the spec's own CLI table (§7) because it is a build/verification convenience, not a feature the product's real users are expected to reach for; real calibration is, and should remain, a human sitting down and reading outputs.

## Phase 6

### RESOLVED at the Phase 6 checkpoint: is "false positive rate" the one-sided regression rate or the combined two-sided rate?

**User's decision (Phase 6 checkpoint):** leave the statistical construction as-is — `determineVerdict`'s `regression` verdict stays a one-sided read of the existing two-sided `(1-α)` bootstrap CI, no change to `bootstrapCI`'s interval construction or `verdict.ts`'s threshold. The README states both rates precisely (the one-sided `regressionRate`, target `α/2`, and the combined `combinedRate`, target `α`) rather than asserting a single unqualified "~5%" the way §12's own suggested wording did. See `README.md`'s null-model section for the resulting language.

The write-up below is kept in full as the record of what was found and why it was raised, per rule 4 ("this file records reasoning").

This is the most consequential finding of Phase 6, surfaced independently by both `statistician` and `test-author` during their workflow (working from the same contract, without reading each other's output) before either read the other's conclusion — not a single agent's guess.

**The finding:** `determineVerdict` (§5.6) sets `verdict: 'regression'` when `ciUpper < 0` — one edge of a two-sided `(1 − α)` percentile bootstrap CI (§5.2). Under a true null (§6.1's setup: two variants with identical behavior), standard CI theory says that one-sided event converges to `α/2`, not `α`; the symmetric `improvement_detected` event takes the other `α/2` of the tail; their sum ("the CI excluded zero at all") converges to `α`. This was confirmed multiple independent ways before being accepted as real rather than a bug: through the full generator → `computeComparison` pipeline across many parameter combinations at 1,000+ trials (consistently 2–3% one-sided, ~4.4–4.9% combined); independently of the synthetic generator entirely, driving the real `bootstrapCI` directly on continuous Gaussian data with a true mean of 0 (one-sided rate ≈ half the two-sided "excludes zero" rate on the same runs); and in a real, deterministic 2,000-trial CLI run after integration (`regressionRate: 2.35%` against a `2.50%` target, `combinedRate: 5.00%` against a `5.00%` target — see PROGRESS.md).

**Why this matters:** §6.1's prose ("the observed rate must land near 5%") and the README's own planned worked example (§12: "reports a false regression 4.9% of the time at α=0.05") are quantitatively consistent with the **combined** rate — but §6.1 also explicitly instructs counting only `regression` verdicts, which is the **one-sided** rate. These two numbers differ by a factor of ~2 and answer different questions: `regressionRate` is "how often does this tool wrongly block a PR when nothing changed" (the number a team evaluating this tool's trustworthiness actually cares about, since `improvement_detected` still passes the check per §5.6's own table); `combinedRate` is the standard textbook two-sided Type-I-error rate, and the one the spec's own prose numerically lands on.

**Alternative 1 (rejected, not silently applied): redefine "regression" from a genuinely one-sided `(1 − α)` bound**, so the one-sided rate converges to `α` by construction. Rejected as something to do unilaterally here because it is a real change to already-built, already-tested, real-infra-verified Phase 1/4 code (`bootstrapCI`'s CI construction and/or `verdict.ts`'s threshold), with a direct effect on the `ciLower`/`ciUpper` values already stored in the `comparisons` table and shown in every report — precisely the kind of change this build's own rules (§14, rule 3: "never delegate a CHECKPOINT," and the broader instruction that CHECKPOINTs are for the user's direct review) say should go to the user, not be resolved by an agent mid-phase.

**Alternative 2 (rejected, not silently applied): retarget §6.1's/§12's prose to `α/2`** and leave the statistical construction untouched. This is the *simpler* fix and may well be the right one — but it changes a headline, externally-visible claim this repo will make (the README's worked example), which is exactly the kind of claim that should be stated with the user's sign-off, not quietly rewritten.

**What was actually done:** neither alternative was applied. `runNullModelSimulation` (`packages/core/src/simulations/null-model.ts`) reports both `regressionRate` (target `α/2`) and `combinedRate` (target `α`), each with its own tolerance check, so nothing is hidden behind a single number that only tells half the story. `llmreg simulate null` prints both explicitly, with a note pointing at this entry. The question of which one belongs in the tool's outward-facing "X% false positive rate" claim (and whether the underlying construction should change to make the one-sided rate hit `α` directly) is raised to the user at the Phase 6 checkpoint.

### `bootstrapCI`/`computeComparison` gained an optional, backward-compatible `rand` parameter

**Decision:** `bootstrapCI` (`packages/core/src/stats/bootstrap.ts`) now accepts an optional fourth parameter, `rand: () => number = Math.random`, forwarded from an optional `rand` field on `computeComparison`'s `RegressionComparisonInput` (`packages/core/src/comparison/statistics.ts`). Every existing call site (`compare.ts`, every Phase 1/4 test) omits it and is completely unaffected — the default preserves the exact prior behavior byte-for-byte.

**Why:** Phase 6's simulations (`null-model.ts`, `power-curve.ts`, `pairing-benefit.ts`) need to reuse the REAL `computeComparison` (not a reimplementation — the whole point of Phase 6 is validating the actual production code) while still making a real "same seed, same result" claim, since a simulation whose output silently changes between otherwise-identical runs undermines confidence in every number it reports. The statistician's original Phase 6 workflow run correctly identified this gap and worked around it in a scratch verification environment by monkey-patching the global `Math.random` around each call — a real technique, but not something to ship in production simulation code. Adding an explicit, optional, purely-additive parameter is the clean fix: it costs nothing for any existing caller and makes every affected simulation genuinely deterministic (verified: identical `llmreg simulate null --seed 999` output across repeated runs, byte-for-byte).

**Alternative:** Leave `bootstrapCI` untouched and have each simulation file monkey-patch `Math.random` internally around its `computeComparison` calls (what the statistician's scratch reference did for verification purposes).

**Why it lost:** monkey-patching a global built-in, even temporarily and even scoped correctly, is a footgun — a thrown exception between the patch and the restore leaves `Math.random` globally broken for the rest of the process, and it's invisible from the call site that it's happening at all. An explicit parameter is visible in the type signature, cannot leak past its own call, and required touching only two files instead of duplicating the pattern in every simulation module that needs it.

### The unpaired bootstrap in `pairing-benefit.ts` is not added to `stats/bootstrap.ts`

**Decision:** §6.5's paired-vs-unpaired comparison needs an "unpaired" analysis (an independent bootstrap on the difference of two groups' means, discarding per-case correspondence) that has no equivalent anywhere in the actual product. It's implemented self-contained inside `simulations/pairing-benefit.ts`, not exported from `stats/`.

**Why:** this function exists solely to make one specific demonstration possible, and has no other caller anywhere in the codebase. §5.1 is unambiguous that this tool never actually offers unpaired comparison as a real option — that's the entire point being illustrated. Adding a permanent, product-facing "unpaired analysis" capability to `stats/` to satisfy a one-off simulation would be over-building a capability that would then need its own tests, its own documentation, and its own justification for existing, none of which apply here. If a genuine second caller ever emerges, promoting it to a shared module at that point is the right sequencing — not before.

### `caseDifficultySpread` is a uniform wobble, not a Beta distribution

**Decision:** `generateSyntheticPairedCases`'s per-case difficulty is `basePassRate + caseDifficultySpread · Uniform(-1, 1)`, clamped to `[0, 1]` — not a Beta-distributed pass probability, which would be the more conventional choice for modeling a latent per-case success probability.

**Why:** a correct Beta sampler requires a Gamma sampler layered on top of the seeded uniform PRNG (`mulberry32`) this repo already has — real added implementation complexity. None of the five §6 validations actually depend on the *shape* of the per-case difficulty distribution, only on the fact that some shared per-case variance exists between the baseline and candidate draw for a given case (this is what §6.5's pairing-benefit demonstration needs to be non-degenerate — see `generator.ts`'s module comment). A simpler distribution that has this one load-bearing property does the job exactly as well as a more "realistic-looking" one, for a component whose entire purpose is synthetic validation, not modeling real-world case difficulty distributions for their own sake.

### Judge drift (§6.4) has no CLI verb

**Decision:** `runJudgeDriftSimulation` is a library function with tests, not wired into `llmreg simulate` as a fourth subcommand.

**Why:** §7's CLI table lists exactly `llmreg simulate null|power|mde` — three verbs, not four or five. §6 describes five validations, but only three (null model, power curve, MDE) get explicit CLI-level treatment in the spec's own surface; §6.1's Exit criteria for Phase 6 (§9) likewise only names the null model rate, the power curve grid, the MDE match, and the paired-vs-unpaired chart — judge drift is absent from that list too. Rather than invent a CLI surface the spec doesn't ask for, judge drift stays a tested library function, runnable directly by anyone who wants to see it (as demonstrated in PROGRESS.md's exit criteria), without expanding the committed CLI contract unilaterally.

## Phase 7

### An uncalibrated judge now exits 2, not 3 — a real §5.5/§7 inconsistency, resolved by following §7's own exit-code table

**Decision:** `checkJudgeCalibrationGates()` (`packages/core/src/comparison/compare.ts`) now throws a distinguishable `UncalibratedJudgeError` (exported) instead of a plain `Error` for a `'missing'` calibration gate. `llmreg compare`'s CLI catch block checks for this type specifically and sets `process.exitCode = 2`; every other thrown error still sets `3`.

**The inconsistency:** §5.5 says a comparison with a missing calibration "is rejected, not warned about" — language that reads as a hard failure. But §7's own exit-code table is explicit: `"2 insufficient data or uncalibrated judge (warn-level, configurable to block)"` — grouping an uncalibrated judge with `insufficient_data`, which §5.6's own verdict table treats as "pass with a warning, never a block." Phase 5's original implementation followed the §5.5 reading literally (a thrown `Error`, caught by the CLI's generic `catch` block, which sets exit `3`) — meaning "you haven't calibrated your judge yet" and "the database is unreachable" produced the identical exit code, indistinguishable to any CI system or human reading a failed check.

**Why `2` wins:** exit `3` is reserved for genuine infrastructure failure elsewhere in this codebase (`doctor`, `run`, `migrate` all use it that way) — conflating a known, expected, fixable configuration state (no calibration yet) with an actual system failure misuses the one signal a team has for "is this my fault or the tool's/network's." §5.5's "rejected, not warned about" is preserved exactly as written — `compareRuns()` still throws, still refuses to produce a verdict or write a `comparisons` row, nothing about the rejection itself changed. Only the CLI-level exit code changes, to match §7's own explicit table rather than a looser reading of §5.5's prose. This is the same category of internal-inconsistency finding as the Phase 6 null-model one: two sections of the same spec say different things, and the fix follows whichever section is more specific and more operationally load-bearing (§7's table is a literal contract CI scripts key off of; §5.5's "rejected" is prose describing intent, satisfied either way).

**Alternative:** Leave it at exit `3`, since §5.5's wording is the more prominent, dedicated section on judge calibration specifically.

**Why it lost:** it would leave a Phase 8 GitHub Action with no way to treat "please calibrate your judge" differently from "the Anthropic API is down" without inspecting stderr text — exactly the class of problem structured exit codes exist to avoid. §7's table is unambiguous and is the section CI integration code will actually be written against.
