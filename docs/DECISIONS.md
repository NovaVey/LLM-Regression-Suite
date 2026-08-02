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

### Percentile bootstrap, not BCa or bootstrap-t

**Decision:** `bootstrapCI()` uses the plain percentile method — resample, recompute the mean, take the `[alpha/2, 1-alpha/2]` percentiles of the resampled means directly.

**Alternative:** The bias-corrected-and-accelerated (BCa) bootstrap, or the bootstrap-t (studentized bootstrap), both of which are known to have better coverage properties than the plain percentile method when the underlying distribution is skewed or the sample is small.

**Why it lost:** Both alternatives are real methods worth knowing about, not strawmen — BCa in particular is often recommended as the default in modern statistical practice specifically because it corrects for the percentile method's known small-sample bias. It lost here because it is meaningfully harder to implement and verify by hand (BCa requires estimating both a bias-correction constant from the proportion of bootstrap replicates below the observed statistic, and an acceleration constant via jackknife resampling of the original sample — two more numerically fiddly pieces, each with its own way to get subtly wrong) and because the spec's own framing of this decision (§2: "each function is under 40 lines and needs to be unit-tested against a known answer") points at the simpler, more auditable method. The percentile method's under-coverage in small/skewed samples is a real, documented limitation, stated plainly in `docs/STATISTICS.md` rather than hidden. Revisit if Phase 6's simulations show coverage that's off by more than expected at the sample sizes this tool actually ships with.

### MDE formula uses the normal (z) approximation, not the exact t-distribution

**Decision:** `minimumDetectableEffect()` computes `(z_(alpha/2) + z_power) × SD/√n` using z-scores from a hand-written inverse normal CDF.

**Alternative:** The equivalent formula using t-distribution critical values instead of z, which is more exact at small n (a paired comparison is, after all, closer to a one-sample t-test than a large-sample z-test).

**Why it lost:** An exact t-quantile function requires inverting the incomplete beta function (or an equivalent numerical root-find over the t-distribution's CDF) — real, nontrivial numerical code, for a correction that is under ~1% by n≈60 and shrinks fast from there. The spec's own target sample size (§11: a 240-case example suite) is well past where this matters. The z-approximation's one real cost is that it slightly *understates* the true MDE at small n (a few dozen cases or fewer) — documented explicitly in `docs/STATISTICS.md` as a known direction of error, so a team relying on the reported MDE for a small suite knows to treat it as an optimistic (too-small) floor rather than an exact figure.
