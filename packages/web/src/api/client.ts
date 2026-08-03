/**
 * Typed fetch wrappers for every route packages/api/src/server.ts exposes.
 *
 * Type-only imports from '@llmreg/core' -- see format.ts's module comment
 * for why this package can never take a runtime (value) import from that
 * barrel. Every shape here is exactly the HTTP response shape the API
 * already returns (packages/core/src/web/types.ts, packages/core/src/
 * report/types.ts), never redeclared.
 */

import type {
  CalibrationOverview,
  CaseDiffData,
  ComparisonCaseListItem,
  ComparisonListItem,
  ComparisonReportData,
  DatasetOverview,
  SimulationsOverview,
  SuiteListItem,
} from '@llmreg/core';

const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

/**
 * 404s (and any other non-2xx status) return `{ error: string }` per the
 * server contract -- surface that message on the thrown Error rather than
 * a generic "request failed," since it's usually the most actionable text
 * available (e.g. "Judge helpfulness has no passing calibration...").
 */
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === 'string' && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // Response body wasn't JSON (or was empty) -- fall back to the
      // status line already captured above.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function getSuites(): Promise<SuiteListItem[]> {
  return fetchJson<SuiteListItem[]>('/api/suites');
}

export function getSuiteComparisons(suiteId: string): Promise<ComparisonListItem[]> {
  return fetchJson<ComparisonListItem[]>(`/api/suites/${encodeURIComponent(suiteId)}/comparisons`);
}

export function getSuiteDataset(suiteId: string): Promise<DatasetOverview> {
  return fetchJson<DatasetOverview>(`/api/suites/${encodeURIComponent(suiteId)}/dataset`);
}

export function getSuiteCalibrations(suiteId: string): Promise<CalibrationOverview> {
  return fetchJson<CalibrationOverview>(`/api/suites/${encodeURIComponent(suiteId)}/calibrations`);
}

export function getComparison(comparisonId: string): Promise<ComparisonReportData> {
  return fetchJson<ComparisonReportData>(`/api/comparisons/${encodeURIComponent(comparisonId)}`);
}

export function getComparisonCases(comparisonId: string): Promise<ComparisonCaseListItem[]> {
  return fetchJson<ComparisonCaseListItem[]>(`/api/comparisons/${encodeURIComponent(comparisonId)}/cases`);
}

export function getCaseDiff(comparisonId: string, externalId: string): Promise<CaseDiffData> {
  return fetchJson<CaseDiffData>(
    `/api/comparisons/${encodeURIComponent(comparisonId)}/cases/${encodeURIComponent(externalId)}`,
  );
}

export function getSimulations(): Promise<SimulationsOverview> {
  return fetchJson<SimulationsOverview>('/api/simulations');
}

/** Absolute URL for the pairing-benefit SVG -- used directly as an <img src>, not fetched as JSON. */
export function pairingBenefitChartUrl(): string {
  return `${API_BASE_URL}/api/simulations/pairing-benefit-chart.svg`;
}

export { API_BASE_URL };
