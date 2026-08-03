# Statistics

This document explains, in plain language, every statistical method this tool uses, and the assumptions each one carries. It is written for someone deciding whether to trust a number the tool prints, not for someone who already trusts statistics blindly — be skeptical, that is the correct posture.

We are not statisticians by training. Every method below is standard, textbook material — nothing here is novel or exotic. We implement it in-repo rather than pulling from a library so it can be verified line by line and unit-tested against known answers (see `docs/DECISIONS.md`). Where we made a judgment call between two reasonable standard choices, that call and the alternative are recorded there too.

This file grows with the project: Phase 5 will add a section on judge calibration (Cohen's kappa), and Phase 6 will add the simulation results (null model false positive rate, power curve, MDE validation) that turn everything below from "should be correct" into "measured to be correct." What follows covers Phase 1 — the four pure functions in `packages/core/src/stats/`.

## 1. Paired comparison, not two independent runs

Before any of the tests below run, every case gets a **per-case difference**: `d_i = candidate_i − baseline_i`, computed only for cases that produced a valid result under both variants. Cases that errored under either variant are excluded from the statistic and reported separately as an infrastructure error — never scored as a zero, because a timeout is not a quality failure and treating it as one is how a flaky network becomes a manufactured regression.

**Why pairing matters:** cases in a real eval suite vary enormously in difficulty. A hard case might score 0.3 under both variants; an easy one might score 0.95 under both. If you computed the mean score for baseline and the mean score for candidate separately and subtracted, that between-case variance in difficulty would swamp almost any real effect of the prompt change you're trying to measure. Pairing sidesteps this entirely: each case is compared only to itself. All the statistics below — the bootstrap CI and McNemar's test — operate on this vector of per-case differences (or per-case pass/fail pairs), never on two separate summary numbers.

**Assumption:** the two variants ran on *identical* inputs per case. If the candidate saw a different input than the baseline for a given `external_id`, the "pairing" is fiction and every downstream number is wrong.

## 2. The confidence interval: percentile bootstrap

**File:** `packages/core/src/stats/bootstrap.ts` — `bootstrapCI(differences, iterations, alpha)`

**What it does.** Given the vector of per-case differences, resample it with replacement `iterations` times (each resample is the same size as the original, drawn case-by-case with replacement), recompute the mean of each resample, and take the `alpha/2` and `1 - alpha/2` percentiles of that distribution of resampled means as the confidence interval. The point estimate reported alongside it is the plain mean of the original (non-resampled) differences.

**Why bootstrap instead of a t-test.** A t-test's confidence interval assumes the underlying data (or at least the sampling distribution of the mean) is approximately normal. LLM evaluation scores routinely violate that: judge scores pile up at the top of a bounded 0–1 scale, pass/fail differences are literally three-valued (−1, 0, +1), and score distributions are often bimodal (the model either nails a case or badly misses it, rarely in between). The bootstrap makes no assumption about the shape of the distribution — it estimates the sampling distribution of the mean directly from the data itself, by pretending the observed sample *is* the population and repeatedly drawing from it.

**Assumptions:**

- **Exchangeability of cases.** The core assumption is that every difference `d_i` is interchangeable with every other `d_i` for the purpose of resampling — there's no hidden structure (ordering effects, drift over the course of a run, clusters of near-duplicate cases, several cases coming from the same underlying conversation) that would make some cases systematically more alike than others in a way the resampling can't see. If that assumption is wrong — say, later cases in a run systematically score worse because of a rate-limit-induced pattern — the bootstrap interval will be too narrow: it has no way to widen for correlation it isn't told about.
- **No distributional assumption on the differences themselves.** This is the whole point of using the bootstrap. It only assumes the observed sample of differences is a reasonable stand-in for the full population of differences you'd see if you ran every possible case.
- **The percentile method specifically** (as opposed to more sophisticated bootstrap variants like BCa or the bootstrap-t) is known to under-cover — i.e., produce intervals slightly narrower than they should be — when the sample is small or the differences are strongly skewed. It is the simplest bootstrap CI to implement and verify by hand, and it is adequate at the sample sizes this tool targets (the example suite in §11 of the spec is 240 cases), but it is not the most statistically refined option that exists. See `docs/DECISIONS.md` for the alternative considered.

**Verified against:** a sample of 500 points drawn from a known Normal(2.5, 8) distribution. The bootstrap's 95% CI came out at `[1.4166, 2.8357]` against the closed-form analytic interval `mean ± 1.95996 × sampleSD/√n = [1.4242, 2.8299]` — within 5% of the interval's width, well inside expected Monte Carlo noise at 20,000 bootstrap iterations. Full numbers are in the Phase 1 verification output.

## 3. McNemar's test, for binary pass/fail outcomes

**File:** `packages/core/src/stats/mcnemar.ts` — `mcnemarTest(baselinePass, candidatePass)`

**What it does.** For paired binary (pass/fail) outcomes, builds the 2×2 table of how each case's pass/fail status moved between baseline and candidate, and tests whether the two directions of disagreement — "passed under baseline, failed under candidate" (`discordantB`) versus "failed under baseline, passed under candidate" (`discordantC`) — are asymmetric enough to not be explained by chance.

**Why only discordant pairs matter.** A case that passed under *both* variants, or failed under *both*, tells you nothing about whether the change moved anything — it's evidence the variants agree on that case, not evidence about the difference between them. If a case is scored the same under both variants, whether it happens to be a pass or a fail is irrelevant to the question "did this change something." McNemar's test is built entirely around this: it looks only at the pairs that flipped, and ignores the pairs that agree. Concordant pairs are counted during grading and reporting (e.g. "232 of 240 cases unchanged") but they never enter the statistic itself — including them would dilute the signal with cases that carry zero information about the change.

**The statistic.** This implementation always applies **Edwards' continuity correction**:

```
statistic = (|b - c| - 1)² / (b + c)
```

rather than the uncorrected `(b - c)² / (b + c)`. This is the standard default for McNemar's test — it's what R's `mcnemar.test()` applies unless the caller explicitly turns it off — and it matters most exactly where this tool spends most of its time: eval suites in the tens-to-low-hundreds of cases, where the number of discordant pairs (`b + c`) is often well under 50. The correction exists because `b − c` is a discrete quantity being approximated by a continuous chi-square distribution; without the correction, the resulting p-value is anti-conservative (too small) when `b + c` is small. At large `b + c` the correction's effect vanishes to nothing, so there's no accuracy given up at scale.

**The p-value.** Derived from the chi-square distribution with 1 degree of freedom, computed via the identity that if `Z ~ N(0,1)` then `Z² ~ chi-square(1)`, so `P(chi-square > x) = 2 × (1 − Φ(√x))` where `Φ` is the standard normal CDF. `Φ` itself is a hand-written numerical approximation (Abramowitz & Stegun 7.1.26 for the error function) — see `packages/core/src/stats/normal-distribution.ts`. This sidesteps needing a general chi-square/gamma CDF: McNemar's statistic always has exactly 1 degree of freedom, so that's the only case this code needs to handle.

**Assumptions:**

- **Paired binary outcomes on identical cases**, same requirement as everything else in this document — `baselinePass[i]` and `candidatePass[i]` must describe the same case under each variant.
- **Only discordant pairs carry information**, as above — concordant pairs are correctly and deliberately excluded from the statistic.
- **Independence across cases.** If the dataset contains duplicated or near-duplicated inputs, the discordant-pair counts are effectively inflated relative to the number of truly independent observations, and the test becomes over-confident — the same failure mode as the bootstrap's exchangeability assumption, described in different terms.
- **Enough discordant pairs to matter.** With single-digit `b + c`, the test has very little power and any p-value it produces should be read as indicative at best.

**Verified against:** a small case with `b=9, c=3` (12 discordant pairs total), computed two independent ways:
1. Hand-computed continuity-corrected statistic: `(|9−3|−1)²/12 = 25/12 = 2.083333`, matching the function's output exactly.
2. An independently-derived **exact binomial two-sided p-value** (not the same math path as the chi-square approximation): under the null, `discordantB ~ Binomial(12, 0.5)`, so `p = 2 × P(X ≤ 3) = 2 × 299/4096 = 0.145996`. The function's continuity-corrected chi-square approximation gave `p = 0.148915` — close to the exact value, with the small remaining gap being the expected, well-documented behavior of the chi-square approximation to the exact binomial test (the reason the continuity correction exists in the first place is to narrow exactly this gap).

A larger case (`b=121, c=59`, 180 discordant pairs, 314 total) was also checked: hand-computed statistic `20.672222` matched the function's output exactly, with `p = 5.4554 × 10⁻⁶`.

A separate check confirmed that changing the *concordant* counts (`a` and `d`) while holding `b` and `c` fixed does not change the statistic or p-value at all, as required.

## 4. Minimum detectable effect (MDE)

**File:** `packages/core/src/stats/mde.ts` — `minimumDetectableEffect(differenceSD, n, alpha, power)`

**What it does.** Reports the smallest true effect that a paired comparison of this size and this per-case variability could detect, at the given significance level and desired statistical power. This is reported *before* any verdict, every time, per §5.4 of the spec — it's the single most useful number in the report, because "no detectable difference" on a 40-case suite that can only see effects above 15 points is a very different finding from the same words on a 240-case suite that can see effects above 2 points.

**The formula:**

```
MDE = (z_(alpha/2) + z_power) × differenceSD / √n
```

where `z_(alpha/2)` is the two-sided critical value (≈1.96 at alpha=0.05) and `z_power` is the one-sided quantile for the desired power (≈0.84 at power=0.8). Both are computed with a hand-written inverse normal CDF (Peter Acklam's rational approximation, in `normal-distribution.ts`).

This comes directly from treating the comparison as a **one-sample test on the vector of per-case differences** — pairing (§1 above) already turned what would otherwise be a two-independent-samples problem into a one-sample problem, so the standard error is `differenceSD/√n`, not the `√2 × SD/√n` you'd use for two separate arms. This is the standard power-analysis formula for sizing a one-sample or paired test.

**Assumptions:**

- **Normal approximation (z-scores), not the exact t-distribution.** This slightly *understates* the true MDE at small n — a t critical value is larger than the corresponding z critical value at small degrees of freedom, so the real required effect is a bit bigger than what this formula reports. The gap shrinks fast (under roughly 1% by n≈60) and matters least exactly where this tool is meant to run (the example suite targets 240 cases). Implementing the exact t-quantile requires inverting the incomplete beta function — real added complexity for a correction that's marginal at the sample sizes in scope. See `docs/DECISIONS.md`.
- **`differenceSD` is the sample standard deviation of the same per-case differences fed to the bootstrap.** This function doesn't compute it — consistent with the pure-function, no-I/O contract, it takes already-known summary statistics and returns a number.
- **Two-sided.** The reported MDE is for detecting an effect in *either* direction at the stated power — matching the two-sided percentile bootstrap CI used for the verdict.
- **Must match the empirical power curve.** Per §6.3 of the spec, this formula is only trustworthy once it's checked against Phase 6's simulated power curve — if the formula says 5 points but simulated data shows only 50% detection at 5 points, the formula (or one of the assumptions above) is wrong. That full validation is Phase 6's job. As a smaller sanity check run during Phase 1: at `SD=10, n=100, alpha=0.05, power=0.8`, the formula reports `MDE=2.801585`; simulating 5,000 trials with a true effect exactly equal to that MDE and testing at alpha=0.05 rejected the null **80.02%** of the time (z-test proxy), and a second simulation using the actual `bootstrapCI` function (400 trials, 1,500 bootstrap iterations each, both statistical detection methods completely independent of the MDE formula's derivation) detected the effect **79.50%** of the time — both very close to the target 80%.

## 5. Verdict logic

**File:** `packages/core/src/stats/verdict.ts` — `determineVerdict(input)`

**What it does.** Combines the outputs of the sections above — the bootstrap CI bounds, the MDE, the paired sample size, and a count of critical-tagged cases that regressed — into exactly one of four words. This function contains no statistics of its own; it is pure decision logic, and it trusts its inputs completely. If a caller passes in a CI computed from unpaired data, or the wrong alpha, this function has no way to detect that and will produce a confidently wrong verdict from correct-looking logic.

**The four verdicts, and the precedence between them (this order matters and is enforced exactly, not just approximately):**

1. **`regression`** — the aggregate CI's upper bound is entirely below zero (i.e. even the most optimistic end of the interval says the candidate is worse), **or** at least one critical-tagged case regressed. This check runs first and overrides every other consideration, including whether the aggregate sample was otherwise too small to trust. A single critical case regressing fails the check regardless of what the rest of the aggregate statistic says — a change that fixes twenty easy cases and breaks the one about refund eligibility is still a bad change.
2. **`insufficient_data`** — the MDE exceeds a configured ceiling, or the paired sample size is below a configured floor. Checked only once regression has been ruled out, and it wins over what the CI alone would otherwise suggest: a CI that happens to sit entirely above zero on 8 paired cases is not "improvement detected," it's a dataset too small to trust either way.
3. **`improvement_detected`** — the CI's lower bound is entirely above zero. Named "detected," deliberately not "proven" or "confirmed" — see below.
4. **`no_detectable_difference`** — none of the above; the interval spans zero and the dataset was adequate to say so honestly.

**Why `no_detectable_difference` and `insufficient_data` are kept as two distinct outcomes, not one.** "We looked and found nothing" and "we couldn't have found anything smaller than the ceiling even if it were there" are different findings that call for different next actions — the first says the change is probably fine at the resolution this suite can see; the second says go build a bigger suite before trusting any verdict from this one. Merging them into a single "no significant difference" (as most naive eval tools do) is exactly the failure mode this tool exists to avoid.

**Why this tool never says "improved" outright.** `improvement_detected` is the strongest positive verdict this function can return, and its name is deliberately not "proven better." A tool that tells a team a noisy 40-case suite shows their change is "good" trains that team to ship on noise, and the first time that backfires in production is the last time anyone trusts the tool. The narrower claim — "we detected evidence of an improvement, at this sample size and this significance level" — is the one that survives a skeptical engineer asking follow-up questions.

**Verified against:** 13 hand-constructed input combinations covering every branch and every precedence interaction described above — including deliberately adversarial cases like a fully-improving CI paired with `criticalRegressed > 0` (must still return `regression`), a fully-regressing CI paired with `mde` far over ceiling (must still return `regression`, not `insufficient_data`), and boundary cases at exactly zero / exactly the ceiling / exactly the floor (must fall to the non-triggered side, since every threshold in this function is a strict inequality). All 13 passed against their expected verdict.

## 6. The comparison engine — wiring pairing to the four primitives

**Files:** `packages/core/src/comparison/pairing.ts` (`pairCases`) and `packages/core/src/comparison/statistics.ts` (`computeComparison`).

Sections 1–5 above cover the four pure statistical primitives in isolation. This section covers how Phase 4 wires them together into one comparison, per §5.1/§5.6 of the spec. Like everything above it, both files are pure functions over plain data — no database, no API calls, no file reads.

### 6.1 Pairing

`pairCases(baseline, candidate)` takes two arrays of per-case outcomes — one row per case per run, each either a valid `{ score, passed }` or `{ score: null, passed: null }` for a case that errored on that side — and produces two lists:

- `paired`: cases with a valid, non-null result on **both** sides. Each entry carries `difference = candidateScore - baselineScore` (§5.1's `d_i`), the exact quantity every downstream statistic operates on.
- `excluded`: every other case, tagged with *why* it didn't pair — `errored-baseline`, `errored-candidate`, `errored-both` (present on both sides but at least one side failed), or `missing-baseline`/`missing-candidate` (present on only one side at all).

A case's own `externalId` never appears in both lists — the two lists partition the full set of `externalId`s seen across both inputs. This is what makes §5.1's rule concrete: *"A case that errored on one side is excluded from the comparison and reported separately as an error, never silently scored zero."* An excluded case contributes nothing to any mean, any CI, any McNemar count — it is reported to the user as an infrastructure problem, not folded into the statistic as if the model produced a bad answer.

`critical` is carried onto each paired case for use downstream (the critical-case override, §6.3 below). Since `critical` is a property of the underlying dataset case rather than of a specific run, both sides should agree on it; if they don't (a data inconsistency pairing can't rule out from its inputs alone), pairing takes the logical OR of the two sides — treating a case as critical if *either* side says so, since under-flagging a critical case is the more dangerous failure direction here.

### 6.2 Combining the four primitives

`computeComparison` takes the `paired` list from `pairCases` (never the `excluded` list — nothing excluded ever enters a statistic) plus the run's thresholds (`alpha`, `mdeCeiling`, `minPairedN`, `bootstrapIterations`, and optionally `power`, which defaults to 0.8 — the value used everywhere the spec's own prose discusses power) and:

1. Computes `regressedExternalIds` / `fixedExternalIds` / `criticalRegressed` directly from the paired list's pass/fail flips (§6.4 below).
2. Runs `bootstrapCI` on the vector of `difference`s to get the point estimate (`delta`) and the 95% interval (`ciLower`/`ciUpper`).
3. Computes the sample standard deviation of the same differences and feeds it into `minimumDetectableEffect` to get `mde`.
4. Runs `mcnemarTest` on the paired `baselinePassed`/`candidatePassed` arrays as supplementary evidence (§6.5 below).
5. Feeds `ciLower`, `ciUpper`, `mde`, `mdeCeiling`, the paired count, `minPairedN`, and `criticalRegressed` into `determineVerdict` to get the one word a human reads.

**The verdict is always driven by the bootstrap CI, never by McNemar.** This is a specific reading of the `comparisons` table (§4 of the spec), which has a single `test`/`p_value` pair, not one per statistical method, and of `verdict.ts`'s signature, which only accepts a CI (`ciLower`/`ciUpper`), not a McNemar result. McNemar is always additionally computed (whenever there's at least one paired case) and reported on the result — its `discordantB`/`discordantC` counts are a second, independently-derived check that the regressed/fixed counts are internally consistent (§6.4) — but it never substitutes for the bootstrap CI in deciding the verdict. `test` is therefore always reported as `'paired_bootstrap'`, and the top-level `pValue` is always `null`: the percentile bootstrap as implemented doesn't produce a formal p-value (that would require the full vector of resampled means, which `BootstrapResult` doesn't expose), and McNemar's own p-value stays on `mcnemar.pValue` rather than being copied into a top-level field that's documented as describing the named `test`. See `docs/DECISIONS.md` for the alternative (a McNemar-driven verdict path for binary-only suites) and why it was deferred rather than built now.

### 6.3 The critical-case override, concretely

Per §5.6, a critical-tagged case regressing fails the check "regardless of the aggregate statistic." Concretely: `computeComparison` counts `criticalRegressed` independently of the CI, and passes it straight into `determineVerdict`, whose first branch is `ciUpper < 0 || criticalRegressed > 0`. A suite where 29 easy cases all improved and 1 critical case flipped from passing to failing will have a CI sitting entirely above zero (the aggregate looks like a strict improvement) — and still returns `verdict: 'regression'`, because the critical-case check runs first and short-circuits everything below it. Verified with real numbers in the Phase 4 verification output: CI `[0.30, 0.40]` (fully positive), `criticalRegressed: 1`, verdict `regression`.

### 6.4 Regressed and fixed are defined by a pass/fail flip, not raw score movement

```
regressed: baselinePassed === true  && candidatePassed === false
fixed:     baselinePassed === false && candidatePassed === true
```

A case whose score moved (say 0.9 → 0.7) but whose pass/fail status didn't is not counted as "regressed" here — a raw-score-movement definition would make `criticalRegressed` and the PR comment's "regressed cases" table (§5.8) sensitive to threshold noise inside the passing band, which is exactly the kind of noise the rest of this document argues against chasing. This definition is also what keeps McNemar's `discordantB`/`discordantC` in exact agreement with `regressedExternalIds.length`/`fixedExternalIds.length` — both are counting the same flips, from the same paired list, by construction. That agreement is asserted directly in the Phase 4 verification (see below), not just assumed.

### 6.5 The `pairedCaseCount === 0` edge case

`bootstrapCI` throws on an empty array by design (Phase 1's own contract: "requires at least one difference"). If every case in the suite errored on at least one side, `paired` is empty and there is nothing to bootstrap, nothing to run McNemar on, and no real delta to report. `computeComparison` short-circuits before calling any Phase 1 primitive in this case, rather than letting that error propagate up as an unhandled crash, and returns:

- `delta: 0`, `ciLower: 0`, `ciUpper: 0` — there is no data to compute a real point estimate or interval from. Reporting `[0, 0]` alongside `insufficient_data` (not `no_detectable_difference`) is the honest way to say "nothing was measured," rather than accidentally reading as a legitimate zero-effect finding.
- `mde: Infinity`, deliberately not `0`. The MDE means "the smallest true difference this dataset could reliably detect." With zero paired cases, the dataset cannot reliably detect *any* effect, no matter how large — reporting `0` would claim perfect sensitivity, the exact opposite of the truth, and the opposite failure direction from the one §5.4 exists to prevent (an under-reported MDE hiding a suite's blind spots).
- `mcnemar: null` — nothing to compute McNemar over.
- `verdict: 'insufficient_data'` — not `no_detectable_difference`. Zero paired cases is the clearest possible instance of "this dataset could not have found anything," never "we looked and found nothing."

Verified directly: a case list where every case errors on at least one side (one of each of `errored-baseline`, `errored-candidate`, and `missing-baseline`) produces `paired.length === 0` from `pairCases`, and `computeComparison` returns the exact result above without throwing.

### 6.6 A known small-n artifact in the MDE, and why it's not special-cased here

With exactly one paired case, the sample standard deviation of a single value is undefined by the usual Bessel-corrected formula (division by `n - 1 = 0`); `computeComparison` returns `0` for that case rather than `NaN`, and `minimumDetectableEffect` already treats `differenceSD === 0` as "any nonzero true effect would be detected with certainty" (`mde = 0`). Read literally at `n = 1` that's backwards — one case tells you almost nothing about the dataset's sensitivity. This isn't special-cased in `computeComparison` because it doesn't need to be: `determineVerdict`'s `pairedN < minPairedN` branch already catches it for any sane `minPairedN` (which should always be well above 1), producing `insufficient_data` regardless of what the MDE formula reports at that n. Documented here rather than silently patched, per `docs/DECISIONS.md`.

## 7. Cohen's kappa — validating the judge, per §5.5

**File:** `packages/core/src/judge/kappa.ts` — `cohensKappa(humanPassed, judgePassed)`

**What it measures.** Whether an LLM judge's pass/fail calls agree with a human's pass/fail calls on the *same outputs*, corrected for the agreement you'd expect to see by pure chance given how skewed the pass rate already is. It is the statistic that turns "we ran a judge" into "we validated a judge" per §5.5: any `judge:*` grader requires a passing calibration (`cohensKappa >= JUDGE_KAPPA_FLOOR`, default 0.6) before its scores may drive a blocking verdict; below the floor, the CI check reports the judge's scores as advisory only.

**Why raw agreement is not enough.** §5.5 states the failure mode directly: "on a task where 90% of cases pass, a judge that says 'pass' unconditionally scores 90% agreement and knows nothing." Raw agreement (`agreementRate = (bothPass + bothFail) / n`) cannot distinguish a judge that is actually discriminating pass from fail from a judge that has simply learned the base rate and repeats it — a rubber-stamp judge on a mostly-passing dataset looks great by raw agreement alone. Kappa corrects for this by subtracting out the agreement rate two independent, uninformed raters with the *same marginal pass rates* would produce purely by chance, then rescaling what's left:

```
Po = observed agreement rate = (bothPass + bothFail) / n
Pe = expected agreement by chance
   = (humanPassRate * judgePassRate) + (humanFailRate * judgeFailRate)
kappa = (Po - Pe) / (1 - Pe)
```

`Po` is what raw agreement already reports. `Pe` is what a judge that ignored the actual output entirely and just guessed "pass" at its own observed pass rate would agree with the human purely by luck, given how skewed the human's own pass rate is. `kappa` is the fraction of the *possible* improvement over chance (`1 - Pe`) that was actually achieved (`Po - Pe`). A judge that only reproduces the base rate has `Po ≈ Pe`, so `kappa ≈ 0` — "knows nothing" — even while `agreementRate` sits at 90%. Both numbers are reported side by side in `KappaResult` (`agreementRate` alongside `cohensKappa`) specifically so a reader sees the gap between them, never just the flattering one.

**Standard, unweighted, 2-category kappa — not a continuous/ordinal-weighted variant.** This implementation computes kappa on the binary PASS/FAIL classification only, matching §5.5's own framing (the 90%-pass example is a statement about a binary classifier) and the `grades.passed: boolean` column in the schema (§4). See `docs/DECISIONS.md` for why a weighted kappa (e.g. quadratic-weighted, appropriate for an ordered multi-point scale where "off by one point" should count as partial credit) was considered and set aside.

**The Pe === 1 degenerate case.** Algebraically, `Pe` can only equal 1 when both raters are unanimous in the *identical* direction across the entire labeled sample — every human label and every judge label are "pass" (or every one is "fail"). Whenever that holds, `Po` is also exactly 1 (if every label from both raters is "pass," every pair is a `bothPass` concordant pair), so the raw formula divides `0` by `0` — a genuine mathematical indeterminate, not just an unlucky zero denominator. No kappa is implied by data like this, because a sample with zero variance in both raters never actually tested whether the judge can tell pass from fail; it never saw a fail. `cohensKappa()` returns `0` in this case rather than `NaN`, `1`, or throwing — see `docs/DECISIONS.md` for the full reasoning; in short, `0` fails the `JUDGE_KAPPA_FLOOR` gate by default, which is the safe direction, and the full `confusionMatrix` is still returned alongside it so a human can immediately see *why* (a matrix with only `bothPass` or only `bothFail` populated looks nothing like a matrix with a real spread of disagreement, even though both currently reduce to the same `kappa` number).

**Assumptions:**

- **`humanPassed[i]` and `judgePassed[i]` describe the same output**, in the same order — per §5.5, that pairing happens by `output_hash`, upstream of this function (see `packages/core/src/judge/calibration.ts`'s `matchLabelsToJudgeGrades`); this function trusts that the arrays it receives are already correctly paired, exactly as `mcnemarTest` trusts its inputs are already paired per-case.
- **Independence across labeled outputs.** If the sampled outputs are not independent (near-duplicates, several from the same conversation), the effective sample size behind `labelCount` is smaller than it looks, and kappa is more sensitive to those correlated cases than the raw count implies — the same failure mode documented for the bootstrap's exchangeability assumption (§2) and McNemar's independence assumption (§3).
- **Kappa validates the judge against the human rubric, not against ground truth about the product.** A judge and a human labeler can agree with each other very well (high kappa) while both applying a rubric that doesn't actually capture what the feature should do. Kappa says the measurement instrument agrees with itself across raters; it says nothing about whether the rubric measures the right thing.

**Verified against:** the widely-cited Wikipedia worked example for Cohen's kappa — a 2×2 table with `bothPass=20, humanPassJudgeFail=5, humanFailJudgePass=10, bothFail=15` (n=50). Hand computation: `Po = 35/50 = 0.70`, `Pe = 0.5×0.6 + 0.5×0.4 = 0.50`, `kappa = (0.70−0.50)/(1−0.50) = 0.40` (Landis & Koch's "fair agreement" band). The function returned `cohensKappa: 0.3999999999999999` (floating-point noise on an exact `0.4`) and `agreementRate: 0.7`, matching to well within floating-point tolerance.

The §5.5 scenario was verified directly with n=100 (90 human-pass/10 human-fail against an all-pass judge): the function returned `agreementRate: 0.9` (misleadingly high) alongside `cohensKappa: 0` exactly (correctly low — the judge "knows nothing," matching the hand computation `Po=0.90, Pe=0.90, kappa=0`). Perfect non-degenerate agreement (5 bothPass, 5 bothFail — variance present in both raters) returned `cohensKappa: 1` exactly. The Pe===1 degenerate case (all-pass, and separately all-fail, on both raters) returned `cohensKappa: 0`, finite, not `NaN`, with `agreementRate: 1` alongside it so the two numbers together tell the honest story: perfect concordance, zero information about discrimination.
