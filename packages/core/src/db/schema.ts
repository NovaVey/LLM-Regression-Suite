import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Schema mirrors the data model in .claude/commands/build-llm-regression-suite.md §4 verbatim.
// Column-by-column changes belong there first; this file follows, not leads.

export const suites = pgTable('suites', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cases = pgTable(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    suiteId: uuid('suite_id')
      .notNull()
      .references(() => suites.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    input: jsonb('input').notNull(),
    expected: jsonb('expected'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    // Cases the team decided are the hard ones. Reported separately: a change
    // that regresses only critical cases can be invisible in the overall number.
    critical: boolean('critical').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('cases_suite_id_external_id_key').on(table.suiteId, table.externalId)]
);

export const variants = pgTable('variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id')
    .notNull()
    .references(() => suites.id, { onDelete: 'cascade' }),
  label: text('label').notNull(), // "baseline" | "candidate" | a git sha
  gitSha: text('git_sha'),
  gitRef: text('git_ref'),
  promptHash: text('prompt_hash').notNull(), // hash of the resolved prompt template
  model: text('model').notNull(),
  temperature: numeric('temperature').notNull(),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id')
    .notNull()
    .references(() => suites.id),
  variantId: uuid('variant_id')
    .notNull()
    .references(() => variants.id),
  trigger: text('trigger').notNull(), // cli|ci|api
  prNumber: integer('pr_number'),
  status: text('status').notNull(), // running|complete|failed
  caseCount: integer('case_count').notNull(),
  cacheHits: integer('cache_hits').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

export const caseResults = pgTable(
  'case_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    sampleIndex: integer('sample_index').notNull().default(0), // >0 when repeat-sampling per §5.3
    output: text('output'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    fromCache: boolean('from_cache').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('case_results_run_id_case_id_sample_index_key').on(
      table.runId,
      table.caseId,
      table.sampleIndex
    ),
  ]
);

export const grades = pgTable(
  'grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseResultId: uuid('case_result_id')
      .notNull()
      .references(() => caseResults.id, { onDelete: 'cascade' }),
    grader: text('grader').notNull(), // exact|contains|regex|json_schema|latency|judge:<name>
    score: numeric('score').notNull(), // 0..1
    passed: boolean('passed').notNull(),
    rationale: text('rationale'), // judge only
    judgeModel: text('judge_model'),
    judgeTokens: integer('judge_tokens'),
  },
  (table) => [uniqueIndex('grades_case_result_id_grader_key').on(table.caseResultId, table.grader)]
);

// Human labels, the ground truth a judge is validated against. See §5.5.
export const humanLabels = pgTable(
  'human_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    outputHash: text('output_hash').notNull(), // labels attach to an OUTPUT, not a case
    grader: text('grader').notNull(),
    score: numeric('score').notNull(),
    labeledBy: text('labeled_by').notNull(),
    labeledAt: timestamp('labeled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('human_labels_case_id_output_hash_grader_labeled_by_key').on(
      table.caseId,
      table.outputHash,
      table.grader,
      table.labeledBy
    ),
  ]
);

export const judgeCalibrations = pgTable('judge_calibrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id')
    .notNull()
    .references(() => suites.id),
  grader: text('grader').notNull(),
  judgeModel: text('judge_model').notNull(),
  judgePromptHash: text('judge_prompt_hash').notNull(),
  labelCount: integer('label_count').notNull(),
  cohensKappa: numeric('cohens_kappa').notNull(),
  agreementRate: numeric('agreement_rate').notNull(),
  // Systematic direction of disagreement, e.g. "judge scores 0.3 high on refusals".
  biasNote: text('bias_note'),
  passed: boolean('passed').notNull(), // kappa >= JUDGE_KAPPA_FLOOR
  calibratedAt: timestamp('calibrated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comparisons = pgTable('comparisons', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id')
    .notNull()
    .references(() => suites.id),
  baselineRunId: uuid('baseline_run_id')
    .notNull()
    .references(() => runs.id),
  candidateRunId: uuid('candidate_run_id')
    .notNull()
    .references(() => runs.id),
  pairedCaseCount: integer('paired_case_count').notNull(), // cases present and valid in BOTH runs
  // Point estimate and interval, in the metric's own units.
  delta: numeric('delta').notNull(),
  ciLower: numeric('ci_lower').notNull(),
  ciUpper: numeric('ci_upper').notNull(),
  pValue: numeric('p_value'),
  test: text('test').notNull(), // paired_bootstrap|mcnemar
  bootstrapIterations: integer('bootstrap_iterations'),
  mde: numeric('mde').notNull(), // min detectable effect at this n
  verdict: text('verdict').notNull(), // regression|no_detectable_difference|improvement_detected|insufficient_data
  regressedCaseIds: uuid('regressed_case_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  fixedCaseIds: uuid('fixed_case_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  criticalRegressed: integer('critical_regressed').notNull().default(0),
  // Added in migration 0001 (Phase 7): cases excluded from the statistic
  // (errored on one side, or missing entirely) -- computed at compare time
  // alongside pairedCaseCount/criticalRegressed, but not originally
  // persisted; the report layer needs it alongside those two.
  excludedCaseCount: integer('excluded_case_count').notNull().default(0),
  judgeCalibrationId: uuid('judge_calibration_id').references(() => judgeCalibrations.id),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cached model responses, keyed so a prompt edit invalidates and nothing else does.
export const responseCache = pgTable('response_cache', {
  cacheKey: text('cache_key').primaryKey(), // sha256(model|temp|prompt_hash|input|sample_index)
  model: text('model').notNull(),
  output: text('output').notNull(),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
});
