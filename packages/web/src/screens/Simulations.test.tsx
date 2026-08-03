// @vitest-environment jsdom
//
// Written from .claude/commands/build-llm-regression-suite.md §6 (the five
// validations: null model, power curve, MDE validation, pairing benefit)
// and §8 ("Simulations — null model rate, power curve grid, MDE
// validation"), plus packages/core/src/web/types.ts's SimulationsOverview
// shape and the individual simulation Result types, WITHOUT reading
// Simulations.tsx's render body first.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SimulationsOverview } from '@llmreg/core';
import Simulations from './Simulations.js';

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

const fixture: SimulationsOverview = {
  nullModel: {
    trials: 1000,
    alpha: 0.05,
    regressionCount: 24,
    regressionRate: 0.024,
    regressionRateTarget: 0.025,
    regressionRateStandardError: 0.005,
    regressionRateWithinTolerance: true,
    improvementCount: 25,
    improvementRate: 0.025,
    combinedRate: 0.049,
    combinedRateStandardError: 0.007,
    combinedRateWithinTolerance: true,
  },
  powerCurve: {
    cells: [
      { effectSize: 0.01, sampleSize: 20, trials: 200, detections: 12, detectionRate: 0.06 },
      { effectSize: 0.2, sampleSize: 20, trials: 200, detections: 190, detectionRate: 0.95 },
    ],
  },
  pairingBenefit: {
    n: 100,
    effectSize: 0.05,
    trials: 500,
    pairedDetectionRate: 0.82,
    unpairedDetectionRate: 0.31,
  },
  mdeValidation: {
    allWithinTolerance: true,
    cells: [{ sampleSize: 100, reportedMde: 0.08, empiricalMde: 0.079, withinTolerance: true }],
  },
  hasPairingBenefitChart: true,
};

describe('the-simulations-screen-renders-every-phase-6-result-without-crashing', () => {
  it('shows the null model rate, the power curve grid, MDE validation, and the pairing-benefit numbers', async () => {
    mockFetch(fixture);
    render(
      <MemoryRouter>
        <Simulations />
      </MemoryRouter>,
    );

    // §12: the null model result is the headline claim of the whole repo --
    // it must be present, not buried behind a loading state forever.
    await waitFor(() => expect(screen.getByText(/1000 trials/)).toBeInTheDocument());
    // regressionRate, independently: 0.024 * 100 = 2.40 -- rendered inline
    // within a longer sentence ("2.40% (target ≈ ..., within tolerance)"),
    // so match on the substring rather than the whole element's text.
    expect(screen.getByText(/2\.40%/)).toBeInTheDocument();
    expect(screen.getAllByText(/within tolerance/).length).toBeGreaterThan(0);

    expect(screen.getByText('95.00%')).toBeInTheDocument(); // detectionRate for the 0.2 effect size cell
    expect(screen.getByText('82.00%')).toBeInTheDocument(); // pairedDetectionRate
    expect(screen.getByText('31.00%')).toBeInTheDocument(); // unpairedDetectionRate
  });

  it('renders a "not yet run" message instead of crashing when a simulation result is null', async () => {
    mockFetch({ ...fixture, nullModel: null, powerCurve: null, mdeValidation: null, hasPairingBenefitChart: false });
    render(
      <MemoryRouter>
        <Simulations />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/No null-model results yet/)).toBeInTheDocument());
    expect(screen.getByText(/No power-curve results yet/)).toBeInTheDocument();
    expect(screen.getByText(/No MDE validation results yet/)).toBeInTheDocument();
  });
});
