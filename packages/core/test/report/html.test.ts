// Written from the Phase 7 interface contract and
// .claude/commands/build-llm-regression-suite.md §5.6, §5.8, §8 WITHOUT
// reading src/report/html.ts (implemented concurrently by report-designer).
//
// Contract, given (not read from src):
//   function renderHtmlReport(data: ComparisonReportData): string;
// Standalone document, inline <style>, no external assets/fonts/scripts.
// Palette per §8: paper #FAFAF8, ink #16181D, rule #DCDDD8, alert
// #A23B2C (REGRESSION ONLY), settled #2C5F4F (improvement_detected only),
// muted #7A7E85 (everything non-significant). "Non-significant results
// are never colored with the alert color" -- stated in §8 as "the single
// most important rule." Intervals always render bracketed with explicit
// signs, one decimal place. The interval bar: when the CI crosses zero it
// renders MUTED and unbolded regardless of the verdict string elsewhere
// on the page -- this specific element's color follows "does the interval
// cross zero," not the verdict.
//
// The palette rule "alert ... (regression only)" is read literally below:
// alert must never appear for a non-'regression' verdict, and (see the
// dedicated describe block further down) must not even appear on the
// interval-bar element of a 'regression' verdict whose own CI happens to
// cross zero (a real, constructible state per §5.6's critical-case
// override: "any critical case regressed" can produce verdict='regression'
// even when the aggregate CI is not itself below zero).

import { describe, it, expect } from 'vitest';
import { renderHtmlReport } from '../../src/report/html.js';
import type { ComparisonReportData, RegressedCaseRow, JudgeCalibrationStatus } from '../../src/report/types.js';

const ALERT_HEX = '#A23B2C';
const SETTLED_HEX = '#2C5F4F';

function methods(overrides: Partial<ComparisonReportData['methods']> = {}): ComparisonReportData['methods'] {
  return {
    test: 'paired_bootstrap',
    bootstrapIterations: 10000,
    baselineLabel: 'baseline',
    candidateLabel: 'a1b2c3d',
    baselineModel: 'claude-sonnet-5',
    candidateModel: 'claude-sonnet-5',
    baselinePromptHash: 'sha256:aaaa1111bbbb2222',
    candidatePromptHash: 'sha256:cccc3333dddd4444',
    baselineCacheHitRate: 0.92,
    candidateCacheHitRate: 0.15,
    ...overrides,
  };
}

function baseFixture(overrides: Partial<ComparisonReportData> = {}): ComparisonReportData {
  return {
    comparisonId: 'cmp-0001',
    suiteName: 'support-agent',
    verdict: 'no_detectable_difference',
    delta: 0.004,
    ciLower: -0.021,
    ciUpper: 0.031,
    mde: 0.084,
    mdeCeiling: 0.15,
    pairedCaseCount: 118,
    minPairedN: 30,
    excludedCount: 2,
    criticalRegressed: 0,
    regressedCases: [],
    fixedCases: [],
    judgeCalibrations: [],
    methods: methods(),
    computedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function regressedRow(overrides: Partial<RegressedCaseRow> = {}): RegressedCaseRow {
  return {
    externalId: 'refund-past-window',
    critical: false,
    baselineScore: 0.9,
    candidateScore: 0.3,
    baselineOutput: 'We can process a refund within policy.',
    candidateOutput: 'We cannot process a refund at this time.',
    ...overrides,
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function signedPPFragment(fraction: number): string {
  const magnitude = Math.abs(fraction * 100).toFixed(1).replace('.', '\\.');
  const sign = fraction < 0 ? '[-−]' : '\\+';
  return `${sign}\\s*${magnitude}`;
}

function bracketedIntervalRegex(delta: number, lower: number, upper: number): RegExp {
  return new RegExp(`${signedPPFragment(delta)}\\s*pp\\s*\\[\\s*${signedPPFragment(lower)}\\s*,\\s*${signedPPFragment(upper)}\\s*\\]`);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

// ===========================================================================
// intervals always bracketed in html
// ===========================================================================

describe('intervals-are-always-bracketed-with-an-explicit-sign-in-html-across-several-fixtures', () => {
  const cases: Array<[string, Partial<ComparisonReportData>]> = [
    ['a regression with a clearly negative CI', { verdict: 'regression', delta: -0.032, ciLower: -0.058, ciUpper: -0.006 }],
    ['a no_detectable_difference CI spanning zero', { verdict: 'no_detectable_difference', delta: 0.004, ciLower: -0.021, ciUpper: 0.031 }],
    ['an improvement_detected CI entirely above zero', { verdict: 'improvement_detected', delta: 0.052, ciLower: 0.012, ciUpper: 0.093 }],
    ['insufficient_data with a small positive delta', { verdict: 'insufficient_data', delta: 0.015, ciLower: -0.19, ciUpper: 0.22, mde: 0.41 }],
  ];

  it.each(cases)('%s renders the bracketed interval with explicit signs and one decimal place in the visible text', (_label, overrides) => {
    const data = baseFixture(overrides);
    const html = renderHtmlReport(data);
    const visible = stripTags(html);
    expect(visible).toMatch(bracketedIntervalRegex(data.delta, data.ciLower, data.ciUpper));
  });
});

// ===========================================================================
// non-significant results never carry the alert color -- the "single most
// important rule" in §8
// ===========================================================================

describe('a-non-significant-verdict-never-contains-the-alert-color-anywhere-in-html', () => {
  it('no_detectable_difference-with-a-failing-judge-still-never-uses-the-alert-hex', () => {
    // A failing judge calibration is deliberately included here: the
    // palette rule "alert (regression only)" applies regardless of
    // whether some OTHER part of the report also wants to look urgent
    // (per §5.9, a failing calibration should look urgent -- but not by
    // borrowing the color contractually reserved for actual regressions).
    const calibrations: JudgeCalibrationStatus[] = [{ grader: 'judge:helpfulness', status: 'failing', cohensKappa: 0.3, labelCount: 90 }];
    const data = baseFixture({ verdict: 'no_detectable_difference', judgeCalibrations: calibrations });
    const html = renderHtmlReport(data);
    expect(html.toUpperCase()).not.toContain(ALERT_HEX);
  });

  it('insufficient_data-with-a-failing-judge-still-never-uses-the-alert-hex', () => {
    const calibrations: JudgeCalibrationStatus[] = [{ grader: 'judge:helpfulness', status: 'failing', cohensKappa: 0.3, labelCount: 90 }];
    const data = baseFixture({ verdict: 'insufficient_data', mde: 0.5, judgeCalibrations: calibrations });
    const html = renderHtmlReport(data);
    expect(html.toUpperCase()).not.toContain(ALERT_HEX);
  });

  it('improvement_detected-never-uses-the-alert-hex-either-only-regression-may', () => {
    const data = baseFixture({ verdict: 'improvement_detected', delta: 0.05, ciLower: 0.01, ciUpper: 0.09 });
    const html = renderHtmlReport(data);
    expect(html.toUpperCase()).not.toContain(ALERT_HEX);
    // Sanity: this test is meaningful because the settled color IS
    // expected to appear somewhere for an improvement -- ruling out a
    // trivial pass from an implementation that uses neither color at all.
    expect(html.toUpperCase()).toContain(SETTLED_HEX);
  });

  it('a-regression-fixture-does-use-the-alert-color-somewhere-proving-the-negative-checks-above-are-not-vacuous', () => {
    const data = baseFixture({ verdict: 'regression', delta: -0.09, ciLower: -0.15, ciUpper: -0.03, criticalRegressed: 1, regressedCases: [regressedRow({ critical: true })] });
    const html = renderHtmlReport(data);
    expect(html.toUpperCase()).toContain(ALERT_HEX);
  });
});

// ===========================================================================
// the interval bar follows "does the CI cross zero," not the verdict string
// ===========================================================================

describe('the-interval-bar-is-never-alert-colored-when-the-ci-crosses-zero-even-if-the-verdict-is-regression', () => {
  it('a-regression-triggered-only-by-a-critical-case-override-with-a-zero-crossing-ci-uses-the-alert-color-less-than-an-equivalent-clearly-negative-regression', () => {
    // Both fixtures carry the SAME critical case content (so any legitimate
    // alert-coloring of the critical case row itself is identical between
    // them) -- the only structural difference is whether the aggregate CI
    // crosses zero. If the interval bar correctly follows "crosses zero"
    // rather than the verdict string, fixture A must use the alert color
    // strictly fewer times than fixture B.
    const sharedCriticalCase = regressedRow({ externalId: 'refund-past-window', critical: true, baselineScore: 0.95, candidateScore: 0.1 });

    const crossesZero = baseFixture({
      verdict: 'regression', // triggered by the critical-case override, per §5.6
      delta: 0.005,
      ciLower: -0.02,
      ciUpper: 0.03, // CI spans zero -- NOT "ciUpper < 0"
      criticalRegressed: 1,
      regressedCases: [sharedCriticalCase],
    });

    const clearlyNegative = baseFixture({
      verdict: 'regression',
      delta: -0.08,
      ciLower: -0.12,
      ciUpper: -0.04, // CI fully below zero
      criticalRegressed: 1,
      regressedCases: [sharedCriticalCase],
    });

    const htmlCrossesZero = renderHtmlReport(crossesZero);
    const htmlClearlyNegative = renderHtmlReport(clearlyNegative);

    const alertCountCrossesZero = countOccurrences(htmlCrossesZero, ALERT_HEX);
    const alertCountClearlyNegative = countOccurrences(htmlClearlyNegative, ALERT_HEX);

    expect(alertCountCrossesZero).toBeLessThan(alertCountClearlyNegative);
  });
});

// ===========================================================================
// critical vs non-critical visually distinguished in html
// ===========================================================================

describe('a-critical-regressed-case-is-visually-distinguished-from-a-non-critical-regressed-case-in-html', () => {
  // Rendered as two SEPARATE single-case documents rather than a text
  // window extracted around each case's id from a shared two-row document
  // -- see the identical reasoning in markdown.test.ts's equivalent test:
  // a windowing approach has to guess whether a distinguishing marker sits
  // before or after the id, and guessing wrong silently excludes the exact
  // content under test. A calm, non-'regression' verdict with
  // criticalRegressed=0 in both fixtures keeps the page-level verdict
  // color/copy identical between the two renders, isolating the row itself.
  const MARK_RE = /class="[^"]*critical[^"]*"|<strong|<b>|font-weight\s*:\s*bold|#A23B2C|⚠|🔴|critical/gi;

  it('a-lone-critical-row-carries-more-distinguishing-markup-than-an-otherwise-identical-non-critical-row', () => {
    // Deliberately NOT using ids containing the substring "critical" -- see
    // the identical note in markdown.test.ts's equivalent test.
    const critical = regressedRow({ externalId: 'refund-past-window-9f2', critical: true, baselineScore: 0.95, candidateScore: 0.2 });
    const normal = regressedRow({ externalId: 'tone-mismatch-8a1', critical: false, baselineScore: 0.95, candidateScore: 0.2 });

    const criticalDoc = renderHtmlReport(baseFixture({ verdict: 'no_detectable_difference', criticalRegressed: 0, regressedCases: [critical] }));
    const normalDoc = renderHtmlReport(baseFixture({ verdict: 'no_detectable_difference', criticalRegressed: 0, regressedCases: [normal] }));

    const criticalMarks = (criticalDoc.match(MARK_RE) || []).length;
    const normalMarks = (normalDoc.match(MARK_RE) || []).length;
    expect(criticalMarks).toBeGreaterThan(normalMarks);
  });
});

// ===========================================================================
// standalone document, no external assets
// ===========================================================================

describe('renderHtmlReport-produces-a-standalone-document-with-no-external-assets', () => {
  it('the-document-declares-doctype-html-and-carries-its-own-inline-style-block', () => {
    const html = renderHtmlReport(baseFixture());
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toMatch(/<style/i);
  });

  it('nothing-loads-an-external-script-stylesheet-or-import', () => {
    const html = renderHtmlReport(baseFixture());
    expect(html).not.toMatch(/<script[^>]+src\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/@import\s+url\(\s*["']?https?:/i);
  });

  it('numbers-and-hashes-are-styled-with-a-monospace-or-tabular-nums-face-per-the-type-direction', () => {
    const html = renderHtmlReport(baseFixture());
    expect(html).toMatch(/tabular-nums|monospace/i);
  });
});

// ===========================================================================
// prefers-reduced-motion respected if any motion is added at all
// ===========================================================================

describe('motion-is-either-absent-or-gated-behind-a-prefers-reduced-motion-media-query', () => {
  // A bare "does the document contain the string prefers-reduced-motion
  // anywhere" check is too weak: a stylesheet can legitimately contain
  // that media query for one harmless rule while having a SEPARATE,
  // completely unguarded transition/animation declaration elsewhere --
  // the string's mere presence would hide that. This checks that every
  // motion declaration actually falls inside the character range of some
  // `@media (prefers-reduced-motion...)` block, via brace matching.
  //
  // Known limitation (documented rather than silently assumed away): this
  // does not verify which DIRECTION the query gates (motion nested inside
  // `(prefers-reduced-motion: no-preference)` is correctly opt-in; motion
  // nested inside `(prefers-reduced-motion: reduce)` would be backwards --
  // it would only play when the user asked for LESS motion). Catching that
  // inversion would need real CSS parsing, which is out of scope for a
  // string-based test that must not assume implementation structure.
  function matchingBraceEnd(text: string, openBraceIndex: number): number {
    let depth = 0;
    for (let i = openBraceIndex; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return text.length;
  }

  function reducedMotionGuardedRanges(html: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const mediaRe = /@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*\{/gi;
    let m: RegExpExecArray | null;
    while ((m = mediaRe.exec(html))) {
      const braceStart = html.indexOf('{', m.index);
      if (braceStart === -1) continue;
      ranges.push([braceStart, matchingBraceEnd(html, braceStart)]);
    }
    return ranges;
  }

  it('every-transition-animation-or-keyframes-rule-other-than-none-sits-inside-a-prefers-reduced-motion-media-block', () => {
    const html = renderHtmlReport(baseFixture());
    const guardedRanges = reducedMotionGuardedRanges(html);
    const isGuarded = (idx: number) => guardedRanges.some(([s, e]) => idx > s && idx < e);

    const motionDeclRe = /(transition|animation)\s*:\s*(?!none\b)[a-z0-9.]/gi;
    const keyframesRe = /@keyframes\s+[a-zA-Z0-9_-]+\s*\{/gi;

    let foundAny = false;
    let allGuarded = true;
    let d: RegExpExecArray | null;
    while ((d = motionDeclRe.exec(html))) {
      foundAny = true;
      if (!isGuarded(d.index)) allGuarded = false;
    }
    while ((d = keyframesRe.exec(html))) {
      foundAny = true;
      if (!isGuarded(d.index)) allGuarded = false;
    }

    expect(!foundAny || allGuarded).toBe(true);
  });
});
