# Judges — calibration, process and product

`docs/STATISTICS.md` §7 covers the math of Cohen's kappa: the formula, the `Pe === 1`
degenerate case, the assumptions, and a worked verification against the Wikipedia
example. Read that first if you haven't — this file does not repeat any of it.

This file is for someone who is about to attach a `judge:*` grader to their own suite
and needs to know what to actually *do*: what `llmreg calibrate` requires of you, what
a passing or failing result unlocks, why editing a rubric quietly breaks trust in it,
and how to read the numbers that come back. Same posture as `STATISTICS.md`: we are
not statisticians by training, and this document tries to be precise about what the
tool does rather than reassuring about it.

## 1. What calibration actually requires you to do

A `judge:*` grader is worthless until it's been checked against a human, per §5.5. The
mechanics, in order:

1. **Run a suite** so there's something to label. `getRunOutputsForCalibration(runId, grader)`
   (`packages/core/src/judge/persist.ts`) only pulls case results with a non-null
   `output` — a case that errored on this run never enters the labeling pool, the same
   "never score an infrastructure failure as a quality problem" rule that governs
   pairing (`STATISTICS.md` §1).
2. **Sample, stratified by tag, not plain random.** `llmreg calibrate` calls
   `stratifiedSample(allOutputs, sampleSize, o => o.tags.join(',') || '(untagged)', seed)`
   (`packages/core/src/dataset/split.ts`). The default `sampleSize` is **100**
   (`options.sampleSize ?? 100` in `packages/cli/src/commands/calibrate.ts`), and the
   default `seed` is **1** — passing the same suite, run, and seed reproduces the exact
   same sample, which matters if you need to hand a labeling batch to a second person.
   The strata are the *exact tag-set string* of each output — a case tagged both
   `refunds` and `tone` is its own stratum, not folded into either tag alone.
   Allocation is proportional-by-stratum via floor-plus-largest-remainder, so a stratum
   with a 5-item minority in a 240-item suite is still guaranteed at least a
   proportional slice rather than risking zero draws the way a naive uniform random
   sample of 100 from 240 could.
3. **Label each sampled output pass/fail (a 0–1 score).** Two modes, both funneling
   into the same `recordHumanLabel({ caseId, outputHash, grader, score, labeledBy })`:
   - **Interactive (the default, and the one that produces a real calibration):** a
     `readline` loop prints the output and its tags one at a time and asks for a score.
   - **`--labels-file <path>`:** reads a JSON `{ externalId: score }` map and records
     those without prompting. This exists specifically as a scripted/non-interactive
     escape hatch — per `docs/DECISIONS.md`, it was added so the calibration
     *pipeline* (sampling → matching → kappa → persistence → the gate in `compare.ts`)
     could be mechanically verified with disclosed synthetic labels in a sandbox with
     no human available to type real ones. It is not part of §7's own documented CLI
     table on purpose. A calibration produced this way is a pipeline smoke test, not a
     calibration — see §6 below.
4. **The tool computes kappa against your labels**, not against anything else. After
   labeling, `llmreg calibrate` fetches *every* human label ever recorded for this
   `(suite, grader)` pair (not just this session's) and every judge grade from the run
   you pointed it at, matches them by `output_hash` (`matchLabelsToJudgeGrades`), and
   runs `cohensKappa` plus `computeBiasNote` over whatever matched. If nothing matched,
   it throws rather than reporting a kappa computed from zero pairs.
5. **The result is persisted**, one row per calibration run, in `judge_calibrations`:
   `judgeModel`, `judgePromptHash`, `labelCount`, `cohensKappa`, `agreementRate`,
   `biasNote`, `passed`, and (since migration `0002_add_confusion_matrix.sql`) the four
   confusion-matrix integers. Nothing here is derived after the fact from `cohensKappa`
   and `agreementRate` alone — the matrix behind those two numbers is stored so the
   Calibration screen (and this doc) can show *why* a kappa came out the way it did,
   not just the scalar.

## 2. What passing unlocks, what failing means, and what gets rejected outright

`checkCalibrationGate` (`packages/core/src/judge/calibration.ts`) returns exactly one
of three states, and `compare.ts`'s `checkJudgeCalibrationGates` treats them
differently — this asymmetry is deliberate, not an oversight:

- **`passing`** — a calibration exists for the *current* `(judgeModel, judgePromptHash)`
  and its `cohensKappa >= JUDGE_KAPPA_FLOOR` (suite config's
  `thresholds.judgeKappaFloor`, default `0.6`). The grader's scores count at their
  configured weight in `weightedScore()` and can drive any of the four verdicts,
  including `regression`.
- **`failing`** — a calibration exists and matches, but its kappa is below the floor.
  The grader is added to an `advisoryGraders` set and `resolveJudgeGraderWeights()`
  forces its weight to `0` for *both* runs being compared. The judge still runs and
  still produces scores every time (grading happens unconditionally in
  `runner/persist.ts` — whether to trust a score is a separate question from whether to
  compute one), but a weight-0 score can never move the aggregate. If a case's *only*
  configured grader is this failing judge, `weightedScore()` returns `null` for it (its
  `totalWeight` is `0`), and that case is excluded from pairing entirely — same "no
  valid result" path a genuine infrastructure error takes. In the worst case, a suite
  graded solely by a failing judge produces `pairedCaseCount: 0` and verdict
  `insufficient_data`, not a crash and not a fabricated zero. This was verified during
  Phase 5 with a synthetic rubber-stamp judge (always says "pass" against a
  ground truth that's honestly 90% pass / 10% fail): `cohensKappa: 0.000`,
  `agreementRate: 90.0%` — exactly §5.5's "scores 90% agreement and knows nothing" —
  and the subsequent `llmreg compare` against two runs graded only by that judge
  returned `verdict: insufficient_data, paired: 0, excluded: 30` rather than either
  crashing or letting the rubber-stamp judge's scores through.
- **`missing`** — no calibration record at all matches the *current*
  `(judgeModel, judgePromptHash)` pair, whether because the judge was genuinely never
  calibrated or because a calibration exists but has gone stale (§3 below).
  `checkCalibrationGate` deliberately does not distinguish these two cases — both
  require the identical fix (recalibrate) — and `checkJudgeCalibrationGates` throws
  `UncalibratedJudgeError` before any scoring happens at all. `compareRuns()` returns
  nothing: no `comparisons` row is written, no verdict of any kind is produced, not
  even a partial one using whatever deterministic graders are also configured. This is
  a materially harder stop than `failing` — a never-calibrated judge blocks the entire
  comparison outright; a calibrated-and-failing judge only loses its own vote inside a
  comparison that still completes.

**The CLI maps `missing` to exit code 2**, the same bucket as `insufficient_data` —
"warn-level, configurable to block" per §7's exit table — deliberately distinct from
exit code 3 (genuine infrastructure failure). Per `docs/DECISIONS.md`, this was a
correction made after Phase 5 shipped: §5.5's own prose ("rejected, not warned about")
reads like a hard failure, and the first implementation followed that literally,
landing an uncalibrated judge on the same generic-`Error` → exit 3 path as an
unreachable database. That made "you haven't calibrated your judge yet" and "the
Anthropic API is down" indistinguishable to a CI script reading only the exit code.
`UncalibratedJudgeError` is a distinguishable subclass specifically so `llmreg compare`
and `llmreg report` can set exit 2 for it and reserve exit 3 for things that are
actually broken. The rejection itself — `compareRuns()` still refuses to run, still
writes nothing — is unchanged; only the exit code the CLI reports for that rejection
moved.

## 3. Why re-calibration is required when the judge model or the prompt changes

`checkCalibrationGate` matches on exact equality of **both** `judgeModel` and
`judgePromptHash` — neither alone is sufficient, and there is no partial credit for
"only the model changed" or "only the wording changed."

`judgePromptHash = hashPromptTemplate(buildJudgeSystemPrompt(rubric))`
(`packages/core/src/judge/prompt.ts`), where `rubric = rubricFromGraderConfig(graderConfig)`
pulls `{ name, description, criteria }` straight from the suite config's
`judge:<name>` grader entry (`config.description`, `config.criteria`).
`buildJudgeSystemPrompt` assembles the dimension name, the description, the criteria,
and a fixed block of response-format instructions (JSON with a required `score` and a
required, non-empty `rationale`) into one string — this is the **stable, hashed** half
of the judge prompt. The **per-case** half (`buildJudgeUserMessage`: the conversation
plus the candidate output being graded) is deliberately excluded from the hash, per the
file's own comment — hashing it would make every case look like a different judge
prompt and no calibration would ever be reusable across a run.

Practically, this means:

- **Editing `config.criteria` or `config.description` on the grader** — rewording what
  a 0, 0.5, or 1 looks like — changes `judgePromptHash` byte-for-byte. The prior
  calibration silently stops matching. `checkCalibrationGate` returns `missing` for it,
  indistinguishable from having never calibrated at all (this is intentional — see the
  function's own comment: both states need the same fix, so there's no separate
  "stale" status to check for). Nothing warns you at edit time; the first sign is
  `compare` refusing to run the next time you try it.
- **Renaming the grader** (`judge:helpfulness` → `judge:quality`) changes both the
  `grader` string every downstream query keys on and the rubric's own `name` field
  (sliced from the grader name), which also flows into the hashed prompt text — this is
  effectively a brand-new grader identity, not an edit to the existing one.
- **Switching `JUDGE_MODEL`** (or passing a different `--judge-model` to `compare` or
  `calibrate`) does the same thing from the other side: a calibration is a statement
  about one specific model's behavior against one specific rubric, and swapping either
  half invalidates the trust earned for the pairing, even though only one side actually
  changed.

**A known, accepted gap, not silently patched (see `docs/DECISIONS.md`):** the gate
checks the rubric hash in the suite config *you hand it right now* against stored
calibrations — it does not check what rubric hash actually produced a given run's
*historical* grades, because the `grades` table (§4's schema, followed verbatim) only
records `judge_model`, not a prompt hash. In the normal `llmreg run` → `llmreg compare`
sequence (what CI does on every PR) this never surfaces, because both runs are always
freshly graded under whatever rubric is current at run time. It's a real gap only if
you hold onto old run IDs, edit the rubric, and compare those old runs afterward — the
gate will judge them against today's rubric hash, which has nothing to do with the
rubric that actually produced their stored grades.

## 4. Reading the confusion matrix and the bias note

The four cells (`ConfusionMatrix` in `packages/core/src/judge/kappa.ts`, persisted as
`both_pass` / `human_pass_judge_fail` / `human_fail_judge_pass` / `both_fail` since
migration `0002_add_confusion_matrix.sql`) say more than the scalar kappa alone:

- **`humanPassJudgeFail`-heavy** — the judge is stricter than your labeler: it's
  failing outputs a human accepted. Operationally, this inflates apparent regressions
  and depresses apparent pass rates without a real quality problem behind it — a
  candidate change that's genuinely fine can look worse than it is because the judge's
  own bar moved, not because the model's output did.
- **`humanFailJudgePass`-heavy** — the judge is more lenient than your labeler: it's
  passing outputs a human rejected. This is the more dangerous direction for a
  regression-*detection* tool specifically: a too-lenient judge can let a real quality
  regression through as `no_detectable_difference`, because the judge simply didn't
  notice what a human would have flagged. Worth weighing this asymmetry explicitly
  rather than treating both directions of disagreement as equally concerning.

`computeBiasNote` (`packages/core/src/judge/calibration.ts`) is a different statistic
from the confusion matrix — it uses the continuous scores of **every** matched label
(not just the discordant pass/fail flips the matrix and kappa look at), and reports the
signed mean of `judgeScore − humanScore` across all of them, rounded to three decimal
places. Below `|0.01|` it reports "No systematic bias detected"; otherwise it reports
something like `"Judge scores average 0.300 higher than human scores across 47 matched
labels."` — the exact shape of finding §5.5 gives as its own example ("judge scores
refusals ~0.3 higher than humans").

**What to actually do with that number.** The correct response to a bias note is to
reword the rubric's `criteria` text so the judge's own definition of what a 0, 0.5, or
1 means on that dimension matches what your labeler is actually applying — not to
hand-adjust a threshold, and not to normalize the judge's scores after the fact.
Post-hoc normalization would fix the *number* without fixing whether the judge is
discriminating good from bad the way a human does, which is the entire thing kappa is
trying to verify. And per §3 above, editing the criteria text re-hashes the prompt and
forces a fresh calibration before the reworded rubric can be trusted — by design: the
tool has no way to know your edit actually closed the gap until you run the same
labeling process against it again. `computeBiasNote`'s own comment is explicit that it
reports one *overall* number, not a per-tag breakdown — a per-tag finding as specific
as "refusals" needs a caller with tag data to slice by tag on top of this; this
function is the floor, not the ceiling.

## 5. Walkthrough: calibrating `judge:helpfulness` on the support-agent suite

`examples/support-agent/suite.json` currently wires only the `latency` grader — its own
description says a `judge:helpfulness`-style grader is "the natural next addition,"
which makes it a concrete stand-in for the situation this document is written for:
adding your first `judge:*` grader to a suite that doesn't have one yet.

**Step 0 — add the grader to the suite config.** A `judge:*` entry needs a `config`
with `description` and `criteria` (§3's `rubricFromGraderConfig` reads exactly those
two fields):

```json
{
  "name": "judge:helpfulness",
  "weight": 2,
  "config": {
    "description": "Whether the response resolves the customer's actual request accurately and completely, given NovaVey's stated policies.",
    "criteria": "0: ignores or misunderstands the request, or states something false about policy.\n0.5: addresses the request but is incomplete, vague, or requires the customer to ask again.\n1: fully resolves the request or gives a clear, accurate next step, in a tone appropriate to the situation."
  }
}
```

**Step 1 — run the suite** so there's graded output to sample from:

```
llmreg run --suite examples/support-agent/suite.json \
           --dataset examples/support-agent/dataset.json \
           --label baseline \
           --system-prompt-file examples/support-agent/system-prompt.txt
```

This prints a run id. `judge:helpfulness` gets graded on every successful case
alongside `latency`, per §5's grading-is-unconditional rule (§2 above).

**Step 2 — calibrate against that run:**

```
llmreg calibrate --suite examples/support-agent/suite.json \
                  --run <runId> \
                  --grader judge:helpfulness \
                  --sample-size 100 \
                  --seed 1 \
                  --labeled-by <you>
```

This stratified-samples 100 of the run's successful outputs by exact tag-set (so, per
`examples/support-agent/README.md`'s own tag distribution, a heavily-represented
combination like `refunds`+`tone` gets proportionally more of the 100 slots than a
sparse sub-tag like `policy-bypass`, which has exactly one case in the whole suite),
then walks through each one interactively: the case's tags, the model's output, and a
prompt for your own 0–1 score. After the last one it prints the kappa, raw agreement,
confusion matrix, bias note, and a PASSED/FAILED line against the suite's
`thresholds.judgeKappaFloor` (`0.6` in this suite's config).

**Step 3 — only after a PASSED result** can `llmreg compare` use `judge:helpfulness`'s
scores toward a blocking verdict for this suite. Before that — or if the result comes
back FAILED — running `llmreg compare` against two runs of this suite either rejects
outright (no calibration at all: exit 2, §2 above) or runs with `judge:helpfulness`
advisory-only (a calibration exists but is below the floor: its weight is zeroed, the
comparison falls back on `latency` alone).

## 6. Honest limitations

- **Kappa validates the judge against your rubric, not against ground truth about the
  product.** Already stated in `STATISTICS.md` §7 and not repeated in depth here — a
  judge and a human labeler can agree with each other very well while both applying a
  rubric that doesn't actually capture what the feature should do. A high kappa says
  the measurement instrument agrees with itself across raters; it says nothing about
  whether the rubric measures the right thing.
- **Fewer than ~100 labels is explicitly discouraged, not enforced.** The `--sample-size`
  default is 100 and §5.5 recommends 100–300, but nothing in the code stops you from
  passing `--sample-size 10` and getting a kappa back anyway. This repo's own Phase 5
  verification ran the calibration pipeline against as few as **20 clearly-disclosed
  synthetic labels** — explicitly a smoke test of the mechanics (sampling, matching,
  persistence, the gate), not a real calibration, because a kappa computed on 20 points
  swings enormously on a couple of flipped labels and tells you almost nothing stable
  about the judge. Treat any sample size well below 100 the same way: fine for checking
  that the pipeline works, not a number to trust in production.
- **Labels attach to `output_hash`, not `case_id` — re-running a case orphans its old
  labels.** `matchLabelsToJudgeGrades` pairs strictly by output hash and never falls
  back to case id if nothing matches. Two consequences worth knowing before you invest
  hours labeling: (1) if a case's output changes for any reason — a different model, an
  edited system prompt, or genuine non-determinism upstream — the new output gets a new
  hash, and every label collected against the old output for that case stops
  contributing to kappa on the next calibration run (it stays in the `human_labels`
  table, it just no longer matches anything). (2) The interactive flow's own zero-match
  error message reflects this directly — "Label some outputs first (labels are
  collected above this error, so re-run to label more)" — a 0-match result usually
  means the run you're calibrating against produced different output than whatever was
  labeled before, not that anything is broken.
- **A real anchoring-bias hazard in the interactive labeling flow itself.**
  `collectLabelsInteractively` (`packages/cli/src/commands/calibrate.ts`) prints the
  judge's own score for a sampled output — `"(judge scored this output 0.8)"` —
  immediately before asking the human labeler for theirs. Showing one rater the other
  rater's answer before they give their own is a standard way to inflate measured
  agreement: the human's label is no longer independent of the judge's, which is
  exactly the independence assumption kappa needs (see `STATISTICS.md` §7) to mean what
  it claims to mean. This is in the shipped code as of this writing, not a hypothetical
  — a team running a real calibration should either consciously score before reading
  that line, or treat the resulting kappa as an optimistic upper bound rather than an
  unbiased estimate, until the CLI is changed to withhold the judge's score until after
  the human answers.
