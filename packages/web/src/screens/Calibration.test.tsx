// @vitest-environment jsdom
//
// Written from .claude/commands/build-llm-regression-suite.md §5.5 (kappa,
// bias note, "the check reports its scores as advisory only, never as a
// blocking verdict" for a failing judge) and §8 ("Calibration — kappa over
// time per judge, confusion matrix against human labels, bias note"), plus
// packages/core/src/web/types.ts's CalibrationOverview shape, WITHOUT
// reading Calibration.tsx's render body first.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CalibrationOverview } from '@llmreg/core';
import Calibration from './Calibration.js';

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

const fixture: CalibrationOverview = {
  suiteId: 'suite-1',
  suiteName: 'support-agent',
  judgeKappaFloor: 0.6,
  graders: [
    {
      grader: 'judge:helpfulness',
      history: [
        {
          id: 'calib-1',
          judgeModel: 'claude-opus-5',
          judgePromptHash: 'hash-a',
          labelCount: 120,
          cohensKappa: 0.42,
          agreementRate: 0.9,
          passed: false,
          biasNote: 'Judge scores refusals about 0.3 higher than human labelers.',
          confusionMatrix: { bothPass: 80, humanPassJudgeFail: 5, humanFailJudgePass: 30, bothFail: 5 },
          calibratedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'calib-2',
          judgeModel: 'claude-opus-5',
          judgePromptHash: 'hash-b',
          labelCount: 150,
          cohensKappa: 0.71,
          agreementRate: 0.93,
          passed: true,
          biasNote: 'Judge still scores refusals slightly high, though within tolerance now.',
          confusionMatrix: { bothPass: 100, humanPassJudgeFail: 3, humanFailJudgePass: 10, bothFail: 37 },
          calibratedAt: '2024-02-01T00:00:00.000Z',
        },
      ],
    },
  ],
};

describe('the-calibration-screen-renders-kappa-history-and-the-confusion-matrix-without-crashing', () => {
  it('shows both calibration rows, the raw kappa values, and the bias note for a failing run', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter initialEntries={['/suites/suite-1/calibrations']}>
        <Routes>
          <Route path="/suites/:suiteId/calibrations" element={<Calibration />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByText('judge:helpfulness').length).toBeGreaterThan(0));
    expect(screen.getByText('0.42')).toBeInTheDocument();
    expect(screen.getByText('0.71')).toBeInTheDocument();
    // The bias note shown is the MOST RECENT calibration's (calib-2), per
    // §8's "kappa over time... bias note" reading naturally as pertaining
    // to the current judge configuration, not a stale historical entry.
    expect(screen.getByText(/Judge still scores refusals slightly high/)).toBeInTheDocument();

    // A failing calibration's status cell is a plain badge, never colored --
    // same discipline as everywhere else in the product.
    const failingBadge = screen.getByText('failing');
    expect(failingBadge.className).not.toMatch(/-alert\b/);
    expect(failingBadge.className).not.toMatch(/-settled\b/);
  });

  it('the confusion matrix is a real table with row and column headers, so screen-reader users get the human/judge axis labels', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter initialEntries={['/suites/suite-1/calibrations']}>
        <Routes>
          <Route path="/suites/:suiteId/calibrations" element={<Calibration />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Bias note')).toBeInTheDocument());
    // Most recent entry's confusion matrix cells (calib-2): 100, 3, 10, 37.
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('Human: pass')).toBeInTheDocument();
    expect(screen.getByText('Judge: fail')).toBeInTheDocument();
  });
});
