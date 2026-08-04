/**
 * The data contract for Phase 9's Report UI (§8's six screens), between
 * `load.ts` (DB-coupled, this directory's only impure file) and the React
 * screens in packages/web (report-designer's territory) via packages/api's
 * HTTP layer. Same pattern as report/types.ts (Phase 7): designed once,
 * upfront, handed identically to whoever builds each side.
 *
 * These are HTTP response shapes, not database rows -- dates are ISO
 * strings (JSON has no Date), numeric Postgres columns are already
 * converted to `number`, and nothing here leaks a Drizzle type.
 */

import type { Verdict } from '../report/types.js';
import type { NullModelResult } from '../simulations/null-model.js';
import type { PowerCurveResult } from '../simulations/power-curve.js';
import type { PairingBenefitResult } from '../simulations/pairing-benefit.js';
import type { MdeValidationResult } from '../simulations/mde-validation.js';

export type { Verdict };

// --- Screen 1: Suites ---

export interface SuiteCalibrationSummary {
  grader: string;
  status: 'passing' | 'failing' | 'missing';
  cohensKappa: number | null;
  calibratedAt: string | null;
  /** Age of the most recent calibration in days, null if never calibrated. */
  ageDays: number | null;
}

export interface SuiteListItem {
  id: string;
  name: string;
  description: string | null;
  caseCount: number;
  lastRun: {
    id: string;
    trigger: 'cli' | 'ci' | 'api';
    status: string;
    finishedAt: string | null;
  } | null;
  calibrations: SuiteCalibrationSummary[];
}

// --- Screen 2: Comparison ---
// Reuses report/types.ts's ComparisonReportData directly -- the signature
// screen shows exactly what the PR comment shows, same verdict/interval/
// MDE/paired-n/methods, just interactive instead of static markdown.

export interface ComparisonListItem {
  id: string;
  verdict: Verdict;
  delta: number;
  ciLower: number;
  ciUpper: number;
  pairedCaseCount: number;
  baselineLabel: string;
  candidateLabel: string;
  computedAt: string;
}

// --- Screen 3: Case diff ---

export type CaseComparisonStatus = 'regressed' | 'fixed' | 'unchanged' | 'excluded';

export interface ComparisonCaseListItem {
  externalId: string;
  critical: boolean;
  tags: string[];
  status: CaseComparisonStatus;
  /** null for excluded cases -- one or both sides had no usable score. */
  baselineScore: number | null;
  candidateScore: number | null;
  /** Present only when status is 'excluded'. */
  exclusionReason: string | null;
}

export interface CaseGradeDetail {
  grader: string;
  score: number;
  passed: boolean;
  rationale: string | null;
  judgeModel: string | null;
}

export interface CaseDiffData {
  externalId: string;
  critical: boolean;
  criticalReason: string | null;
  tags: string[];
  inputMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  baselineOutput: string | null;
  baselineError: string | null;
  baselineGrades: CaseGradeDetail[];
  candidateOutput: string | null;
  candidateError: string | null;
  candidateGrades: CaseGradeDetail[];
}

// --- Screen 4: Calibration ---

export interface CalibrationHistoryEntry {
  id: string;
  judgeModel: string;
  judgePromptHash: string;
  labelCount: number;
  cohensKappa: number;
  agreementRate: number;
  passed: boolean;
  biasNote: string | null;
  confusionMatrix: {
    bothPass: number;
    humanPassJudgeFail: number;
    humanFailJudgePass: number;
    bothFail: number;
  };
  calibratedAt: string;
}

export interface GraderCalibrationOverview {
  grader: string;
  /** Oldest first -- a time series, per §8's "kappa over time per judge." */
  history: CalibrationHistoryEntry[];
}

export interface CalibrationOverview {
  suiteId: string;
  suiteName: string;
  judgeKappaFloor: number;
  graders: GraderCalibrationOverview[];
}

// --- Screen 5: Dataset ---

export interface DatasetCaseRow {
  externalId: string;
  tags: string[];
  critical: boolean;
  criticalReason: string | null;
}

export interface TagCoverage {
  tag: string;
  caseCount: number;
  /** caseCount < the suite's minPairedN -- too few cases of this tag to trust a tag-specific regression finding, same floor §5.6 already applies to the overall comparison. */
  isGap: boolean;
}

export interface DatasetOverview {
  suiteId: string;
  suiteName: string;
  cases: DatasetCaseRow[];
  criticalCount: number;
  minPairedN: number;
  tagCoverage: TagCoverage[];
}

// --- Screen 6: Simulations ---
// Read directly from simulations/results/*.json (file-based, not DB --
// Phase 6 never persisted these to Postgres). Reuses the simulation
// modules' own Result types directly (this is parsed JSON written by
// exactly those types via `llmreg simulate`, per packages/cli/src/commands/
// simulate.ts) rather than redeclaring shapes that would silently drift.

export interface SimulationsOverview {
  /** Any of these may be null if that simulation's results file hasn't been generated yet (e.g. a fresh clone before `llmreg simulate` has run). */
  nullModel: NullModelResult | null;
  powerCurve: PowerCurveResult | null;
  pairingBenefit: PairingBenefitResult | null;
  mdeValidation: MdeValidationResult | null;
  /** True if simulations/results/pairing-benefit-chart.svg exists -- served separately as a static asset, not embedded in this JSON. */
  hasPairingBenefitChart: boolean;
}
