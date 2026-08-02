-- Initial schema, mirroring .claude/commands/build-llm-regression-suite.md §4 verbatim.
-- Applied by hand rather than via `drizzle-kit push` for the first migration:
-- drizzle-kit push hit an npm-workspace module-resolution issue in the build
-- sandbox (couldn't locate drizzle-orm despite it being present in
-- packages/core/node_modules). This file is the source of truth either way —
-- keep it in sync with src/db/schema.ts if either changes.

create extension if not exists pgcrypto;

create table suites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  config      jsonb not null,
  created_at  timestamptz not null default now()
);

create table cases (
  id          uuid primary key default gen_random_uuid(),
  suite_id    uuid not null references suites(id) on delete cascade,
  external_id text not null,
  input       jsonb not null,
  expected    jsonb,
  tags        text[] not null default '{}',
  critical    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (suite_id, external_id)
);

create table variants (
  id           uuid primary key default gen_random_uuid(),
  suite_id     uuid not null references suites(id) on delete cascade,
  label        text not null,
  git_sha      text,
  git_ref      text,
  prompt_hash  text not null,
  model        text not null,
  temperature  numeric not null,
  config       jsonb not null,
  created_at   timestamptz not null default now()
);

create table runs (
  id             uuid primary key default gen_random_uuid(),
  suite_id       uuid not null references suites(id),
  variant_id     uuid not null references variants(id),
  trigger        text not null,
  pr_number      int,
  status         text not null,
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
  sample_index  int not null default 0,
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
  grader          text not null,
  score           numeric not null,
  passed          boolean not null,
  rationale       text,
  judge_model     text,
  judge_tokens    int,
  unique (case_result_id, grader)
);

create table human_labels (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases(id) on delete cascade,
  output_hash text not null,
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
  bias_note       text,
  passed          boolean not null,
  calibrated_at   timestamptz not null default now()
);

create table comparisons (
  id                  uuid primary key default gen_random_uuid(),
  suite_id            uuid not null references suites(id),
  baseline_run_id     uuid not null references runs(id),
  candidate_run_id    uuid not null references runs(id),
  paired_case_count   int not null,
  delta               numeric not null,
  ci_lower            numeric not null,
  ci_upper            numeric not null,
  p_value             numeric,
  test                text not null,
  bootstrap_iterations int,
  mde                 numeric not null,
  verdict             text not null,
  regressed_case_ids  uuid[] not null default '{}',
  fixed_case_ids      uuid[] not null default '{}',
  critical_regressed  int not null default 0,
  judge_calibration_id uuid references judge_calibrations(id),
  computed_at         timestamptz not null default now()
);

create table response_cache (
  cache_key    text primary key,
  model        text not null,
  output       text not null,
  latency_ms   int,
  input_tokens int,
  output_tokens int,
  created_at   timestamptz not null default now(),
  last_hit_at  timestamptz
);
