/**
 * Screen 2 (§8), the signature screen: "verdict, interval bar, MDE, paired
 * n, methods." Reads top to bottom as verdict -> evidence -> cases ->
 * methods, matching packages/core/src/report/html.ts's structure exactly
 * (same data, same wording, interactive instead of static).
 */

import { useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { ComparisonReportData } from '@llmreg/core';
import { getComparison, getSuiteComparisons } from '../api/client.js';
import { AsyncSection } from '../components/AsyncSection.js';
import { Badge } from '../components/Badge.js';
import { IntervalBar } from '../components/IntervalBar.js';
import { SuiteSubNav } from '../components/Layout.js';
import { TBody, THead, Table, Td, Th, Tr } from '../components/Table.js';
import { useApi } from '../hooks/useApi.js';
import { verdictElaboration, verdictHeadline } from '../copy.js';
import { formatDeltaWithInterval, formatMagnitudePP, formatPercent, formatScore, formatTimestamp } from '../format.js';

const HEADLINE_CLASS: Record<ComparisonReportData['verdict'], string> = {
  regression: 'text-alert font-bold',
  no_detectable_difference: 'text-muted font-normal',
  improvement_detected: 'text-settled font-normal',
  insufficient_data: 'text-muted font-normal',
};

/**
 * The one place the categorical verdict and the pure "does the interval
 * cross zero" bar reading can legitimately disagree -- ported from
 * html.ts's `barDiscrepancyNote`. Only reachable via §5.6's critical-case
 * override.
 */
function barDiscrepancyNote(data: ComparisonReportData): string | null {
  const crossesZero = data.ciLower <= 0 && data.ciUpper >= 0;
  const entirelyBelowZero = data.ciUpper < 0;

  if (data.verdict !== 'regression' || data.criticalRegressed === 0) {
    return data.verdict === 'insufficient_data' && !crossesZero
      ? `The aggregate interval above does not cross zero, but this dataset could not reliably measure an effect at this size — see minimum detectable effect and paired case count below. A confident-looking interval is not a substitute for statistical power.`
      : null;
  }
  const critN = `${data.criticalRegressed} critical case${data.criticalRegressed === 1 ? '' : 's'}`;
  if (crossesZero) {
    return `The aggregate interval above crosses zero; this regression verdict comes from ${critN} failing, not the aggregate trend.`;
  }
  if (!entirelyBelowZero) {
    return `The aggregate interval above sits entirely above zero — the aggregate improved; this regression verdict comes from ${critN} failing regardless.`;
  }
  return null;
}

function ComparisonPicker({ suiteId, currentId }: { suiteId: string; currentId: string }) {
  const state = useApi(() => getSuiteComparisons(suiteId), [suiteId]);
  const navigate = useNavigate();

  if (state.status !== 'ready' || state.data.length <= 1) return null;
  const sorted = [...state.data].sort((a, b) => b.computedAt.localeCompare(a.computedAt));

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Compare a different run
      <select
        value={currentId}
        onChange={(e) => navigate(`/suites/${suiteId}/comparisons/${e.target.value}`)}
        className="border border-rule bg-paper px-1.5 py-0.5 font-mono text-xs text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {sorted.map((c) => (
          <option key={c.id} value={c.id}>
            {formatTimestamp(c.computedAt)} · {c.baselineLabel} → {c.candidateLabel} · {c.verdict} ·{' '}
            {formatDeltaWithInterval(c.delta, c.ciLower, c.ciUpper)}
          </option>
        ))}
      </select>
    </label>
  );
}

function VerdictHeader({ data, suiteId }: { data: ComparisonReportData; suiteId: string }) {
  const discrepancy = useMemo(() => barDiscrepancyNote(data), [data]);
  return (
    <header className="mb-6 border-b border-rule pb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted">
          {data.suiteName} · <span className="tabular-nums">{data.comparisonId}</span>
        </p>
        <ComparisonPicker suiteId={suiteId} currentId={data.comparisonId} />
      </div>
      <h1 className={`mb-1.5 text-xl ${HEADLINE_CLASS[data.verdict]}`}>{verdictHeadline(data)}</h1>
      <p className="mb-4 text-sm text-ink">{verdictElaboration(data)}</p>
      <IntervalBar delta={data.delta} ciLower={data.ciLower} ciUpper={data.ciUpper} />
      {discrepancy && <p className="mt-3 text-xs italic text-muted">{discrepancy}</p>}
    </header>
  );
}

function EvidenceSection({ data }: { data: ComparisonReportData }) {
  const mdeText = Number.isFinite(data.mde) ? formatMagnitudePP(data.mde) : 'undefined — zero paired cases';
  return (
    <section className="mb-6 border-t border-rule pt-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Evidence</h2>
      <dl className="mb-4 divide-y divide-rule text-sm">
        <div className="flex justify-between py-1.5">
          <dt className="text-muted">Paired cases</dt>
          <dd className="font-mono tabular-nums">
            {data.pairedCaseCount} ({data.excludedCount} excluded)
          </dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-muted">Minimum detectable effect</dt>
          <dd className="font-mono tabular-nums">{mdeText}</dd>
        </div>
      </dl>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Judge calibration</h3>
      {data.judgeCalibrations.length === 0 ? (
        <p className="text-sm text-muted">No judge:* graders used in this suite.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.judgeCalibrations.map((jc) => (
            <li key={jc.grader} className="flex flex-wrap items-center gap-1.5 text-sm">
              <code className="font-mono text-xs">{jc.grader}</code>
              {jc.status === 'passing' ? (
                <span className="font-mono tabular-nums">
                  passing (κ={jc.cohensKappa.toFixed(2)}, n={jc.labelCount})
                </span>
              ) : (
                <>
                  <Badge>failing calibration</Badge>
                  <span className="font-mono tabular-nums text-muted">
                    κ={jc.cohensKappa.toFixed(2)}, n={jc.labelCount}
                  </span>
                  <span className="text-muted">— scores from this judge are advisory only and did not drive this verdict.</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CasesSection({ data, suiteId }: { data: ComparisonReportData; suiteId: string }) {
  const { regressedCases, fixedCases } = data;
  return (
    <section className="mb-6 border-t border-rule pt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Regressed cases</h2>
        <Link
          to={`/suites/${suiteId}/comparisons/${data.comparisonId}/cases`}
          className="text-xs text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          View full case list ({data.pairedCaseCount + data.excludedCount} cases)
        </Link>
      </div>
      {regressedCases.length === 0 ? (
        <p className="text-sm text-muted">No cases regressed.</p>
      ) : (
        <Table caption="Regressed cases: case id, critical flag, baseline score, candidate score">
          <THead>
            <Tr>
              <Th>Case</Th>
              <Th>Critical</Th>
              <Th align="right">Baseline</Th>
              <Th align="right">Candidate</Th>
            </Tr>
          </THead>
          <TBody>
            {regressedCases.map((c) => (
              <Tr key={c.externalId} emphasized={c.critical}>
                <Td className="relative">
                  <Link
                    to={`/suites/${suiteId}/comparisons/${data.comparisonId}/cases/${encodeURIComponent(c.externalId)}`}
                    className="absolute inset-0 z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
                  >
                    <span className="sr-only">View diff for {c.externalId}</span>
                  </Link>
                  <span className="font-mono">{c.externalId}</span>
                </Td>
                <Td>{c.critical ? <Badge>critical</Badge> : <span className="text-muted">—</span>}</Td>
                <Td align="right" mono>
                  {formatScore(c.baselineScore)}
                </Td>
                <Td align="right" mono>
                  {formatScore(c.candidateScore)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <details className="mt-5 border-t border-rule pt-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          Fixed cases ({fixedCases.length})
        </summary>
        {fixedCases.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No cases fixed.</p>
        ) : (
          <div className="mt-2">
            <Table caption="Fixed cases: case id, baseline score, candidate score">
              <THead>
                <Tr>
                  <Th>Case</Th>
                  <Th align="right">Baseline</Th>
                  <Th align="right">Candidate</Th>
                </Tr>
              </THead>
              <TBody>
                {fixedCases.map((c) => (
                  <Tr key={c.externalId}>
                    <Td mono>{c.externalId}</Td>
                    <Td align="right" mono>
                      {formatScore(c.baselineScore)}
                    </Td>
                    <Td align="right" mono>
                      {formatScore(c.candidateScore)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </details>
    </section>
  );
}

function MethodsSection({ data }: { data: ComparisonReportData }) {
  const { methods } = data;
  const testLabel =
    methods.bootstrapIterations !== null ? `${methods.test} (${methods.bootstrapIterations} iterations)` : methods.test;

  const rows: Array<[string, string]> = [
    ['Test', testLabel],
    ['Suite', data.suiteName],
    ['Comparison id', data.comparisonId],
    ['Computed at', formatTimestamp(data.computedAt)],
    [
      'Baseline',
      `${methods.baselineLabel} · ${methods.baselineModel} · prompt ${methods.baselinePromptHash} · cache ${formatPercent(methods.baselineCacheHitRate)}`,
    ],
    [
      'Candidate',
      `${methods.candidateLabel} · ${methods.candidateModel} · prompt ${methods.candidatePromptHash} · cache ${formatPercent(methods.candidateCacheHitRate)}`,
    ],
  ];

  return (
    <details className="border-t border-rule pt-5">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        Methods
      </summary>
      <dl className="mt-2 divide-y divide-rule text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:justify-between sm:gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-xs tabular-nums sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default function Comparison() {
  const { suiteId, comparisonId } = useParams<{ suiteId: string; comparisonId: string }>();
  const listState = useApi(() => (suiteId ? getSuiteComparisons(suiteId) : Promise.resolve([])), [suiteId]);
  const detailState = useApi(() => (comparisonId ? getComparison(comparisonId) : Promise.reject(new Error('missing comparisonId'))), [
    comparisonId,
  ]);

  if (!suiteId) return <p className="text-sm text-muted">Missing suite.</p>;

  // No comparisonId in the URL: redirect to the most recent comparison for
  // this suite once the list has loaded, per "a comparison picker/list for
  // the suite" -- landing on /comparisons should show something, not force
  // a blank picker first.
  if (!comparisonId) {
    if (listState.status === 'loading') return <p className="font-mono text-sm text-muted">Loading…</p>;
    if (listState.status === 'error') {
      return <p className="border border-rule px-3 py-2 font-mono text-sm text-ink">Could not load this screen: {listState.error.message}</p>;
    }
    if (listState.data.length === 0) {
      return (
        <div>
          <SuiteSubNav suiteId={suiteId} active="comparisons" />
          <p className="text-sm text-muted">No comparisons yet for this suite. Run `llmreg compare` to produce one.</p>
        </div>
      );
    }
    const latest = [...listState.data].sort((a, b) => b.computedAt.localeCompare(a.computedAt))[0]!;
    return <Navigate to={`/suites/${suiteId}/comparisons/${latest.id}`} replace />;
  }

  return (
    <div>
      <SuiteSubNav suiteId={suiteId} active="comparisons" />
      <AsyncSection state={detailState}>
        {(data: ComparisonReportData) => (
          <>
            <VerdictHeader data={data} suiteId={suiteId} />
            <EvidenceSection data={data} />
            <CasesSection data={data} suiteId={suiteId} />
            <MethodsSection data={data} />
          </>
        )}
      </AsyncSection>
    </div>
  );
}
