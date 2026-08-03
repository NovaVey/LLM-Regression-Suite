// Written from the Phase 7 interface contract
// (.claude/commands/build-llm-regression-suite.md §7's `llmreg report
// --format json`, and phase7-contract.md) WITHOUT reading
// src/report/json.ts (implemented concurrently by report-designer).
//
// Contract, given (not read from src):
//   function renderJsonReport(data: ComparisonReportData): string;
// "A clean JSON serialization for programmatic consumption ...
// `JSON.stringify(data, null, 2)` on the contract's own shape is a
// perfectly good default -- no need to invent a different schema."
//
// The load-bearing guarantee this file tests: json.ts is the machine-
// readable format, so it must round-trip EVERY field of the input data
// exactly, including full floating-point precision -- unlike markdown.ts
// and html.ts, which are explicitly allowed (required, even, by §8) to
// round percentage-point numbers to one decimal place for human display.
// A json.ts that reused that display-rounding logic would silently
// corrupt the one format meant for programmatic consumption.

import { describe, it, expect } from 'vitest';
import { renderJsonReport } from '../../src/report/json.js';
import type { ComparisonReportData } from '../../src/report/types.js';

function fullFixture(overrides: Partial<ComparisonReportData> = {}): ComparisonReportData {
  return {
    comparisonId: 'cmp-9f3a2b1c',
    suiteName: 'support-agent',
    verdict: 'regression',
    delta: -0.0327891234,
    ciLower: -0.0581234567,
    ciUpper: -0.0061234567,
    mde: 0.0842345678,
    mdeCeiling: 0.15,
    pairedCaseCount: 231,
    minPairedN: 30,
    excludedCount: 9,
    criticalRegressed: 1,
    regressedCases: [
      {
        externalId: 'refund-past-window',
        critical: true,
        baselineScore: 0.9123456,
        candidateScore: 0.3012345,
        baselineOutput: 'We can process a refund within policy.',
        candidateOutput: 'We cannot process a refund at this time.',
      },
      {
        externalId: 'tone-mismatch-1',
        critical: false,
        baselineScore: 0.81,
        candidateScore: 0.55,
        baselineOutput: 'Sure thing, happy to help!',
        candidateOutput: "I understand your frustration; let's resolve this.",
      },
    ],
    fixedCases: [
      { externalId: 'escalation-timing-2', baselineScore: 0.4, candidateScore: 0.85 },
    ],
    judgeCalibrations: [
      { grader: 'judge:helpfulness', status: 'passing', cohensKappa: 0.812345, labelCount: 150 },
      { grader: 'judge:tone', status: 'failing', cohensKappa: 0.421, labelCount: 118 },
    ],
    methods: {
      test: 'paired_bootstrap',
      bootstrapIterations: 10000,
      baselineLabel: 'baseline',
      candidateLabel: 'feature/refund-copy@a1b2c3d',
      baselineModel: 'claude-sonnet-5',
      candidateModel: 'claude-sonnet-5',
      baselinePromptHash: 'sha256:1111aaaa2222bbbb',
      candidatePromptHash: 'sha256:3333cccc4444dddd',
      baselineCacheHitRate: 0.923456,
      candidateCacheHitRate: 0.150001,
    },
    computedAt: '2026-08-01T12:34:56.789Z',
    ...overrides,
  };
}

describe('renderJsonReport-round-trips-through-json-parse-reproducing-every-field', () => {
  it('json-parse-of-the-rendered-string-deep-equals-the-original-data', () => {
    const data = fullFixture();
    const parsed = JSON.parse(renderJsonReport(data));
    expect(parsed).toEqual(data);
  });

  it('the-top-level-key-set-matches-the-contract-exactly-no-extra-wrapper-no-dropped-field', () => {
    const data = fullFixture();
    const parsed = JSON.parse(renderJsonReport(data));
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(data).sort());
  });

  it('nested-arrays-of-objects-round-trip-field-for-field', () => {
    const data = fullFixture();
    const parsed = JSON.parse(renderJsonReport(data));
    expect(parsed.regressedCases).toEqual(data.regressedCases);
    expect(parsed.fixedCases).toEqual(data.fixedCases);
    expect(parsed.judgeCalibrations).toEqual(data.judgeCalibrations);
    expect(parsed.methods).toEqual(data.methods);
  });
});

describe('renderJsonReport-preserves-full-numeric-precision-unlike-the-display-formatted-renderers', () => {
  it('a-many-decimal-delta-and-ci-are-not-rounded-to-one-decimal-place-pp-style', () => {
    const data = fullFixture({ delta: -0.0327891234, ciLower: -0.0581234567, ciUpper: -0.0061234567, mde: 0.0842345678 });
    const parsed = JSON.parse(renderJsonReport(data));
    expect(parsed.delta).toBe(-0.0327891234);
    expect(parsed.ciLower).toBe(-0.0581234567);
    expect(parsed.ciUpper).toBe(-0.0061234567);
    expect(parsed.mde).toBe(0.0842345678);
  });

  it('per-case-scores-and-cache-hit-rates-keep-their-exact-fractional-values', () => {
    const data = fullFixture();
    const parsed = JSON.parse(renderJsonReport(data));
    expect(parsed.regressedCases[0].baselineScore).toBe(0.9123456);
    expect(parsed.methods.baselineCacheHitRate).toBe(0.923456);
    expect(parsed.judgeCalibrations[0].cohensKappa).toBe(0.812345);
  });
});

describe('renderJsonReport-round-trips-empty-arrays-as-empty-arrays', () => {
  it('a-suite-with-no-judge-graders-and-no-regressed-or-fixed-cases-still-parses-to-real-empty-arrays', () => {
    const data = fullFixture({
      verdict: 'no_detectable_difference',
      criticalRegressed: 0,
      regressedCases: [],
      fixedCases: [],
      judgeCalibrations: [],
    });
    const parsed = JSON.parse(renderJsonReport(data));
    expect(Array.isArray(parsed.regressedCases)).toBe(true);
    expect(parsed.regressedCases.length).toBe(0);
    expect(Array.isArray(parsed.fixedCases)).toBe(true);
    expect(parsed.fixedCases.length).toBe(0);
    expect(Array.isArray(parsed.judgeCalibrations)).toBe(true);
    expect(parsed.judgeCalibrations.length).toBe(0);
  });
});

describe('renderJsonReport-is-deterministic-and-produces-valid-readable-json', () => {
  it('two-renders-of-the-same-data-produce-byte-identical-output', () => {
    const data = fullFixture();
    expect(renderJsonReport(data)).toBe(renderJsonReport(data));
  });

  it('the-output-parses-without-throwing-and-is-indented-for-human-readability', () => {
    const data = fullFixture();
    const json = renderJsonReport(data);
    expect(() => JSON.parse(json)).not.toThrow();
    // Not a minified single line -- some indentation/newlines present.
    expect(json).toContain('\n');
    expect(json).toMatch(/\n\s{2,}"/);
  });

  it('a-null-bootstrap-iterations-value-round-trips-as-null-not-omitted-or-coerced', () => {
    const data = fullFixture({ methods: { ...fullFixture().methods, test: 'mcnemar', bootstrapIterations: null } });
    const parsed = JSON.parse(renderJsonReport(data));
    expect(parsed.methods.bootstrapIterations).toBeNull();
    expect('bootstrapIterations' in parsed.methods).toBe(true);
  });
});
