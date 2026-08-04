// @vitest-environment jsdom
//
// Written from .claude/commands/build-llm-regression-suite.md §8 ("Case
// diff — baseline and candidate output side by side, per-grader scores,
// judge rationale") and packages/core/src/web/types.ts's
// ComparisonCaseListItem/CaseDiffData shapes, WITHOUT reading CaseDiff.tsx's
// render body first.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CaseDiffData, ComparisonCaseListItem } from '@llmreg/core';
import CaseDiff from './CaseDiff.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const caseList: ComparisonCaseListItem[] = [
  {
    externalId: 'refund-past-window',
    critical: true,
    tags: ['refunds'],
    status: 'regressed',
    baselineScore: 1,
    candidateScore: 0,
    exclusionReason: null,
  },
  {
    externalId: 'greeting-tone',
    critical: false,
    tags: ['tone'],
    status: 'fixed',
    baselineScore: 0,
    candidateScore: 1,
    exclusionReason: null,
  },
  {
    externalId: 'flaky-timeout-case',
    critical: false,
    tags: ['out-of-scope'],
    status: 'excluded',
    baselineScore: null,
    candidateScore: null,
    exclusionReason: 'candidate side errored: upstream timeout',
  },
];

const caseDetail: CaseDiffData = {
  externalId: 'refund-past-window',
  critical: true,
  criticalReason: 'refund-eligibility edge case',
  tags: ['refunds'],
  inputMessages: [{ role: 'user', content: 'Can I get a refund 45 days after purchase?' }],
  baselineOutput: 'Yes, within our 60-day policy.',
  baselineError: null,
  baselineGrades: [
    { grader: 'judge:helpfulness', score: 1, passed: true, rationale: 'Correctly cites the 60-day window.', judgeModel: 'claude-opus-5' },
  ],
  candidateOutput: 'No, refunds are only available within 30 days.',
  candidateError: null,
  candidateGrades: [
    { grader: 'judge:helpfulness', score: 0, passed: false, rationale: 'States an incorrect, more restrictive window.', judgeModel: 'claude-opus-5' },
  ],
};

function mockFetch(handlers: Array<{ test: RegExp; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const handler = handlers.find((h) => h.test.test(url));
      if (!handler) throw new Error(`Unmocked fetch: ${url}`);
      return { ok: true, status: 200, statusText: 'OK', json: async () => handler.body } as Response;
    }),
  );
}

describe('the-case-list-screen-renders-a-real-table-including-an-excluded-case-without-crashing', () => {
  it('shows every case status and never crashes on a null score for an excluded case', async () => {
    mockFetch([{ test: /\/api\/comparisons\/[^/]+\/cases$/, body: caseList }]);
    render(
      <MemoryRouter initialEntries={['/suites/suite-1/comparisons/cmp-1/cases']}>
        <Routes>
          <Route path="/suites/:suiteId/comparisons/:comparisonId/cases" element={<CaseDiff />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('refund-past-window')).toBeInTheDocument());
    expect(screen.getByText('greeting-tone')).toBeInTheDocument();
    expect(screen.getByText('flaky-timeout-case')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(table.tagName).toBe('TABLE');
    // An excluded case (errored on one side) must render its score cells as
    // a plain placeholder, not "0.00" -- §5.1: "never silently scored
    // zero." The row's last two cells are Baseline/Candidate (per the
    // column header order asserted above); both must be the placeholder,
    // never a formatted score.
    const row = within(table).getByText('flaky-timeout-case').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[cells.length - 2]!.textContent).toBe('—');
    expect(cells[cells.length - 1]!.textContent).toBe('—');
  });
});

describe('the-case-detail-screen-shows-baseline-and-candidate-side-by-side-with-judge-rationale', () => {
  it('renders both outputs, both grade tables, and the judge rationale text without crashing', async () => {
    mockFetch([{ test: /\/api\/comparisons\/[^/]+\/cases\/[^/]+$/, body: caseDetail }]);
    render(
      <MemoryRouter initialEntries={['/suites/suite-1/comparisons/cmp-1/cases/refund-past-window']}>
        <Routes>
          <Route path="/suites/:suiteId/comparisons/:comparisonId/cases/:externalId" element={<CaseDiff />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Yes, within our 60-day policy.')).toBeInTheDocument());
    expect(screen.getByText('No, refunds are only available within 30 days.')).toBeInTheDocument();
    expect(screen.getByText(/Correctly cites the 60-day window\./)).toBeInTheDocument();
    expect(screen.getByText(/States an incorrect, more restrictive window\./)).toBeInTheDocument();
  });
});
