---
description: Build the LLM Regression Suite — paired evaluation with statistical significance, validated LLM judges, and a PR check that blocks real regressions without crying wolf
---

# /build-llm-regression-suite

Target repo: `NovaVey/LLM-Regression-Suite` — **confirm this matches the repo you actually created before running. If the name differs, this line is the only place it needs changing.**

## 0. Rules for this workflow

Read the whole file before writing any code.

1. One phase at a time. Exit criteria must pass before moving on.
2. Stop at every `CHECKPOINT`, report what you built, what you ran, and the actual output. Wait for a reply.
3. Keep `PROGRESS.md` current after each phase: files touched, decisions, open questions.
4. Maintain `docs/DECISIONS.md`. Whenever a real alternative was considered and rejected — a statistical test, a threshold, a judge design, a library — write one entry: the decision, the alternative, why it lost. Write it when the choice is made, never reconstructed later. `PROGRESS.md` records state and goes stale; `DECISIONS.md` records reasoning and stays true. On this project it carries extra weight: every statistical choice here will be questioned by someone technical, and "we picked the paired test because outputs on the same input are correlated" is an answer where "it seemed standard" is not.
5. Never invent an API key, model ID, or connection string. Ask.
6. Ask before adding a dependency outside §2.
7. Commit per phase: `feat(phase-N): <summary>`. Never commit `.env`.
8. Windows is the dev environment. One command per line, no `&&` chaining, forward slashes in code.
9. **Every statistical claim this tool makes must be verified against a simulation where the true answer is known.** Phase 6 exists entirely for this. A tool that reports significance without having been checked for false positive rate is worse than no tool, because it launders noise into confidence.
10. **This tool never says a change is good.** It says a change is worse, or that it cannot detect a difference. Framing matters and is enforced in copy — see §5.6.
11. **Delegate to the four subagents per §14.** They exist because four parts of this build have different failure modes and benefit from separate context. The main agent owns scaffolding, the runner, graders, the judge flow, the CI action, docs, and **every CHECKPOINT** — checkpoints are reported to me directly and are never delegated.

## 1. What this is and why it's expert-tier

Every company that shipped an LLM feature has the same hole: someone edits a prompt or bumps a model version, something gets quietly worse, and they find out from a customer weeks later. There is no `npm test` for "the output is still good."

The commodity version of this is a script that runs 30 prompts and prints a pass rate. That is the version that gets teams into trouble, because a pass rate moving 94% → 91% on a small set is usually noise, and a team that ships on it — or blocks on it — learns to distrust the tool within a month.

The expert version is defined by what it refuses to say:

- **Paired comparison, not two independent runs.** Both variants see identical inputs, and the statistic is computed on per-case differences. Cases differ wildly in difficulty; unpaired comparison drowns the signal in that variance.
- **Confidence intervals on the delta, not just a point estimate.** The output is "−3.2pp, 95% CI [−5.8, −0.6]", never a bare "−3.2pp".
- **An explicit "cannot detect a difference" verdict** when the interval spans zero, plus the minimum effect the current dataset *could* have detected. A team that knows their 40-case set can't detect anything smaller than 8 points will go build a bigger set.
- **A validated judge.** LLM-as-judge scores are worthless until the judge has been checked against human labels and reported with an agreement statistic. An unvalidated judge is a second unmeasured model sitting in the measurement path.
- **Per-case diffs in the PR comment.** "8 of 240 cases regressed, here they are" is actionable. "Score down 3.2%" is not.

**Honest positioning, and it goes in the README.** promptfoo, LangSmith, and Braintrust exist and are good. This is not a competitor to them and must not claim to be. What it demonstrates is the ability to build, integrate, and reason correctly about eval infrastructure for a specific feature — which is the actual consulting engagement. Overclaiming here is the fastest way to lose a technical buyer who already uses one of those tools.

**Non-goals:** not a general benchmarking harness, not a model leaderboard, not a training or fine-tuning tool, not an observability platform. It answers exactly one question: did this change make our thing worse.

## 2. Stack and prerequisites

- Node 20 LTS + TypeScript (strict)
- Postgres via `pg`, Drizzle migrations (Railway)
- Fastify for the API, React + Vite + Tailwind for the report UI
- Anthropic API for both the system-under-test examples and the judge
- Vitest
- **Statistics implemented in-repo**, not pulled from a library. Bootstrap resampling and McNemar's test are each under 40 lines, and writing them means they can be unit-tested against known distributions in Phase 6. A dependency you cannot verify is a liability in the one place this repo must be trustworthy. `DECISIONS.md` records this choice.
- `commander` for the CLI, `@actions/core` only if a composite action is needed
- GitHub Actions for CI; the PR comment is posted with the built-in `GITHUB_TOKEN`

Env (`.env.example` committed):

```
DATABASE_URL=
ANTHROPIC_API_KEY=
TARGET_MODEL=claude-sonnet-5
JUDGE_MODEL=claude-opus-5
TARGET_TEMPERATURE=0.0
JUDGE_TEMPERATURE=0.0
BOOTSTRAP_ITERATIONS=10000
SIGNIFICANCE_ALPHA=0.05
JUDGE_KAPPA_FLOOR=0.6
MAX_CONCURRENCY=8
```

**On models:** pin both. The target model is what the client's feature runs on; the judge is a separate, generally stronger model. **The judge must not be the same model as the target** — a model scoring its own outputs favours its own style, and the resulting bias is invisible in the numbers. `DECISIONS.md` entry required.

**On temperature — note this is the opposite of the extraction pipeline.** There, sampling variance *was* the signal. Here it is contamination: run-to-run variance inflates the paired difference and manufactures false regressions. Target and judge both run at temperature 0. Where the target feature is legitimately non-deterministic, §5.3 handles it with repeated sampling, not by raising temperature and hoping.

**On billing:** the Anthropic API bills separately from a Claude subscription. Put credit on the key and set a spend limit before Phase 3. A 240-case run at 2 variants × 1 judge call each is roughly 720 calls; the response cache in §5.7 is what keeps iteration affordable.

## 3. Repo layout

```
/packages
  /core
    /src
      /dataset     load.ts, schema.ts, split.ts
      /runner      execute.ts, cache.ts, concurrency.ts
      /graders     exact.ts, contains.ts, regex.ts, json.ts, latency.ts, judge.ts, registry.ts
      /stats       bootstrap.ts, mcnemar.ts, mde.ts, verdict.ts
      /judge       prompt.ts, calibration.ts, kappa.ts
      /report      markdown.ts, json.ts, diff.ts
      /db          schema.ts, migrations/, client.ts
    /test
  /cli             index.ts, commands/
  /api             routes/, server.ts
  /web             src/pages/, src/components/
/action            action.yml, dist/
/examples
  /support-agent   the demo suite: dataset, config, two prompt variants
/simulations       null-model.ts, power-curve.ts, judge-drift.ts
/docs              ARCHITECTURE.md, STATISTICS.md, JUDGES.md, DECISIONS.md, DELIVERY.md
/.github/workflows ci.yml, regression.yml
/.claude
  /agents          statistician.md, test-author.md, dataset-curator.md, report-designer.md
  /commands        build-llm-regression-suite.md
PROGRESS.md
README.md
```

## 4. Data model

```sql
create table suites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  config      jsonb not null,          -- graders, weights, thresholds, models
  created_at  timestamptz not null default now()
);

create table cases (
  id          uuid primary key default gen_random_uuid(),
  suite_id    uuid not null references suites(id) on delete cascade,
  external_id text not null,           -- stable, human-authored: "refund-past-window"
  input       jsonb not null,
  expected    jsonb,                   -- null when only graders apply
  tags        text[] not null default '{}',
  -- Cases the team decided are the hard ones. Reported separately: a change
  -- that regresses only critical cases can be invisible in the overall number.
  critical    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (suite_id, external_id)
);

create table variants (
  id           uuid primary key default gen_random_uuid(),
  suite_id     uuid not null references suites(id) on delete cascade,
  label        text not null,           -- "baseline" | "candidate" | a git sha
  git_sha      text,
  git_ref      text,
  prompt_hash  text not null,           -- hash of the resolved prompt template
  model        text not null,
  temperature  numeric not null,
  config       jsonb not null,
  created_at   timestamptz not null default now()
);

create table runs (
  id             uuid primary key default gen_random_uuid(),
  suite_id       uuid not null references suites(id),
  variant_id     uuid not null references variants(id),
  trigger        text not null,          -- cli|ci|api
  pr_number      int,
  status         text not null,          -- running|complete|failed
  case_count     int not null,
  cache_hits     int not null default 0,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  error          text
);

create table case_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references runs(id) on delete cascade,
  case_id       uuid not null references cases(id),
  sample_index  int not null default 0,   -- >0 when repeat-sampling per 5.3
  output        text,
  latency_ms    int,
  error         text,
  from_cache    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (run_id, case_id, sample_index)
);

create table grades (
  id              uuid primary key default gen_random_uuid(),
  case_result_id  uuid not null references case_results(id) on delete cascade,
  grader          text not null,          -- exact|contains|regex|json_schema|latency|judge:<name>
  score           numeric not null,       -- 0..1
  passed          boolean not null,
  rationale       text,                   -- judge only
  judge_model     text,
  judge_tokens    int,
  unique (case_result_id, grader)
);

-- Human labels, the ground truth a judge is validated against. See 5.5.
create table human_labels (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases(id) on delete cascade,
  output_hash text not null,              -- labels attach to an OUTPUT, not a case
  grader      text not null,
  score       numeric not null,
  labeled_by  text not null,
  labeled_at  timestamptz not null default now(),
  unique (case_id, output_hash, grader, labeled_by)
);

create table judge_calibrations (
  id              uuid primary key default gen_random_uuid(),
  suite_id        uuid not null references suites(id),
  grader          text not null,
  judge_model     text not null,
  judge_prompt_hash text not null,
  label_count     int not null,
  cohens_kappa    numeric not null,
  agreement_rate  numeric not null,
  -- systematic direction of disagreement, e.g. judge scores 0.3 high on refusals
  bias_note       text,
  passed          boolean not null,        -- kappa >= JUDGE_KAPPA_FLOOR
  calibrated_at   timestamptz not null default now()
);

create table comparisons (
  id                  uuid primary key default gen_random_uuid(),
  suite_id            uuid not null references suites(id),
  baseline_run_id     uuid not null references runs(id),
  candidate_run_id    uuid not null references runs(id),
  paired_case_count   int not null,        -- cases present and valid in BOTH runs
  -- point estimate and interval, in the metric's own units
  delta               numeric not null,
  ci_lower            numeric not null,
  ci_upper            numeric not null,
  p_value             numeric,
  test                text not null,       -- paired_bootstrap|mcnemar
  bootstrap_iterations int,
  mde                 numeric not null,    -- min detectable effect at this n
  verdict             text not null,       -- regression|no_detectable_difference|improvement_detected|insufficient_data
  regressed_case_ids  uuid[] not null default '{}',
  fixed_case_ids      uuid[] not null default '{}',
  critical_regressed  int not null default 0,
  judge_calibration_id uuid references judge_calibrations(id),
  computed_at         timestamptz not null default now()
);

-- Cached model responses, keyed so a prompt edit invalidates and nothing else does.
create table response_cache (
  cache_key    text primary key,          -- sha256(model|temp|prompt_hash|input|sample_index)
  model        text not null,
  output       text not null,
  latency_ms   int,
  input_tokens int,
  output_tokens int,
  created_at   timestamptz not null default now(),
  last_hit_at  timestamptz
);
```

## 5. Core mechanics — the parts that make this expert work

Each gets a plain-language section in `docs/STATISTICS.md` or `docs/JUDGES.md`, and each is backed by a simulation in Phase 6.

**5.1 Comparison is paired, always.** Both variants run every case in the dataset, and the statistic is computed on the per-case difference `d_i = score_candidate(i) − score_baseline(i)`. Cases vary enormously in difficulty, and that between-case variance is usually far larger than the effect being measured — an unpaired comparison of two means buries a real 4-point regression under it. Pairing removes case difficulty from the variance entirely, because each case is compared to itself.

Only cases with a valid result in **both** runs enter the comparison. A case that errored on one side is excluded from the statistic and reported separately as an error, never silently scored zero — scoring an infrastructure timeout as a quality failure is how a flaky network becomes a "regression."

**5.2 The interval is the output, not the point estimate.** Report the delta with a 95% percentile bootstrap CI: resample the vector of per-case differences with replacement `BOOTSTRAP_ITERATIONS` times, recompute the mean each time, take the 2.5th and 97.5th percentiles. Bootstrap rather than a t-test because LLM score distributions are routinely skewed or bimodal — judge scores pile up at the top of the scale, pass/fail is binary — and the normality assumption a t-test needs does not hold. The bootstrap makes no distributional assumption at all.

For binary pass/fail metrics, also report **McNemar's test**, which is the correct paired test for dichotomous outcomes: it looks only at the discordant pairs — cases that passed before and fail now, versus fail before and pass now — and ignores the cases that agree. Concordant pairs carry no information about change and including them only dilutes the signal.

**5.3 Repeat sampling for non-deterministic targets.** Temperature 0 is the default and the strong preference. When the system under test is genuinely non-deterministic — tool use, retrieval, an upstream service — run each case `k` times (default 3), average the per-case scores, and pair on the averaged score. Variance from resampling is then inside the per-case measurement rather than masquerading as a between-variant difference. Record `sample_index` so the raw runs stay inspectable. Never raise temperature to "get more coverage"; that is adding noise to a measurement instrument.

**5.4 Minimum detectable effect, reported every time.** Before showing any verdict, compute and display the MDE: the smallest true difference this dataset size could reliably detect. Derive it from the observed per-case difference standard deviation and n.

This is the single most useful number in the report and almost nothing in this space shows it. A team looking at "no detectable difference (MDE: 7.4pp)" learns something they can act on — their 40-case suite is too small to catch anything but a catastrophe. A team looking at "no significant difference" learns nothing and quietly concludes the change is safe.

When MDE exceeds a configured `mde_ceiling`, the verdict is `insufficient_data`, not `no_detectable_difference`. Those are different findings and conflating them is the core failure this tool exists to avoid.

**5.5 A judge is not trusted until it is validated, and validation attaches to outputs.** Any `judge:*` grader requires a calibration before its scores may drive a verdict.

Calibration procedure:
- Sample 100–300 real outputs from the suite, stratified across score range and tags
- A human labels them with the same rubric the judge receives
- Compute **Cohen's kappa** between human and judge, plus raw agreement
- Kappa below `JUDGE_KAPPA_FLOOR` (default 0.6) → the judge is `passed = false` and **the CI check reports its scores as advisory only, never as a blocking verdict**
- Record the direction of systematic disagreement in `bias_note` — "judge scores refusals ~0.3 higher than humans" is the kind of finding that changes a rubric

Raw agreement alone is not enough: on a task where 90% of cases pass, a judge that says "pass" unconditionally scores 90% agreement and knows nothing. Kappa corrects for agreement expected by chance, which is exactly the failure mode here.

Labels attach to `output_hash`, not to `case_id`. A label means "this specific output deserves this score." Attaching labels to cases would silently reuse a human judgement about one output as ground truth for a different output the next variant produced — which is how calibration quietly becomes fiction.

Re-calibration is required when the judge model changes or the judge prompt hash changes. Both are enforced: a comparison whose judge configuration doesn't match a passing calibration is rejected, not warned about.

**5.6 Verdicts are asymmetric, deliberately.** Four verdicts, and the wording is part of the design:

| Verdict | Condition | CI behaviour |
|---|---|---|
| `regression` | CI upper bound below zero (candidate worse), or any critical case regressed | **fail the check** |
| `no_detectable_difference` | CI spans zero, MDE within ceiling | pass, report MDE |
| `improvement_detected` | CI lower bound above zero | pass, worded as detected-not-proven |
| `insufficient_data` | MDE above ceiling, or paired n below floor | pass with a warning, never a block |

The tool never certifies a change as good. It detects harm, or reports that it cannot detect a difference. This is not pedantry — a tool that says "improved!" on a noisy 40-case suite trains a team to ship on noise, and the first time that backfires in production the tool gets deleted. The narrower claim is the one that survives contact with a skeptical engineer.

Any critical-tagged case regressing fails the check regardless of the aggregate statistic. A change that fixes twenty easy cases and breaks the one about refund eligibility is a bad change, and no aggregate will tell you that.

**5.7 The cache is keyed so that only relevant edits invalidate.** `sha256(model | temperature | prompt_hash | serialized_input | sample_index)`. Re-running an unchanged baseline against a changed candidate hits cache on every baseline case — which makes the common CI path cost roughly half of naive, and makes local iteration nearly free. Cache is opt-out per run (`--no-cache`) and reports hit rate in the run summary, because a silently-stale cache would be the worst possible bug in a tool whose entire job is detecting change.

**5.8 The PR comment is the product.** It is not a link to a dashboard. It contains, in order:

1. One-line verdict with the delta and its CI
2. `n` paired cases, MDE, judge calibration status (kappa, or a loud warning if uncalibrated)
3. Regressed cases table: case id, baseline score, candidate score, and the truncated diff of the two outputs
4. Fixed cases, collapsed
5. A collapsed methods block: which test, iterations, models, prompt hashes, cache hit rate

Someone skimming on their phone must be able to tell whether to worry from the first line alone. The comment updates in place on new commits rather than posting again — twelve stacked bot comments is how a bot gets muted.

**5.9 The check fails loudly, never silently.** If the API is unreachable, the judge is uncalibrated, or too few cases paired — the check fails or warns with a specific reason. It never passes by default because something went wrong upstream. A green check that means "we didn't actually measure anything" is worse than a red one.

## 6. Statistical validation — Phase 6, and the reason the repo is credible

Everything above is a claim. This phase turns the claims into evidence, using simulations where the ground truth is known by construction.

**6.1 Null model — false positive rate.** Generate two variants with *identical* behaviour, run the full comparison 1,000 times on resampled synthetic scores, count how often the verdict is `regression`. At `SIGNIFICANCE_ALPHA = 0.05` the observed rate must land near 5% — and materially above that means the implementation is manufacturing regressions from noise, which is the exact failure this tool exists to prevent. This simulation is the single most important artifact in the repo.

**6.2 Power curve.** Inject known regressions of 1, 2, 5, 10, 20 points across dataset sizes of 20, 50, 100, 250, 500 cases. Output a grid of detection rates. This grid goes in the README, and it is what turns "you need a bigger dataset" from an assertion into a number a client can plan around.

**6.3 MDE validation.** The MDE the tool reports must match the effect size the power curve actually detects at ~80% rate. If the reported MDE says 5 points but the power curve shows 50% detection at 5 points, the MDE formula is wrong. Assert this in a test.

**6.4 Judge drift.** Take a calibrated judge, perturb the rubric wording, re-run calibration, show kappa moving. Demonstrates that calibration is a live constraint rather than a one-time formality.

**6.5 Pairing benefit.** Run the same injected regression through paired and unpaired analysis at the same n. The paired version detects it; the unpaired version often does not. One chart, and it justifies §5.1 to anyone who asks why this is more complex than comparing two averages.

## 7. CLI and CI surface

```
llmreg init                          scaffold a suite config + example dataset
llmreg run --variant candidate       run one variant, cache-aware
llmreg compare --baseline <ref> --candidate <ref>
                                     paired comparison, writes a comparison row
llmreg calibrate --grader judge:helpfulness
                                     interactive labeling session, computes kappa
llmreg report --comparison <id> --format markdown|json|html
llmreg simulate null|power|mde       run the Phase 6 validations
llmreg serve                         API + report UI
```

Exit codes: `0` pass, `1` regression, `2` insufficient data or uncalibrated judge (warn-level, configurable to block), `3` infrastructure failure. CI distinguishes all four.

GitHub Action (`/action/action.yml`), used as:

```yaml
- uses: NovaVey/LLM-Regression-Suite@v1
  with:
    suite: examples/support-agent
    baseline: ${{ github.event.pull_request.base.sha }}
    candidate: ${{ github.sha }}
    fail-on: regression
```

## 8. Screens

Design direction — **lab notebook, not dashboard.** The reader is deciding whether to trust a number. Everything must look measured rather than marketed.

- Palette: paper `#FAFAF8`, ink `#16181D`, rule `#DCDDD8`, one alert `#A23B2C`, one settled `#2C5F4F`, one muted `#7A7E85` for anything not significant. **Non-significant results are rendered in muted grey, never in the alert color** — the visual weight must match the statistical weight, and a grey "−3.2pp (n.s.)" teaches the right instinct in a way a caption never will.
- Type: a text face for prose, monospace with tabular figures for every number, interval, and hash. Intervals always render as `−3.2pp [−5.8, −0.6]` — the brackets are never dropped, anywhere, including the PR comment.
- Structure: hairline rules, no cards, dense tables. The comparison view reads top to bottom as verdict → evidence → cases → methods.
- Signature element: **the interval bar.** A horizontal rule with zero marked, the CI drawn as a span, the point estimate as a tick. When the span crosses zero it renders grey and unbolded. One glance conveys direction, magnitude, and certainty together, which is precisely what a bare percentage cannot do. This is what goes in the README screenshot.
- Copy: "No detectable difference. This suite can detect changes of 7.4 points or larger." Never "no significant change" alone. Errors name the fix.
- Quality floor: focus visible, responsive, `prefers-reduced-motion` respected, tables keyboard-navigable.

Screens:

1. **Suites** — cases, last run, judge calibration status and age.
2. **Comparison** — the signature screen: verdict, interval bar, MDE, paired n, methods.
3. **Case diff** — baseline and candidate output side by side, per-grader scores, judge rationale.
4. **Calibration** — kappa over time per judge, confusion matrix against human labels, bias note.
5. **Dataset** — cases, tags, critical flags, coverage gaps by tag.
6. **Simulations** — null model rate, power curve grid, MDE validation.

## 9. Phases

### Phase 0 — Scaffold
Monorepo (packages/core, cli, api, web), TS strict, Vitest, Drizzle, Fastify, `.env.example`, `PROGRESS.md`, `DECISIONS.md` seeded with the model-separation and in-repo-statistics decisions.
Exit: `llmreg --help` runs; health check reports db + Anthropic reachable and prints both pinned model IDs.
**CHECKPOINT: confirm Railway DB, API key with credit and a spend limit, and both model IDs.**

### Phase 1 — Statistics core, before anything else
`bootstrap.ts`, `mcnemar.ts`, `mde.ts`, `verdict.ts`. Pure functions over number arrays, zero I/O, no database, no API.
Building this first is deliberate: it is the part that must be right, and it is far easier to test in isolation than after it is entangled with a runner. Unit tests against distributions with known answers — a bootstrap CI on a known normal sample must recover the analytic interval; McNemar against a worked textbook example.
Exit: statistics module fully unit-tested with no dependency on the rest of the repo.
**CHECKPOINT: show me the bootstrap CI recovering a known interval and McNemar matching a hand-computed example.**

### Phase 2 — Dataset + suite config
Schema, loaders, YAML/JSON suite config with graders and thresholds, tags, critical flags. `llmreg init`.
Exit: the example support-agent suite loads with 240 cases; validation rejects a malformed config with a specific message.

### Phase 3 — Runner + cache + deterministic graders
Concurrent execution with `MAX_CONCURRENCY`, response cache per §5.7, retries with backoff, error isolation per case. Graders: exact, contains, regex, json_schema, latency.
Exit: full suite runs against the target model; second identical run is ~100% cache hits; a single case erroring does not fail the run and is reported as an error, not a zero.

### Phase 4 — Comparison engine
Pairing per §5.1, exclusion of unpaired cases, bootstrap and McNemar wired to the Phase 1 module, MDE, verdict logic per §5.6, critical-case override.
Exit: comparing a run against itself yields `no_detectable_difference` with a delta of exactly 0 and an interval containing 0; comparing against a deliberately broken variant yields `regression` with the right case list.

### Phase 5 — Judge grader + calibration
Judge prompt with an explicit rubric and required rationale, `llmreg calibrate` labeling flow, Cohen's kappa, bias note capture, calibration gate enforced in the comparison engine.
Exit: an uncalibrated judge cannot produce a blocking verdict; kappa computed against ≥100 labels on the example suite; changing the judge prompt invalidates the calibration.
**CHECKPOINT: show me the kappa, the confusion matrix, and what happens when I try to compare with a stale calibration.**

### Phase 6 — Simulations
All five validations from §6. Results stored and rendered.
Exit: null model false positive rate within tolerance of alpha; power curve grid generated; reported MDE matches ~80% detection on the curve; paired-vs-unpaired chart produced.
**CHECKPOINT: this is the credibility of the whole repo. Walk me through the null model result before we go further.**

### Phase 7 — Report + PR comment
Markdown, JSON, and HTML reporters. PR comment per §5.8 with in-place update. Exit codes per §7.
Exit: a comment rendered from a real comparison, readable on mobile, with working diffs.

### Phase 8 — GitHub Action
Composite action, inputs, `GITHUB_TOKEN` permissions, baseline resolution from the PR base sha, caching between runs.
Exit: a PR in this repo that edits the example prompt produces a real comment; a PR that edits the README produces no comparison run at all.
**CHECKPOINT: screenshot of the bot comment on a real PR. This is the demo.**

### Phase 9 — Report UI
All six screens per §8, interval bar component, case diff view.
Exit: every comparison inspectable in the browser; simulations page renders the Phase 6 outputs.

### Phase 10 — Example suite, docs, demo
`examples/support-agent`: 240 cases across tags (refunds, escalation, out-of-scope, tone, safety), 30 critical, two prompt variants where the candidate has a **real, deliberately introduced regression** on one tag and a genuine improvement on another. This is the honest demo — a change that is genuinely mixed, which is what real changes look like.
`docs/STATISTICS.md` explaining every test in plain language; `docs/JUDGES.md` on calibration; README per §11; 3-minute demo video ending on the PR comment.
Exit: a stranger clones, runs `llmreg simulate null` and `llmreg compare` on the example suite, and sees both in under 10 minutes.

## 10. Test plan

**Statistics (pure, fast)**
- `bootstrap-ci-recovers-a-known-analytic-interval`
- `bootstrap-handles-a-bimodal-distribution-without-assuming-normality`
- `mcnemar-matches-a-hand-computed-textbook-example`
- `mcnemar-ignores-concordant-pairs`
- `mde-matches-the-effect-size-detected-at-eighty-percent-power`
- `a-ci-spanning-zero-never-produces-a-regression-verdict`
- `an-mde-above-the-ceiling-produces-insufficient-data-not-no-difference`

**Comparison**
- `comparing-a-run-against-itself-reports-zero-delta`
- `a-case-that-errored-on-one-side-is-excluded-not-scored-zero`
- `only-cases-present-in-both-runs-enter-the-statistic`
- `a-single-critical-case-regressing-fails-the-check-despite-a-positive-aggregate`
- `pairing-detects-an-injected-regression-that-unpaired-analysis-misses`

**Judge**
- `an-uncalibrated-judge-cannot-produce-a-blocking-verdict`
- `kappa-is-near-zero-for-a-judge-that-always-says-pass-on-a-ninety-percent-pass-set`
- `changing-the-judge-prompt-invalidates-the-calibration`
- `human-labels-attach-to-outputs-not-cases`

**Runner**
- `an-identical-rerun-is-served-entirely-from-cache`
- `editing-the-prompt-invalidates-exactly-the-affected-cache-entries`
- `one-failing-case-does-not-abort-the-run`
- `repeat-sampling-averages-per-case-before-pairing`

**CI**
- `a-regression-exits-one-and-an-infrastructure-failure-exits-three`
- `the-pr-comment-updates-in-place-instead-of-posting-twice`
- `an-unreachable-api-fails-the-check-rather-than-passing-it`

## 11. Definition of done

- [ ] Null model false positive rate within tolerance of `SIGNIFICANCE_ALPHA` across 1,000 trials
- [ ] Power curve grid generated and in the README
- [ ] Reported MDE validated against the power curve
- [ ] Every statistical function unit-tested against a known answer
- [ ] Judge calibrated on ≥100 human labels with kappa reported; uncalibrated judges cannot block
- [ ] Example suite of 240 cases with a genuinely mixed candidate variant
- [ ] Working GitHub Action producing a real PR comment in this repo
- [ ] `llmreg simulate null` runnable by a stranger in under 10 minutes from clone
- [ ] `DECISIONS.md` has an entry for every statistical and design choice
- [ ] README states plainly what this is not, and names the existing tools
- [ ] Public repo with the PR comment screenshot, the interval bar, and a 3-min demo

## 12. README requirements

Open with the failure, not the feature: someone edits a prompt, something gets worse, nobody finds out for three weeks. Then the PR comment screenshot — that image does more selling than any paragraph.

Then, immediately and before any feature list, the **null model result**: "Run against two identical variants 1,000 times, this reports a false regression 4.9% of the time at α=0.05." A tool that measures its own false positive rate is making a claim almost nothing else in this space makes, and putting it above the fold signals the whole posture of the repo.

Then the power curve grid. Then how the statistics work in plain language. Then the honest positioning paragraph naming promptfoo, LangSmith, and Braintrust and stating what this is not. Stack last.

Say plainly that you are not a statistician, and that every method used is standard and cited in `docs/STATISTICS.md`. Overclaiming statistical authority is the one thing that would sink this repo with the exact audience it's aimed at; being precise about what you did and why reads as far stronger than borrowed confidence.

## 13. Packaging this as a fixed-scope offer

`docs/DELIVERY.md`:

- **Deliverables:** an eval dataset built from your real traffic with your team's tags and critical cases, graders for your quality dimensions, judge calibrated against your team's labels with kappa reported, CI integration posting on every PR, the simulation suite run against your data so you know what your dataset can and cannot detect, handover session.
- **Timeline:** 2–3 weeks, of which week 1 is dataset construction and labeling with your team.
- **What I need from you:** 200+ real inputs (anonymized is fine), your current prompts, someone who can label 150 outputs over about 3 hours, and repo access for the CI integration.
- **Out of scope:** production observability, model fine-tuning, dataset labeling I do alone without your domain input (the labels ARE the product — outsourcing them defeats the purpose), and multi-model routing decisions.
- **Acceptance:** the suite runs on every PR, the null model reports a false positive rate within tolerance on your data, and the power curve tells your team exactly what size regression their dataset can catch.

The opener on a first call, small and free: ask what size regression their current eval could detect. Almost nobody knows, and most sets are far too small. Computing that one number from their existing data takes twenty minutes and reframes the whole conversation from "we have evals" to "we have evals that can't see anything under 15 points."

## 14. Subagents

Four subagents live in `.claude/agents/`. They exist because four parts of this build fail in different ways, and because each carries enough context to crowd out the rest if handled in one window.

| Agent | Owns | Why it's separate |
|---|---|---|
| `statistician` | Phase 1 stats core, Phase 4 comparison math, Phase 6 simulations | The correctness of the whole repo rests here. Needs a mindset of "prove it against a known answer," not "ship it." |
| `test-author` | The §10 test plan | Writes tests from the **spec**, without reading the implementation first. The mind that wrote the code writes tests that agree with its own mistakes. |
| `dataset-curator` | Phase 2 dataset structures, Phase 10 example suite | 240 realistic cases plus a genuinely mixed candidate variant is a large, self-contained authoring job that would otherwise dominate context. |
| `report-designer` | Phase 7 reporters and PR comment, Phase 9 report UI | The PR comment is the product. Presentation decisions here are load-bearing and deserve undivided attention against the §8 direction. |

**Delegation rules for the main agent:**

1. **Subagents cannot see this conversation or this file.** Every delegation prompt must include the absolute path to `.claude/commands/build-llm-regression-suite.md`, the phase being worked, and the specific section numbers that govern the task. A subagent invoked with "build the stats module" and nothing else will invent its own spec.
2. **Subagents cannot talk to each other.** If `test-author` needs an interface that `statistician` defined, the main agent carries it across. Sequence the work so that never becomes a loop.
3. **Never delegate a CHECKPOINT.** The main agent reports to me directly, with the subagent's actual output — not a summary of a summary.
4. **Review before accepting.** A subagent returns work; the main agent reads it against the phase exit criteria before committing. Delegation moves the work, not the responsibility.
5. **`test-author` runs after the spec exists, not after the implementation.** For Phase 1 in particular: the test for `bootstrap-ci-recovers-a-known-analytic-interval` is written from §5.2 and the known statistical answer, not from whatever `bootstrap.ts` happens to do.
6. **Record delegations in `PROGRESS.md`** — which agent did which phase, and anything the main agent had to correct. Corrections are the most useful line in that file.

**Anti-pattern to avoid:** do not delegate a whole phase and accept the result unread because it came back green. Two of the four agents here are specifically adversarial to the rest of the build (`test-author`, `statistician`); the value only materializes if their findings are allowed to be inconvenient.
