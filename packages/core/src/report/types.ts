/**
 * The data contract between `load.ts` (DB-coupled, this directory's only
 * impure file) and the pure renderers (`markdown.ts`, `json.ts`, `html.ts`).
 * Designed once, upfront, and handed identically to `report-designer`
 * (renderers) and built against directly here (loader) — same pattern as
 * every prior phase's interface contract.
 */

export interface RegressedCaseRow {
  externalId: string;
  critical: boolean;
  baselineScore: number;
  candidateScore: number;
  baselineOutput: string;
  candidateOutput: string;
}

export interface FixedCaseRow {
  externalId: string;
  baselineScore: number;
  candidateScore: number;
}

export interface JudgeCalibrationStatus {
  grader: string;
  status: 'passing' | 'failing';
  cohensKappa: number;
  labelCount: number;
}

export interface MethodsInfo {
  test: 'paired_bootstrap' | 'mcnemar';
  bootstrapIterations: number | null;
  baselineLabel: string;
  candidateLabel: string;
  baselineModel: string;
  candidateModel: string;
  baselinePromptHash: string;
  candidatePromptHash: string;
  baselineCacheHitRate: number;
  candidateCacheHitRate: number;
}

export type Verdict = 'regression' | 'no_detectable_difference' | 'improvement_detected' | 'insufficient_data';

export interface ComparisonReportData {
  comparisonId: string;
  suiteName: string;
  verdict: Verdict;
  delta: number;
  ciLower: number;
  ciUpper: number;
  mde: number;
  /** The suite's configured mde_ceiling (§5.4/§5.6) -- needed to say, for an insufficient_data verdict, whether MDE-above-ceiling or paired-n-below-floor was the actual cause. */
  mdeCeiling: number;
  pairedCaseCount: number;
  /** The suite's configured minPairedN floor (§5.6) -- see mdeCeiling above. */
  minPairedN: number;
  excludedCount: number;
  criticalRegressed: number;
  regressedCases: RegressedCaseRow[];
  fixedCases: FixedCaseRow[];
  judgeCalibrations: JudgeCalibrationStatus[];
  methods: MethodsInfo;
  computedAt: string;
}
