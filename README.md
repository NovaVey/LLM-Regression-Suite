# LLM Regression Suite

Someone edits a system prompt, or swaps a model, and something about the output quietly gets worse — a refusal that used to work now doesn't, a tone shift nobody asked for, an edge case that silently stopped resolving. Nothing crashes. No test fails. Three weeks later a support ticket traces it back to that PR. This tool exists to catch that in CI, before it ships.

It runs the baseline and candidate against the same paired dataset, computes a bootstrap confidence interval on the per-case difference (not two averages compared — see [why pairing matters](docs/STATISTICS.md#1-paired-comparison-not-two-independent-runs)), scores subjective quality with an LLM judge that has to earn trust against real human labels before it's allowed to block anything, and reports a verdict a skeptical engineer can act on: `regression`, `no_detectable_difference`, `improvement_detected`, or `insufficient_data` — never a bare "changed."

This is what shows up on the pull request, in place, on every push — a real comment from a real run against this repo's own example suite:

![A real PR comment: the verdict, the confidence interval, the evidence, and the methods behind the number](docs/images/pr-comment.png)

(This particular run found no detectable difference — the demo commit's edit didn't move the only grader wired at the time. See "Report UI" below for what a real regression looks like once you're past the CI comment and into the full report.)

## The null model result

Before trusting any of this, it has to measure its own false alarm rate. Run two variants with **identical** true behavior against each other, repeatedly, on data where nothing actually changed, and count how often the tool claims something did.

```
$ llmreg simulate null
Null model: 2000 trials, alpha=0.05
  regression rate (one-sided, blocks a PR):     2.35%  target ~2.50% (alpha/2)  within tolerance
  improvement rate (one-sided, symmetric tail): 2.65%
  combined rate (CI excluded zero at all):      5.00%  target ~5.00% (alpha)   within tolerance
```

Read this precisely, because the two numbers answer different questions and it would be easy to round them into one misleading claim:

- **The rate that actually blocks a PR** (`verdict: regression`, the only verdict that fails the check) is **2.35%** at `α = 0.05` — a `regression` verdict requires the *entire* confidence interval to sit on the harmful side, which is a one-sided read of a two-sided interval, and under a true null that lands at `α/2` by construction, not `α`.
- **The rate the interval moves away from zero at all**, in either direction (`regression` or `improvement_detected` combined), is **5.00%** — matching `α` exactly, exactly as standard two-sided confidence-interval theory predicts.

Both numbers are correct; they're just not the same claim. If you're asking "how often does this tool cry wolf on a PR," the answer is the smaller one. Full derivation, the two independent ways it was checked, and the reasoning for reporting both instead of picking one: [`docs/DECISIONS.md`](docs/DECISIONS.md#phase-6), [`docs/STATISTICS.md §8.2`](docs/STATISTICS.md).

## Power curve

The single most useful number this tool can give you isn't "significant" or "not significant" — it's how big a regression your dataset is even capable of seeing. A 40-case suite that reports "no detectable difference" on a real 8-point regression didn't tell you the change is safe; it told you the suite is blind under 20 points.

```
$ llmreg simulate power
Power curve (detection rate by effect size x sample size):

n\effect   1pt   2pt   5pt  10pt  20pt
n=20        3%    3%    7%    9%   29%
n=50        5%    5%   11%   19%   53%
n=100       5%    5%   13%   27%   85%
n=250       1%    6%   25%   62%  100%
n=500       7%    8%   44%   89%  100%
```

Reported minimum detectable effect (MDE) at ~80% power was checked against where this grid actually crosses 80% and agreed within a few points at every sample size tried (§8.4 of the statistics doc). And pairing isn't complexity for its own sake: on the same synthetic 8-point regression at n=100, the paired analysis this tool actually uses detected it 21.3% of the time; discarding the pairing and comparing two averages instead — the naive approach — detected it only 14.3% of the time, at the identical sample size.

![Paired detects the regression more often than unpaired, at the same sample size](simulations/results/pairing-benefit-chart.svg)

## Report UI

Every comparison is inspectable in the browser, not just the CI comment — six screens (suites, the comparison itself, a per-case diff, judge calibration history, dataset coverage, and the simulation results above). The signature element is the interval bar: a horizontal rule with zero marked, the confidence interval drawn as a span, the point estimate as a tick. Its color is driven **only** by whether the interval crosses zero, never by the verdict word next to it — so a critical-case override can correctly disagree with its own headline, exactly like it should:

![The Comparison screen: a bold-red "Regression" headline, but the interval bar beneath it renders muted and unbolded because its own confidence interval crosses zero — this regression comes from one critical case failing, not the aggregate trend, and the bar says so honestly instead of matching the headline's color](docs/images/comparison-screen.png)

`npm run dev` in `packages/api` and `packages/web` (two terminals) to run it locally against your own data.

## How the statistics work, briefly

- **Paired bootstrap confidence interval** on the per-case difference, not a comparison of two averages — cancels out case-to-case difficulty variance that would otherwise swamp a real effect.
- **McNemar's test** computed alongside every comparison as a discordant-pairs cross-check, never overriding the bootstrap verdict.
- **Cohen's kappa** validates any LLM judge against real human labels before its scores can drive a verdict — raw agreement alone is misleading (a judge that says "pass" unconditionally on a 90%-pass dataset looks 90% "accurate" and has learned nothing; kappa corrects for exactly that). The process side — running `llmreg calibrate`, reading a confusion matrix, when to re-calibrate — is in [`docs/JUDGES.md`](docs/JUDGES.md).
- Every verdict is deliberately asymmetric: this tool detects harm, or reports it cannot detect a difference. It never certifies a change as "good" — see [`docs/STATISTICS.md`](docs/STATISTICS.md) for why.

We are not statisticians by training. Every method above is standard, textbook material, implemented in-repo rather than pulled from a library so it can be read and verified line by line — see [`docs/STATISTICS.md`](docs/STATISTICS.md) for the full plain-language explanation of each one, and [`docs/DECISIONS.md`](docs/DECISIONS.md) for every real alternative that was considered and why it lost.

## What this is not

This is not an eval platform, a prompt-testing dashboard, or an LLM observability product — [promptfoo](https://promptfoo.dev), [LangSmith](https://www.langchain.com/langsmith), and [Braintrust](https://www.braintrust.dev) already do those well, and this tool assumes you might already use one of them for iteration. This is narrowly a **paired regression-detection check for CI**: given a baseline and a candidate, did anything measurably get worse, with a stated confidence interval and a stated false-alarm rate — not a place to browse traces, build prompts interactively, or manage a broader eval workflow.

## Quickstart

```bash
git clone https://github.com/NovaVey/LLM-Regression-Suite.git
cd LLM-Regression-Suite
npm install
npm run build

# No API key or database needed for this one -- pure synthetic validation:
node packages/cli/dist/index.js simulate null

# These need DATABASE_URL / ANTHROPIC_API_KEY in .env (see .env.example):
node packages/cli/dist/index.js migrate
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js run --suite examples/support-agent/suite.json --dataset examples/support-agent/dataset.json --label baseline
node packages/cli/dist/index.js run --suite examples/support-agent/suite.json --dataset examples/support-agent/dataset.json --label candidate
node packages/cli/dist/index.js compare --suite examples/support-agent/suite.json --baseline-run <id> --candidate-run <id>
node packages/cli/dist/index.js report --comparison <id> --format markdown

# judge:response-quality (examples/support-agent's grader) needs calibrating
# before it can drive a blocking verdict -- see docs/JUDGES.md:
node packages/cli/dist/index.js calibrate --suite examples/support-agent/suite.json --run <run-id> --grader judge:response-quality

# The Report UI, against the same database (two terminals):
cd packages/api && npm run dev    # http://localhost:3000
cd packages/web && npm run dev    # http://localhost:5173

# CI: drop .github/workflows/regression.yml + `uses: ./action` (see action/action.yml)
# into any repo that also carries this one's packages -- it posts the comment above
# on every PR that touches your suite.
```

## Status

Phases 0–9 are complete and tested (254 tests, `npx vitest run`): statistics core, dataset/suite config, the runner with caching and deterministic graders, the paired comparison engine, LLM-judge grading with kappa-gated calibration, the statistical validation above, the report/PR-comment layer, a working GitHub Action verified against real infrastructure (screenshot above), and the six-screen Report UI (screenshot above). Phase 10 is in progress: `examples/support-agent` now has a real, honestly-mixed baseline/candidate prompt pair (one genuine regression, one genuine improvement, on two different tags — see [the example suite's own README](examples/support-agent/README.md#baseline-vs-candidate)) and a `judge:response-quality` grader to detect them. That judge still needs a real calibration pass (≥100 human labels — see [`docs/JUDGES.md`](docs/JUDGES.md)) before a real PR against this pair produces a genuine `regression`/`improvement_detected` verdict end to end; `docs/STATISTICS.md`, `docs/JUDGES.md`, and this README are otherwise current. See [`PROGRESS.md`](PROGRESS.md) for exactly what's built and what's left.

## License

MIT — see [`LICENSE`](LICENSE).
