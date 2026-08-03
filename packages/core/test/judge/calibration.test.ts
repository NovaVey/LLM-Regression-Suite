// Written from spec §5.5 and §10's Judge bucket, plus the pure-function
// interface contract supplied for Phase 5, WITHOUT reading
// src/judge/calibration.ts.
//
// §5.5: "Labels attach to output_hash, not to case_id. A label means 'this
// specific output deserves this score.' Attaching labels to cases would
// silently reuse a human judgement about one output as ground truth for a
// different output the next variant produced -- which is how calibration
// quietly becomes fiction."
//
// §5.5: "Re-calibration is required when the judge model changes or the
// judge prompt hash changes. Both are enforced: a comparison whose judge
// configuration doesn't match a passing calibration is rejected, not warned
// about."
//
// Interface contract (given, not read from src):
//   interface HumanLabelRecord { caseId; outputHash; score }
//   interface JudgeGradeRecord { caseId; outputHash; score }
//   interface MatchedLabel { caseId; outputHash; humanScore; judgeScore }
//   function matchLabelsToJudgeGrades(labels, judgeGrades): MatchedLabel[]
//     -- pairs by outputHash; a label with no matching-outputHash judge
//     grade is dropped, not fuzzily matched by caseId.
//
//   interface CalibrationRecord { judgeModel; judgePromptHash; cohensKappa; labelCount; passed }
//   type GateStatus = { status: 'passing'; calibration } | { status: 'failing'; calibration } | { status: 'missing' }
//   function checkCalibrationGate(calibrations, currentJudgeModel, currentJudgePromptHash): GateStatus
//     -- finds a calibration matching CURRENT (judgeModel, judgePromptHash)
//     exactly; 'missing' if none match, regardless of how many non-matching
//     (stale) records exist.

import { describe, it, expect } from 'vitest';
import { matchLabelsToJudgeGrades, checkCalibrationGate } from '../../src/judge/calibration.js';
import type { HumanLabelRecord, JudgeGradeRecord, CalibrationRecord } from '../../src/judge/calibration.js';

describe('human-labels-attach-to-outputs-not-cases', () => {
  it('human-labels-attach-to-outputs-not-cases', () => {
    // Same case, two DIFFERENT outputs (as if the case was re-run and
    // produced a different response). A human label was collected against
    // the FIRST output. A judge grade exists only for the SECOND output.
    const label: HumanLabelRecord = { caseId: 'case-1', outputHash: 'hash-v1', score: 1 };
    const judgeGradeForNewerOutput: JudgeGradeRecord = { caseId: 'case-1', outputHash: 'hash-v2', score: 0.5 };

    // The label must NOT silently apply to the newer output just because
    // caseId matches -- there is no judge grade for hash-v1 at all here.
    const noMatch = matchLabelsToJudgeGrades([label], [judgeGradeForNewerOutput]);
    expect(noMatch).toEqual([]);

    // Now supply a judge grade for the SAME output_hash the label was
    // collected against. This -- and only this -- must pair.
    const judgeGradeForLabeledOutput: JudgeGradeRecord = { caseId: 'case-1', outputHash: 'hash-v1', score: 0.9 };
    const matched = matchLabelsToJudgeGrades(
      [label],
      [judgeGradeForNewerOutput, judgeGradeForLabeledOutput],
    );

    expect(matched).toEqual([
      { caseId: 'case-1', outputHash: 'hash-v1', humanScore: 1, judgeScore: 0.9 },
    ]);
  });

  it('a-label-with-no-matching-judge-grade-anywhere-is-dropped-not-fabricated', () => {
    // No judge grade at all for this output_hash (e.g. the case hasn't been
    // re-run under the current judge yet). Must be dropped from the result,
    // not paired with something else or reported as a zero/placeholder.
    const label: HumanLabelRecord = { caseId: 'case-9', outputHash: 'hash-orphan', score: 0.5 };
    const unrelatedGrade: JudgeGradeRecord = { caseId: 'case-9', outputHash: 'hash-different', score: 0.5 };

    const result = matchLabelsToJudgeGrades([label], [unrelatedGrade]);
    expect(result).toEqual([]);
  });
});

describe('changing-the-judge-prompt-invalidates-the-calibration', () => {
  it('changing-the-judge-prompt-invalidates-the-calibration', () => {
    const calibrations: CalibrationRecord[] = [
      { judgeModel: 'modelA', judgePromptHash: 'promptHashA', cohensKappa: 0.75, labelCount: 150, passed: true },
    ];

    // Control: unchanged config still finds the passing calibration.
    const control = checkCalibrationGate(calibrations, 'modelA', 'promptHashA');
    expect(control.status).toBe('passing');

    // Same model, DIFFERENT prompt hash -- calibration no longer applies.
    const changedPrompt = checkCalibrationGate(calibrations, 'modelA', 'promptHashB');
    expect(changedPrompt.status).toBe('missing');
    expect(changedPrompt.status).not.toBe('passing');

    // Same prompt hash, DIFFERENT model -- also no longer applies.
    const changedModel = checkCalibrationGate(calibrations, 'modelB', 'promptHashA');
    expect(changedModel.status).toBe('missing');
    expect(changedModel.status).not.toBe('passing');
  });
});

describe('an-uncalibrated-judge-cannot-produce-a-blocking-verdict', () => {
  // This test operates at the pure-function gate layer only: it proves
  // checkCalibrationGate correctly classifies the three states that
  // downstream, DB-coupled logic (compare.ts, out of scope here, owned by
  // the main agent) will branch on to decide whether a verdict may block.
  // The actual "advisory only, never blocking" enforcement happens there.

  it('never-calibrated-is-missing-not-failing', () => {
    const neverCalibrated = checkCalibrationGate([], 'modelA', 'promptHashA');
    expect(neverCalibrated.status).toBe('missing');
  });

  it('a-calibration-below-the-kappa-floor-is-failing-not-missing', () => {
    // A calibration record exists and matches current config exactly, but
    // its kappa was below JUDGE_KAPPA_FLOOR (passed: false, decided upstream
    // by whoever computed the record). This is a DISTINCT state from
    // 'missing' -- "never calibrated" and "calibrated but failed" are
    // different findings a caller needs to report differently.
    const belowFloor: CalibrationRecord[] = [
      { judgeModel: 'modelA', judgePromptHash: 'promptHashA', cohensKappa: 0.3, labelCount: 120, passed: false },
    ];
    const result = checkCalibrationGate(belowFloor, 'modelA', 'promptHashA');
    expect(result.status).toBe('failing');
    expect(result.status).not.toBe('missing');
    expect(result.status).not.toBe('passing');
    if (result.status === 'failing') {
      expect(result.calibration.cohensKappa).toBe(0.3);
    }
  });
});

describe('a-stale-calibration-for-a-different-judge-config-does-not-count-as-missing-or-passing-for-the-current-one', () => {
  it('the-gate-picks-the-record-matching-current-config-even-among-stale-records', () => {
    // Two calibration records for the same model, at different prompt
    // hashes (an old one and a re-calibrated new one). Checking against the
    // NEW prompt hash must return the NEW record, not the old one and not
    // 'missing' just because an old record also exists.
    const calibrations: CalibrationRecord[] = [
      { judgeModel: 'modelA', judgePromptHash: 'promptHashOLD', cohensKappa: 0.9, labelCount: 200, passed: true },
      { judgeModel: 'modelA', judgePromptHash: 'promptHashNEW', cohensKappa: 0.8, labelCount: 150, passed: true },
    ];

    const result = checkCalibrationGate(calibrations, 'modelA', 'promptHashNEW');
    expect(result.status).toBe('passing');
    if (result.status === 'passing') {
      expect(result.calibration.judgePromptHash).toBe('promptHashNEW');
    }
  });

  it('any-number-of-non-matching-stale-records-still-yields-missing', () => {
    // §5.5 / contract: "if none match, status is 'missing' regardless of how
    // many non-matching (stale) calibration records exist in the array."
    // Multiple stale records, none matching current config, must not somehow
    // accumulate into a 'passing' or 'failing' status.
    const onlyStale: CalibrationRecord[] = [
      { judgeModel: 'modelA', judgePromptHash: 'promptHashOLD1', cohensKappa: 0.9, labelCount: 200, passed: true },
      { judgeModel: 'modelA', judgePromptHash: 'promptHashOLD2', cohensKappa: 0.7, labelCount: 100, passed: true },
      { judgeModel: 'modelB', judgePromptHash: 'promptHashNEW', cohensKappa: 0.65, labelCount: 130, passed: true },
    ];

    const result = checkCalibrationGate(onlyStale, 'modelA', 'promptHashNEW');
    expect(result.status).toBe('missing');
  });
});
