/**
 * Pure calibration-gate logic per §5.5. Zero I/O — the main agent's
 * DB-coupled orchestration (packages/core/src/judge/persist.ts and the
 * `llmreg calibrate` CLI command) fetches the raw rows and calls these
 * functions; nothing here touches a database.
 */

export interface HumanLabelRecord {
  caseId: string;
  outputHash: string;
  score: number;
}

export interface JudgeGradeRecord {
  caseId: string;
  outputHash: string;
  score: number;
}

export interface MatchedLabel {
  caseId: string;
  outputHash: string;
  humanScore: number;
  judgeScore: number;
}

/**
 * Pairs human labels to judge grades by `outputHash`, never by `caseId`.
 * Per §5.5: "Labels attach to output_hash, not to case_id. A label means
 * 'this specific output deserves this score.' Attaching labels to cases
 * would silently reuse a human judgement about one output as ground truth
 * for a different output the next variant produced — which is how
 * calibration quietly becomes fiction." A label whose output_hash has no
 * matching judge grade (e.g. the case was re-run since the label was
 * collected, producing different output) is dropped from the result, not
 * matched by caseId as a fallback.
 */
export function matchLabelsToJudgeGrades(
  labels: readonly HumanLabelRecord[],
  judgeGrades: readonly JudgeGradeRecord[],
): MatchedLabel[] {
  const gradeByOutputHash = new Map<string, JudgeGradeRecord>();
  for (const grade of judgeGrades) {
    gradeByOutputHash.set(grade.outputHash, grade);
  }

  const matched: MatchedLabel[] = [];
  for (const label of labels) {
    const grade = gradeByOutputHash.get(label.outputHash);
    if (grade === undefined) {
      continue;
    }
    matched.push({
      caseId: label.caseId,
      outputHash: label.outputHash,
      humanScore: label.score,
      judgeScore: grade.score,
    });
  }
  return matched;
}

export interface CalibrationRecord {
  judgeModel: string;
  judgePromptHash: string;
  cohensKappa: number;
  labelCount: number;
  /** kappa >= JUDGE_KAPPA_FLOOR, already decided by whoever computed this record. */
  passed: boolean;
}

export type GateStatus =
  | { status: 'passing'; calibration: CalibrationRecord }
  | { status: 'failing'; calibration: CalibrationRecord }
  | { status: 'missing' };

/**
 * Finds a calibration matching the CURRENT (judgeModel, judgePromptHash)
 * exactly. Per §5.5: "Re-calibration is required when the judge model
 * changes or the judge prompt hash changes. Both are enforced: a
 * comparison whose judge configuration doesn't match a passing calibration
 * is rejected, not warned about." If no record matches current config —
 * whether because the judge was never calibrated, or because a previously
 * passing calibration has gone stale (model or prompt changed since) — the
 * result is 'missing' either way; this function does not distinguish
 * "never calibrated" from "stale," since both require the same action
 * (recalibrate) and the caller has no different behavior for the two.
 */
export function checkCalibrationGate(
  calibrations: readonly CalibrationRecord[],
  currentJudgeModel: string,
  currentJudgePromptHash: string,
): GateStatus {
  const match = calibrations.find(
    (c) => c.judgeModel === currentJudgeModel && c.judgePromptHash === currentJudgePromptHash,
  );
  if (match === undefined) {
    return { status: 'missing' };
  }
  return match.passed ? { status: 'passing', calibration: match } : { status: 'failing', calibration: match };
}

/**
 * Summarizes the direction of systematic disagreement between human and
 * judge scores, per §5.5's `bias_note`: "the direction of systematic
 * disagreement... 'judge scores refusals ~0.3 higher than humans' is the
 * kind of finding that changes a rubric." This computes the overall signed
 * mean difference; a per-tag breakdown (the "refusals" level of detail in
 * the example) needs tag data this pure function doesn't have — the
 * caller (which does have case tags) may compose a more specific note on
 * top of this if it wants to, this is the floor, not the ceiling.
 */
export function computeBiasNote(matched: readonly MatchedLabel[]): string {
  if (matched.length === 0) {
    return 'No matched labels to compute a bias direction from.';
  }
  const meanDiff = matched.reduce((sum, m) => sum + (m.judgeScore - m.humanScore), 0) / matched.length;
  const rounded = Math.abs(meanDiff).toFixed(3);
  if (Math.abs(meanDiff) < 0.01) {
    return `No systematic bias detected: judge scores average within 0.01 of human scores across ${matched.length} matched labels.`;
  }
  const direction = meanDiff > 0 ? 'higher' : 'lower';
  return `Judge scores average ${rounded} ${direction} than human scores across ${matched.length} matched labels.`;
}
