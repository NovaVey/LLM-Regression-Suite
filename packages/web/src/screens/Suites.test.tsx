// @vitest-environment jsdom
//
// Written from .claude/commands/build-llm-regression-suite.md §8 ("Suites —
// cases, last run, judge calibration status and age" and the quality floor:
// "tables keyboard-navigable") and packages/core/src/web/types.ts's
// SuiteListItem/SuiteCalibrationSummary shapes, WITHOUT reading Suites.tsx's
// render body first.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SuiteListItem } from '@llmreg/core';
import Suites from './Suites.js';

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

const fixture: SuiteListItem[] = [
  {
    id: 'suite-1',
    name: 'support-agent',
    description: '240-case support agent suite',
    caseCount: 240,
    lastRun: { id: 'run-1', trigger: 'ci', status: 'complete', finishedAt: '2024-01-15T10:30:00.000Z' },
    calibrations: [{ grader: 'judge:helpfulness', status: 'missing', cohensKappa: null, calibratedAt: null, ageDays: null }],
  },
  {
    id: 'suite-2',
    name: 'refund-flow',
    description: null,
    caseCount: 80,
    lastRun: null,
    calibrations: [],
  },
];

describe('the-suites-screen-renders-a-real-keyboard-navigable-table-from-a-realistic-api-response', () => {
  it('renders without crashing and shows every suite name and case count', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter>
        <Suites />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('support-agent')).toBeInTheDocument());
    expect(screen.getByText('refund-flow')).toBeInTheDocument();
    expect(screen.getByText('240')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('uses a real <table> with <th scope="col"> column headers and a real focusable link per row, not div soup', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter>
        <Suites />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('support-agent')).toBeInTheDocument());

    const table = screen.getByRole('table');
    expect(table.tagName).toBe('TABLE');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThanOrEqual(4);
    for (const header of headers) {
      expect(header.tagName).toBe('TH');
      expect(header.getAttribute('scope')).toBe('col');
    }

    const rows = within(table).getAllByRole('row');
    // header row + 2 data rows
    expect(rows.length).toBe(3);

    // Each data row is reachable via a single real, focusable link (the
    // stretched-link pattern) -- not a <div onClick>.
    const link = screen.getByRole('link', { name: /support-agent suite details/i });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href');
  });

  it('an uncalibrated judge renders a plain typographic badge, never the alert or settled color', async () => {
    mockFetch(fixture);
    const { container } = render(
      <MemoryRouter>
        <Suites />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('uncalibrated')).toBeInTheDocument());
    // Badge.tsx's whole reason to exist (§5.9's "loud, never colored"
    // discipline) -- assert against the rendered output, not the component
    // module: no element carrying "uncalibrated" is colored alert/settled.
    const badge = screen.getByText('uncalibrated');
    expect(badge.className).not.toMatch(/-alert\b/);
    expect(badge.className).not.toMatch(/-settled\b/);
  });

  it('a suite that has never run says so plainly instead of showing a blank cell', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter>
        <Suites />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('never run')).toBeInTheDocument());
  });
});
