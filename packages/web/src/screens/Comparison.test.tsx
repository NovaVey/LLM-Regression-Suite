// @vitest-environment jsdom
//
// Written from .claude/commands/build-llm-regression-suite.md §5.6 (verdict
// asymmetry), §5.8 (the PR-comment content this screen mirrors), and §8
// (the Comparison screen's required copy and color discipline), plus
// packages/core/src/report/copy.ts and html.ts's own doc comments -- which
// this screen's own module comment says it deliberately mirrors word-for-
// word -- WITHOUT reading Comparison.tsx's render body first. The two
// verdict fixtures below (a no_detectable_difference case and a critical-
// case-override regression) and every expected string are computed
// independently from those specs, not read off the component's output.
//
// Only facts taken from source rather than derived: the route shape
// (/suites/:suiteId/comparisons/:comparisonId) and that IntervalBar/Badge
// render via Tailwind classes ending in -alert/-settled/-muted (see
// IntervalBar.test.tsx's comment on why that's a faithful proxy here too).

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ComparisonReportData } from '@llmreg/core';
import Comparison from './Comparison.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetchFor(comparison: ComparisonReportData) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/api\/comparisons\/[^/]+$/.test(url)) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => comparison } as Response;
    }
    if (/\/api\/suites\/[^/]+\/comparisons$/.test(url)) {
      // Empty list keeps the "compare a different run" picker from
      // rendering (it hides itself at <=1 items) -- irrelevant to what
      // these tests check.
      return { ok: true, status: 200, statusText: 'OK', json: async () => [] } as Response;
    }
    throw new Error(`Unmocked fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderComparison(suiteId: string, comparisonId: string) {
  return render(
    <MemoryRouter initialEntries={[`/suites/${suiteId}/comparisons/${comparisonId}`]}>
      <Routes>
        <Route path="/suites/:suiteId/comparisons/:comparisonId" element={<Comparison />} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseMethods: ComparisonReportData['methods'] = {
  test: 'paired_bootstrap',
  bootstrapIterations: 2000,
  baselineLabel: 'baseline',
  candidateLabel: 'candidate',
  baselineModel: 'claude-sonnet-5',
  candidateModel: 'claude-sonnet-5',
  baselinePromptHash: 'abc123',
  candidatePromptHash: 'def456',
  baselineCacheHitRate: 0.2,
  candidateCacheHitRate: 0.2,
};

describe('a-no-detectable-difference-verdict-never-appears-without-its-mde-sentence', () => {
  const fixture: ComparisonReportData = {
    comparisonId: 'cmp-ndd-1',
    suiteName: 'test-suite',
    verdict: 'no_detectable_difference',
    delta: 0.01,
    ciLower: -0.02,
    ciUpper: 0.04,
    mde: 0.074,
    mdeCeiling: 0.15,
    pairedCaseCount: 40,
    minPairedN: 20,
    excludedCount: 2,
    criticalRegressed: 0,
    regressedCases: [],
    fixedCases: [],
    judgeCalibrations: [],
    methods: baseMethods,
    computedAt: '2024-01-15T10:30:00.000Z',
  };

  beforeEach(() => {
    mockFetchFor(fixture);
  });

  it('renders the headline with its bracketed interval and the required "this suite can detect" sentence, never a bare headline', async () => {
    renderComparison('suite-a', fixture.comparisonId);

    // Independently computed per §8's format rule: +1.0pp [−2.0, +4.0].
    await waitFor(() => expect(screen.getByText(/No detectable difference:/)).toBeInTheDocument());
    expect(screen.getByText(/\+1\.0pp \[−2\.0, \+4\.0\]\./)).toBeInTheDocument();

    // §5.4/copy.ts rule: "no_detectable_difference" MUST be paired with the
    // MDE sentence -- never left as a bare verdict statement.
    expect(screen.getByText('This suite can detect changes of 7.4pp or larger.')).toBeInTheDocument();
  });

  it('never renders the alert color anywhere on a non-significant verdict', async () => {
    const { container } = renderComparison('suite-a', fixture.comparisonId);
    await waitFor(() => expect(screen.getByText(/No detectable difference:/)).toBeInTheDocument());

    // Precedent: docs/DECISIONS.md, "HTML report's alert/settled colors are
    // emitted per-rule" -- alert is reserved exclusively for `regression`.
    // Tailwind's `alert` token is only ever referenced via class names
    // ending in -alert anywhere in this package.
    expect(container.innerHTML).not.toMatch(/-alert\b/);
    // And the bar itself must read as muted (crosses zero), not settled --
    // this delta is positive but the interval spans zero.
    expect(container.innerHTML).toMatch(/-muted\b/);
  });
});

describe('a-critical-case-override-can-disagree-with-the-aggregate-bar-and-both-must-be-visible', () => {
  // §5.6: "Any critical-tagged case regressing fails the check regardless
  // of the aggregate statistic." Constructed so the aggregate CI spans zero
  // (bar must read muted) while the verdict is still `regression` (headline
  // must read alert) because of one critical case -- the deliberate
  // disagreement documented in report/html.ts's module comment, which this
  // screen is required to mirror.
  const fixture: ComparisonReportData = {
    comparisonId: 'cmp-reg-1',
    suiteName: 'test-suite',
    verdict: 'regression',
    delta: 0,
    ciLower: -0.267,
    ciUpper: 0.267,
    mde: 0.387,
    mdeCeiling: 0.15,
    pairedCaseCount: 15,
    minPairedN: 10,
    excludedCount: 0,
    criticalRegressed: 1,
    regressedCases: [
      {
        externalId: 'case-critical-1',
        critical: true,
        baselineScore: 1,
        candidateScore: 0,
        baselineOutput: 'the correct refund answer',
        candidateOutput: 'a wrong refund answer',
      },
    ],
    fixedCases: [],
    judgeCalibrations: [],
    methods: baseMethods,
    computedAt: '2024-01-15T10:30:00.000Z',
  };

  beforeEach(() => {
    mockFetchFor(fixture);
  });

  it('colors the headline alert but the interval bar muted, and states the disagreement in prose', async () => {
    const { container } = renderComparison('suite-a', fixture.comparisonId);
    await waitFor(() => expect(screen.getByText(/Regression:/)).toBeInTheDocument());

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toMatch(/text-alert/);

    const bar = container.querySelector('[role="img"]')!;
    expect(bar.outerHTML).not.toMatch(/-alert\b/);
    expect(bar.outerHTML).toMatch(/-muted\b/);

    // The elaboration must name the regressed count and flag it critical
    // (regressionElaboration, copy.ts) -- computed independently: 1 of 15.
    expect(
      screen.getByText('1 of 15 paired cases flipped from passing to failing, including 1 critical case.'),
    ).toBeInTheDocument();

    // The discrepancy note is required precisely because the bar and
    // headline disagree -- omitting it would make the page read as
    // self-contradictory rather than informative.
    expect(
      screen.getByText(
        /The aggregate interval above crosses zero; this regression verdict comes from 1 critical case failing, not the aggregate trend\./,
      ),
    ).toBeInTheDocument();
  });

  it('lists the regressed case in a real, keyboard-navigable table with its critical flag and both scores', async () => {
    renderComparison('suite-a', fixture.comparisonId);
    await waitFor(() => expect(screen.getByText(/Regression:/)).toBeInTheDocument());

    const table = screen.getAllByRole('table')[0]!;
    expect(table.tagName).toBe('TABLE');
    const columnHeaders = screen.getAllByRole('columnheader');
    expect(columnHeaders.map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Case', 'Critical', 'Baseline', 'Candidate']),
    );

    // A regressed case's candidate score must genuinely be lower than its
    // baseline -- the fixture itself encodes 1.00 -> 0.00, formatScore's
    // two-decimal rendering.
    expect(screen.getByText('1.00')).toBeInTheDocument();
    expect(screen.getByText('0.00')).toBeInTheDocument();
    // The row must contain a real, focusable link (keyboard operable),
    // not a div with a click handler.
    expect(screen.getByRole('link', { name: /View diff for case-critical-1/i })).toBeInTheDocument();
  });
});
