// @vitest-environment jsdom
//
// Written from .claude/commands/build-llm-regression-suite.md §8 ("Dataset
// — cases, tags, critical flags, coverage gaps by tag") and
// packages/core/src/web/types.ts's DatasetOverview/TagCoverage shapes,
// WITHOUT reading Dataset.tsx's render body first.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DatasetOverview } from '@llmreg/core';
import Dataset from './Dataset.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response),
  );
}

const fixture: DatasetOverview = {
  suiteId: 'suite-1',
  suiteName: 'support-agent',
  minPairedN: 20,
  criticalCount: 1,
  cases: [
    { externalId: 'refund-past-window', tags: ['refunds'], critical: true, criticalReason: 'refund-eligibility edge case' },
    { externalId: 'greeting-tone', tags: ['tone'], critical: false, criticalReason: null },
  ],
  tagCoverage: [
    { tag: 'refunds', caseCount: 30, isGap: false },
    { tag: 'safety', caseCount: 4, isGap: true },
  ],
};

describe('the-dataset-screen-renders-case-and-tag-coverage-tables-without-crashing', () => {
  it('shows every case, its critical flag, and a coverage gap warning that is never colored alert', async () => {
    mockFetch(fixture);
    const { container } = render(
      <MemoryRouter initialEntries={['/suites/suite-1/dataset']}>
        <Routes>
          <Route path="/suites/:suiteId/dataset" element={<Dataset />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('refund-past-window')).toBeInTheDocument());
    expect(screen.getByText('greeting-tone')).toBeInTheDocument();
    expect(screen.getByText('refund-eligibility edge case')).toBeInTheDocument();
    expect(screen.getByText('coverage gap')).toBeInTheDocument();
    expect(screen.getByText(/too few cases to trust a tag-specific finding/)).toBeInTheDocument();

    // §5's discipline extends to the dataset screen's own module comment:
    // a coverage gap is a warning about the dataset, not a verdict, and
    // must never carry the alert color reserved for `regression`.
    expect(container.innerHTML).not.toMatch(/-alert\b/);
  });

  it('renders two real tables (tag coverage and cases), not div soup', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter initialEntries={['/suites/suite-1/dataset']}>
        <Routes>
          <Route path="/suites/:suiteId/dataset" element={<Dataset />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByRole('table').length).toBe(2));
    for (const table of screen.getAllByRole('table')) {
      expect(table.tagName).toBe('TABLE');
    }
  });
});
