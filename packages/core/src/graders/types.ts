import type { Case } from '../dataset/schema.js';

export interface GraderContext {
  output: string;
  /** null when the case errored before producing output — a grader should never be called in that case, but the type stays honest. */
  latencyMs: number | null;
  caseData: Case;
  config?: Record<string, unknown>;
}

export interface GradeResult {
  /** 0..1 */
  score: number;
  passed: boolean;
  rationale?: string;
}

export type Grader = (ctx: GraderContext) => GradeResult;
