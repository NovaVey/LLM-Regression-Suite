// Written from the Phase 7 interface contract and
// .claude/commands/build-llm-regression-suite.md §5.6, §5.8, §5.9, §8
// WITHOUT reading src/report/markdown.ts (implemented concurrently by
// report-designer).
//
// Contract, given (not read from src):
//   export const PR_COMMENT_MARKER = '<!-- llmreg-regression-suite-comment -->';
//   function renderMarkdownReport(data: ComparisonReportData): string;
// The comment must render, in order: (1) one-line verdict + CI, (2) n
// paired / MDE / judge calibration status, (3) regressed cases table with
// reachable diffs, critical cases visually distinguished, (4) fixed cases
// collapsed, (5) a collapsed methods block. §8: intervals always render
// bracketed as "−3.2pp [−5.8, −0.6]" (percentage-point, one
// decimal, EXPLICIT sign on both the point estimate and both bounds).
// Non-significant verdicts (no_detectable_difference, insufficient_data)
// must read calm: no bold, no exclamation; emphasis reserved for an actual
// regression. A failing judge calibration must "say so loudly" (§5.9:
// "the check fails loudly, never silently") and its scores must not read
// as having driven the verdict. improvement_detected is "detected, not
// proven" -- never claim certainty (§5.6).
//
// -----------------------------------------------------------------------
// RESOLVED POST-DELEGATION (main agent): §5.6's insufficient_data row
// distinguishes "MDE above ceiling" from "paired n below floor" as
// reading differently. Both this test-author delegation and the
// concurrent report-designer delegation independently flagged that
// `ComparisonReportData` as originally contracted carried no
// `mdeCeiling`/`minPairedN` field, so the renderer had no way to know
// which threshold was actually crossed. Fixed by threading both fields
// through the contract (types.ts) from the suite config (load.ts) --
// see docs/DECISIONS.md's Phase 7 section. The
// "say-which-threshold-was-crossed" tests below were added after that
// fix landed, replacing the originally-planned "we can't know" tests.
//
// FLAGGED TENSION: "no bold/exclamation on no_detectable_difference or
// insufficient_data" (calm-tone rule) and "a failing calibration must say
// so loudly" (§5.9) both apply unconditionally per their own wording,
// but could collide if a suite has a failing judge AND a
// no_detectable_difference verdict. Tests below sidestep this by using an
// all-PASSING judge fixture for the calm-tone check and a dedicated fixture
// for the loud-warning check, rather than assuming which rule wins when
// both could apply to the same comment.
// -----------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { renderMarkdownReport, PR_COMMENT_MARKER } from '../../src/report/markdown.js';
import type { ComparisonReportData, RegressedCaseRow, FixedCaseRow, JudgeCalibrationStatus } from '../../src/report/types.js';

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

function fixedRow(overrides: Partial<FixedCaseRow> = {}): FixedCaseRow {
  return {
    externalId: 'tone-escalation-1',
    baselineScore: 0.4,
    candidateScore: 0.85,
    ...overrides,
  };
}

/** Regex fragment matching the required percentage-point formatting for one
 * signed number: explicit '+' for >=0, explicit '-' (ASCII hyphen or the
 * U+2212 minus sign the spec's own prose uses -- both accepted, see the
 * ambiguity note at the top of this file about which glyph) for negative,
 * magnitude to exactly one decimal place. */
function signedPPFragment(fraction: number): string {
  const magnitude = Math.abs(fraction * 100).toFixed(1).replace('.', '\\.');
  const sign = fraction < 0 ? '[-−]' : '\\+';
  return `${sign}${magnitude}`;
}

function bracketedIntervalRegex(delta: number, lower: number, upper: number): RegExp {
  return new RegExp(`${signedPPFragment(delta)}pp\\s*\\[${signedPPFragment(lower)},\\s*${signedPPFragment(upper)}\\]`);
}

function firstVisibleLine(md: string): string {
  const withoutMarker = md.startsWith(PR_COMMENT_MARKER) ? md.slice(PR_COMMENT_MARKER.length) : md;
  const lines = withoutMarker
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines[0] ?? '';
}

// ===========================================================================
// the-pr-comment-marker-is-present-and-stable-across-renders
// ===========================================================================

describe('the-pr-comment-marker-is-present-and-stable-across-renders', () => {
  it('the-marker-constant-matches-the-exact-string-phase-8-will-grep-for', () => {
    expect(PR_COMMENT_MARKER).toBe('<!-- llmreg-regression-suite-comment -->');
  });

  it('the-marker-is-embedded-verbatim-at-the-very-top-of-the-rendered-markdown-regardless-of-content', () => {
    const fixtures = [
      baseFixture({ comparisonId: 'cmp-aaaa', suiteName: 'support-agent', verdict: 'regression', ciLower: -0.1, ciUpper: -0.02, delta: -0.06 }),
      baseFixture({ comparisonId: 'cmp-bbbb', suiteName: 'billing-agent', verdict: 'improvement_detected', ciLower: 0.01, ciUpper: 0.09, delta: 0.05 }),
      baseFixture({ comparisonId: 'cmp-cccc', suiteName: 'a-totally-different-suite', verdict: 'insufficient_data', mde: 0.4 }),
      baseFixture({ comparisonId: 'cmp-dddd', suiteName: 'support-agent', verdict: 'no_detectable_difference' }),
    ];

    const renders = fixtures.map((f) => renderMarkdownReport(f));

    for (const md of renders) {
      expect(md.startsWith(PR_COMMENT_MARKER)).toBe(true);
    }

    // Identical marker text every time, independent of comparisonId/suite/verdict.
    const markerSlices = renders.map((md) => md.slice(0, PR_COMMENT_MARKER.length));
    expect(new Set(markerSlices).size).toBe(1);
    expect(markerSlices[0]).toBe(PR_COMMENT_MARKER);
  });

  it('rendering-the-same-comparison-twice-produces-the-identical-marker-both-times', () => {
    const data = baseFixture({ verdict: 'regression', ciLower: -0.08, ciUpper: -0.01, delta: -0.045 });
    const first = renderMarkdownReport(data);
    const second = renderMarkdownReport(data);
    expect(first.slice(0, PR_COMMENT_MARKER.length)).toBe(second.slice(0, PR_COMMENT_MARKER.length));
  });
});

// ===========================================================================
// intervals-are-always-bracketed-with-an-explicit-sign-in-markdown
// ===========================================================================

describe('intervals-are-always-bracketed-with-an-explicit-sign-in-markdown-across-several-fixtures', () => {
  const cases: Array<[string, Partial<ComparisonReportData>]> = [
    ['a regression with a clearly negative CI', { verdict: 'regression', delta: -0.032, ciLower: -0.058, ciUpper: -0.006, criticalRegressed: 0 }],
    ['a no_detectable_difference CI spanning zero', { verdict: 'no_detectable_difference', delta: 0.004, ciLower: -0.021, ciUpper: 0.031 }],
    ['an improvement_detected CI entirely above zero', { verdict: 'improvement_detected', delta: 0.052, ciLower: 0.012, ciUpper: 0.093 }],
    ['insufficient_data with a small positive delta', { verdict: 'insufficient_data', delta: 0.015, ciLower: -0.19, ciUpper: 0.22, mde: 0.41 }],
  ];

  it.each(cases)('%s renders the bracketed interval with explicit signs and one decimal place', (_label, overrides) => {
    const data = baseFixture(overrides);
    const md = renderMarkdownReport(data);
    const re = bracketedIntervalRegex(data.delta, data.ciLower, data.ciUpper);
    expect(md).toMatch(re);
  });
});

// ===========================================================================
// a-skimmable-first-line-communicates-verdict-and-tone-without-reading-further
// ===========================================================================

describe('a-skimmable-first-line-communicates-verdict-and-tone-without-reading-further', () => {
  it('the-first-visible-line-of-a-regression-contains-the-interval-and-reads-as-a-regression', () => {
    const data = baseFixture({ verdict: 'regression', delta: -0.06, ciLower: -0.11, ciUpper: -0.02, criticalRegressed: 0, regressedCases: [regressedRow()] });
    const line = firstVisibleLine(renderMarkdownReport(data));
    expect(line).toMatch(bracketedIntervalRegex(data.delta, data.ciLower, data.ciUpper));
    expect(line).toMatch(/regress/i);
  });

  it('the-first-visible-line-of-a-no-detectable-difference-does-not-read-as-alarmed', () => {
    const data = baseFixture({ verdict: 'no_detectable_difference' });
    const line = firstVisibleLine(renderMarkdownReport(data));
    expect(line).toMatch(bracketedIntervalRegex(data.delta, data.ciLower, data.ciUpper));
    expect(line).not.toMatch(/regress/i);
    expect(line).not.toContain('!');
  });

  it('the-first-visible-line-of-an-insufficient-data-verdict-does-not-read-as-a-regression', () => {
    const data = baseFixture({ verdict: 'insufficient_data', mde: 0.35 });
    const line = firstVisibleLine(renderMarkdownReport(data));
    expect(line).toMatch(bracketedIntervalRegex(data.delta, data.ciLower, data.ciUpper));
    expect(line).not.toMatch(/regress/i);
  });
});

describe('an-insufficient-data-verdict-names-specifically-which-threshold-was-crossed', () => {
  // §5.6: "MDE above ceiling, or paired n below floor" read as different
  // findings. Added post-delegation once mdeCeiling/minPairedN were
  // threaded through the contract -- see the file header.
  it('names the MDE ceiling when only that threshold is crossed', () => {
    const data = baseFixture({ verdict: 'insufficient_data', mde: 0.4, mdeCeiling: 0.15, pairedCaseCount: 118, minPairedN: 30 });
    const body = renderMarkdownReport(data);
    expect(body).toMatch(/ceiling/i);
    expect(body).not.toMatch(/floor/i);
  });

  it('names the paired-n floor when only that threshold is crossed', () => {
    const data = baseFixture({ verdict: 'insufficient_data', mde: 0.1, mdeCeiling: 0.15, pairedCaseCount: 10, minPairedN: 30 });
    const body = renderMarkdownReport(data);
    expect(body).toMatch(/floor/i);
    expect(body).not.toMatch(/ceiling/i);
  });

  it('names both when both thresholds are crossed', () => {
    const data = baseFixture({ verdict: 'insufficient_data', mde: 0.4, mdeCeiling: 0.15, pairedCaseCount: 10, minPairedN: 30 });
    const body = renderMarkdownReport(data);
    expect(body).toMatch(/floor/i);
    expect(body).toMatch(/ceiling/i);
  });
});

// ===========================================================================
// no-bold-or-exclamation-on-non-significant-verdicts
// ===========================================================================

describe('a-non-significant-verdict-never-uses-bold-or-exclamation-emphasis-in-markdown', () => {
  // The PR_COMMENT_MARKER is an HTML comment ("<!-- ... -->") and
  // legitimately contains a literal "!" as part of that syntax -- it is
  // invisible when rendered and is not "emphasis," so it is stripped
  // before checking for alarm-style punctuation. The calm-tone rule is
  // about the VISIBLE content of the comment.
  function visibleContent(md: string): string {
    return md.startsWith(PR_COMMENT_MARKER) ? md.slice(PR_COMMENT_MARKER.length) : md;
  }

  it('no_detectable_difference-with-a-passing-judge-and-no-cases-carries-no-bold-and-no-exclamation-anywhere', () => {
    const data = baseFixture({
      verdict: 'no_detectable_difference',
      judgeCalibrations: [{ grader: 'judge:helpfulness', status: 'passing', cohensKappa: 0.81, labelCount: 150 }],
      regressedCases: [],
      fixedCases: [],
    });
    const visible = visibleContent(renderMarkdownReport(data));
    expect(visible).not.toContain('**');
    expect(visible).not.toContain('!');
  });

  it('insufficient_data-with-a-passing-judge-and-no-cases-carries-no-bold-and-no-exclamation-anywhere', () => {
    const data = baseFixture({
      verdict: 'insufficient_data',
      mde: 0.44,
      judgeCalibrations: [{ grader: 'judge:helpfulness', status: 'passing', cohensKappa: 0.81, labelCount: 150 }],
      regressedCases: [],
      fixedCases: [],
    });
    const visible = visibleContent(renderMarkdownReport(data));
    expect(visible).not.toContain('**');
    expect(visible).not.toContain('!');
  });
});

// ===========================================================================
// improvement_detected copy never claims certainty
// ===========================================================================

describe('an-improvement-detected-verdict-never-claims-certainty-or-proof', () => {
  it('the-word-proven-proof-guaranteed-or-confirmed-never-appears-affirmatively-for-improvement_detected', () => {
    // §5.6's own recommended framing is "detected, not proven" -- the word
    // "proven" (etc.) is fine when NEGATED (that's the whole point of the
    // copy), but must never appear as an affirmative claim. A fixed-width
    // negative lookbehind for "not " immediately before the word is enough
    // to allow the spec's own phrasing while still catching an affirmative
    // certainty claim like "this is a proven improvement".
    const data = baseFixture({ verdict: 'improvement_detected', delta: 0.05, ciLower: 0.01, ciUpper: 0.09 });
    const md = renderMarkdownReport(data);
    expect(md).not.toMatch(/(?<!not\s)\bproven\b/i);
    expect(md).not.toMatch(/(?<!not\s)\bproof\b/i);
    expect(md).not.toMatch(/(?<!not\s)\bguarantee(d)?\b/i);
    expect(md).not.toMatch(/(?<!not\s)\bconfirmed\b/i);
    expect(md).not.toMatch(/\bcertainly\b/i);
  });
});

// ===========================================================================
// a-regression-headline-names-the-regressed-count-and-whether-any-are-critical
// ===========================================================================

describe('a-regression-headline-names-the-regressed-case-count-and-that-a-case-is-critical', () => {
  it('the-rendered-report-states-the-actual-number-of-regressed-cases-and-flags-critical-involvement', () => {
    const data = baseFixture({
      verdict: 'regression',
      // Chosen so that NONE of delta/ciLower/ciUpper/mde/pairedCaseCount
      // format (per §8's one-decimal pp rule) to a value containing the
      // digit "3" -- regressedCases.length below is 3, and an earlier
      // version of this test was fooled by ciUpper=-0.03 formatting to
      // "−3.0pp", which happened to sit within a generous proximity window
      // of the unrelated word "cases" on the very next line.
      delta: -0.095,
      ciLower: -0.148,
      ciUpper: -0.041,
      criticalRegressed: 1,
      pairedCaseCount: 118, // deliberately distinct from regressedCases.length so a coincidental digit match can't hide a bug
      regressedCases: [
        regressedRow({ externalId: 'refund-past-window', critical: true }),
        regressedRow({ externalId: 'tone-mismatch-1', critical: false }),
        regressedRow({ externalId: 'escalation-timing-2', critical: false }),
      ],
    });
    const md = renderMarkdownReport(data);
    // Proximity-bound rather than a bare `.toContain(String(n))`: a report
    // this dense with numbers (CI bounds, MDE, paired count, per-case
    // scores) will very likely contain the digit "3" SOMEWHERE by pure
    // coincidence (e.g. ciUpper=-0.03 formats to "−3.0pp"), which would
    // make a bare containment check pass even if the count were never
    // actually stated. Requiring "3" to appear near the words "case" /
    // "regressed" is what actually tests the claim -- note "regressed"
    // rather than a bare "regress", since bare "regress" also matches
    // inside the word "Regression" itself (the verdict name, which is
    // present on every regression report regardless of whether the count
    // is ever stated).
    const n = data.regressedCases.length;
    const countNearCaseWordRe = new RegExp(`\\b${n}\\b[^\\n]{0,60}(case|\\bregressed\\b)|(case|\\bregressed\\b)[^\\n]{0,60}\\b${n}\\b`, 'i');
    expect(md).toMatch(countNearCaseWordRe);
    expect(md).toMatch(/critical/i);
  });
});

// ===========================================================================
// fixed cases collapsed but recoverable
// ===========================================================================

describe('fixed-cases-are-collapsed-but-their-count-and-case-ids-remain-recoverable', () => {
  it('fixed-case-ids-and-the-total-count-are-present-inside-a-collapsible-details-block', () => {
    const data = baseFixture({
      fixedCases: [fixedRow({ externalId: 'tone-escalation-1' }), fixedRow({ externalId: 'refund-edge-case-7' })],
    });
    const md = renderMarkdownReport(data);
    expect(md).toMatch(/<details/i);
    expect(md).toMatch(/<\/details>/i);
    expect(md).toContain('tone-escalation-1');
    expect(md).toContain('refund-edge-case-7');
    // Proximity-bound for the same reason as the regressed-count check
    // above -- a bare digit can coincidentally appear anywhere in a
    // number-dense report.
    const n = data.fixedCases.length;
    const countNearFixedWordRe = new RegExp(`\\b${n}\\b[^\\n]{0,60}fixed|fixed[^\\n]{0,60}\\b${n}\\b`, 'i');
    expect(md).toMatch(countNearFixedWordRe);
  });
});

// ===========================================================================
// methods block collapsed but every field recoverable
// ===========================================================================

describe('the-methods-block-is-collapsed-and-every-methods-field-is-recoverable', () => {
  it('test-name-iterations-labels-models-and-prompt-hashes-are-all-present-in-the-rendered-report', () => {
    const m = methods({
      test: 'paired_bootstrap',
      bootstrapIterations: 10000,
      baselineLabel: 'baseline',
      candidateLabel: 'feature/new-refund-copy@a1b2c3d',
      baselineModel: 'claude-sonnet-5',
      candidateModel: 'claude-sonnet-5',
      baselinePromptHash: 'sha256:1111aaaa2222bbbb',
      candidatePromptHash: 'sha256:3333cccc4444dddd',
    });
    const data = baseFixture({ methods: m });
    const md = renderMarkdownReport(data);

    expect(md).toMatch(/<details/i);
    expect(md).toContain(m.test);
    expect(md).toContain(String(m.bootstrapIterations));
    expect(md).toContain(m.baselineLabel);
    expect(md).toContain(m.candidateLabel);
    expect(md).toContain(m.baselineModel);
    expect(md).toContain(m.baselinePromptHash);
    expect(md).toContain(m.candidatePromptHash);
  });

  it('a-null-bootstrap-iterations-count-for-a-mcnemar-test-does-not-crash-and-still-names-the-test', () => {
    const m = methods({ test: 'mcnemar', bootstrapIterations: null });
    const data = baseFixture({ methods: m });
    expect(() => renderMarkdownReport(data)).not.toThrow();
    expect(renderMarkdownReport(data)).toContain('mcnemar');
  });
});

// ===========================================================================
// failing calibration renders as a loud warning
// ===========================================================================

describe('a-failing-calibration-judge-renders-as-a-loud-warning-not-silently-omitted-or-indistinguishable-from-passing', () => {
  // Bounded by the OTHER grader's own identifier rather than a fixed
  // character span: two calibration entries can legitimately sit close
  // together in the rendered comment, and a fixed-width window risks
  // pulling a neighboring entry's markers into the wrong block (which
  // would make the two counts look artificially equal). Extracting up to
  // wherever the other identifier next appears keeps each block to just
  // its own entry regardless of the renderer's exact layout or order.
  function extractOwnBlock(text: string, id: string, otherId: string): string {
    const start = text.indexOf(id);
    if (start === -1) return '';
    const otherIdx = text.indexOf(otherId, start + id.length);
    const end = otherIdx === -1 ? text.length : otherIdx;
    return text.slice(start, end);
  }

  const LOUD_MARKER_RE = /\*\*|__|⚠|❗|\bWARNING\b|\bCAUTION\b/;

  it('a-failing-graders-status-is-never-silently-omitted', () => {
    const calibrations: JudgeCalibrationStatus[] = [
      { grader: 'judge:helpfulness', status: 'failing', cohensKappa: 0.42, labelCount: 120 },
      { grader: 'judge:tone', status: 'passing', cohensKappa: 0.81, labelCount: 150 },
    ];
    const data = baseFixture({ judgeCalibrations: calibrations });
    const md = renderMarkdownReport(data);
    expect(md).toContain('judge:helpfulness');
  });

  it('a-failing-graders-block-carries-loud-emphasis-that-a-passing-graders-block-does-not-need', () => {
    const calibrations: JudgeCalibrationStatus[] = [
      { grader: 'judge:helpfulness', status: 'failing', cohensKappa: 0.42, labelCount: 120 },
      { grader: 'judge:tone', status: 'passing', cohensKappa: 0.81, labelCount: 150 },
    ];
    const data = baseFixture({ judgeCalibrations: calibrations });
    const md = renderMarkdownReport(data);

    const failingBlock = extractOwnBlock(md, 'judge:helpfulness', 'judge:tone');
    const passingBlock = extractOwnBlock(md, 'judge:tone', 'judge:helpfulness');

    expect(failingBlock).toMatch(/fail/i);
    const failingMarks = (failingBlock.match(new RegExp(LOUD_MARKER_RE, 'gi')) || []).length;
    const passingMarks = (passingBlock.match(new RegExp(LOUD_MARKER_RE, 'gi')) || []).length;
    expect(failingMarks).toBeGreaterThan(passingMarks);

    // The passing grader's real kappa/labelCount must still be legible.
    expect(passingBlock).toContain('0.81');
    expect(passingBlock).toContain('150');
  });

  it('a-failing-graders-scores-are-explicitly-described-as-not-having-driven-the-verdict', () => {
    // Spec (§5.5/§5.9): "a failing-calibration judge's scores were
    // advisory only and must not read as having driven this verdict."
    const calibrations: JudgeCalibrationStatus[] = [{ grader: 'judge:helpfulness', status: 'failing', cohensKappa: 0.2, labelCount: 90 }];
    const data = baseFixture({ verdict: 'no_detectable_difference', judgeCalibrations: calibrations });
    const md = renderMarkdownReport(data);
    expect(md).toMatch(/advisory|not drive|did not drive|does not drive/i);
  });

  it('a-suite-using-no-judge-graders-renders-cleanly-with-an-empty-calibrations-array', () => {
    const data = baseFixture({ judgeCalibrations: [] });
    expect(() => renderMarkdownReport(data)).not.toThrow();
    const md = renderMarkdownReport(data);
    expect(md).not.toMatch(/\bpassing\b.*judge|judge.*\bpassing\b/i);
  });
});

// ===========================================================================
// critical case visually distinguished from a non-critical one
// ===========================================================================

describe('a-critical-regressed-case-is-visually-distinguished-from-a-non-critical-regressed-case-in-markdown', () => {
  // Rendered as two SEPARATE single-case documents (rather than extracting
  // a text window around each case's id from a shared two-row document):
  // a windowing approach has to guess where a per-row marker sits relative
  // to the id (before it? after it? how far?) without reading the
  // implementation, and guessing wrong silently excludes the exact content
  // being tested. Rendering one case at a time, with an unbolded/uncritical
  // verdict so the headline itself contributes no marks, isolates the
  // per-row marking cleanly: the two documents are identical fixture data
  // except for the one row's `critical` flag and its (marker-word-free) id.
  const MARK_RE = /\*\*|critical|⚠|🔴|❗/gi;

  it('a-lone-critical-row-carries-more-distinguishing-markup-than-an-otherwise-identical-non-critical-row', () => {
    const critical = regressedRow({ externalId: 'refund-past-window-9f2', critical: true, baselineScore: 0.95, candidateScore: 0.2 });
    const normal = regressedRow({ externalId: 'tone-mismatch-8a1', critical: false, baselineScore: 0.95, candidateScore: 0.2 });

    // verdict left as the calm 'no_detectable_difference' (not 'regression')
    // specifically so the headline copy itself -- which per an earlier test
    // in this file legitimately names critical involvement for an actual
    // regression -- cannot contribute marks and confound the per-row
    // comparison. criticalRegressed is deliberately left at 0 in both
    // fixtures for the same reason: only the row itself should differ.
    const criticalDoc = renderMarkdownReport(baseFixture({ verdict: 'no_detectable_difference', criticalRegressed: 0, regressedCases: [critical] }));
    const normalDoc = renderMarkdownReport(baseFixture({ verdict: 'no_detectable_difference', criticalRegressed: 0, regressedCases: [normal] }));

    const criticalMarks = (criticalDoc.match(MARK_RE) || []).length;
    const normalMarks = (normalDoc.match(MARK_RE) || []).length;
    expect(criticalMarks).toBeGreaterThan(normalMarks);
  });
});

// ===========================================================================
// every regressed case's diff is reachable
// ===========================================================================

describe('every-regressed-cases-diff-content-is-reachable-in-the-rendered-markdown', () => {
  it('a-unique-token-present-only-in-one-sides-output-shows-up-somewhere-in-the-comment', () => {
    const row = regressedRow({
      externalId: 'refund-past-window',
      baselineOutput: 'Approved: refund issued per TOKEN_BASELINE_ONLY_9F3 policy clause.',
      candidateOutput: 'Denied: refund not issued per TOKEN_CANDIDATE_ONLY_9F3 policy clause.',
    });
    const data = baseFixture({ verdict: 'regression', regressedCases: [row], delta: -0.2, ciLower: -0.3, ciUpper: -0.1 });
    const md = renderMarkdownReport(data);
    const hasBaselineToken = md.includes('TOKEN_BASELINE_ONLY_9F3');
    const hasCandidateToken = md.includes('TOKEN_CANDIDATE_ONLY_9F3');
    expect(hasBaselineToken || hasCandidateToken).toBe(true);
  });
});
