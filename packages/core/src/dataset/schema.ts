/**
 * Types for a suite's cases and config. See §4 of the spec (the `cases` and
 * `suites` tables) — these are the file-based, pre-database shapes that
 * `load.ts` validates and parses; Phase 3+ will insert them into the schema
 * in `../db/schema.ts`.
 */

export interface CaseMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Case {
  /** Stable, human-authored id, e.g. "refund-past-window-01". Unique within a suite. */
  externalId: string;
  input: {
    messages: CaseMessage[];
  };
  /** null when only graders apply (most cases) — a specific target value otherwise. */
  expected: unknown | null;
  tags: string[];
  critical: boolean;
  /**
   * Required (non-null, non-empty) iff `critical` is true. Per §5.6: a case
   * marked critical fails the whole check on its own, and that power has to
   * be earned with a written reason, not "important".
   */
  criticalReason: string | null;
}

export interface GraderConfig {
  /** e.g. "exact" | "contains" | "regex" | "json_schema" | "latency" | "judge:helpfulness" */
  name: string;
  weight?: number;
  config?: Record<string, unknown>;
}

export interface SuiteConfig {
  name: string;
  description?: string;
  graders: GraderConfig[];
  thresholds: {
    /** SIGNIFICANCE_ALPHA, in (0, 1). */
    significanceAlpha: number;
    /** mde_ceiling per §5.4 — above this, verdict is insufficient_data. */
    mdeCeiling: number;
    /** Paired-n floor per §5.6 — below this, verdict is insufficient_data. */
    minPairedN: number;
    /** JUDGE_KAPPA_FLOOR per §5.5, in (0, 1). */
    judgeKappaFloor: number;
  };
}
