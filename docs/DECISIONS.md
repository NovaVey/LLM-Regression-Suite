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
