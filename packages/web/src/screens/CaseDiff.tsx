/**
 * Screen 3 (§8): "Case diff — baseline and candidate output side by side,
 * per-grader scores, judge rationale." Two views behind one route family:
 * the full case list (regressed/fixed/unchanged/excluded) and, when an
 * `externalId` is present in the URL, a single case's detail.
 */

import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseComparisonStatus, CaseDiffData, CaseGradeDetail, ComparisonCaseListItem } from '@llmreg/core';
import { getCaseDiff, getComparisonCases } from '../api/client.js';
import { AsyncSection } from '../components/AsyncSection.js';
import { Badge } from '../components/Badge.js';
import { RowLink, TBody, THead, Table, Td, Th, Tr } from '../components/Table.js';
import { useApi } from '../hooks/useApi.js';
import { formatScore } from '../format.js';

const STATUS_LABEL: Record<CaseComparisonStatus, string> = {
  regressed: 'Regressed',
  fixed: 'Fixed',
  unchanged: 'Unchanged',
  excluded: 'Excluded',
};

const STATUS_FILTERS: Array<CaseComparisonStatus | 'all'> = ['all', 'regressed', 'fixed', 'unchanged', 'excluded'];

function CaseListScreen({ suiteId, comparisonId }: { suiteId: string; comparisonId: string }) {
  const state = useApi(() => getComparisonCases(comparisonId), [comparisonId]);
  const [filter, setFilter] = useState<CaseComparisonStatus | 'all'>('all');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Cases</h1>
        <Link
          to={`/suites/${suiteId}/comparisons/${comparisonId}`}
          className="text-xs text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Back to comparison
        </Link>
      </div>
      <AsyncSection state={state}>
        {(cases: ComparisonCaseListItem[]) => {
          const filtered = filter === 'all' ? cases : cases.filter((c) => c.status === filter);
          return (
            <>
              <div className="mb-4 flex flex-wrap gap-3 font-mono text-xs">
                {STATUS_FILTERS.map((f) => {
                  const count = f === 'all' ? cases.length : cases.filter((c) => c.status === f).length;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      aria-pressed={filter === f}
                      className={`border-b-2 pb-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                        filter === f ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
                      }`}
                    >
                      {f === 'all' ? 'All' : STATUS_LABEL[f]} ({count})
                    </button>
                  );
                })}
              </div>
              {filtered.length === 0 ? (
                <p className="text-sm text-muted">No cases match this filter.</p>
              ) : (
                <Table caption="Cases: external id, status, critical flag, tags, baseline score, candidate score">
                  <THead>
                    <Tr>
                      <Th>Case</Th>
                      <Th>Status</Th>
                      <Th>Critical</Th>
                      <Th>Tags</Th>
                      <Th align="right">Baseline</Th>
                      <Th align="right">Candidate</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {filtered.map((c) => (
                      <Tr key={c.externalId} emphasized={c.critical}>
                        <Td>
                          <RowLink to={`/suites/${suiteId}/comparisons/${comparisonId}/cases/${encodeURIComponent(c.externalId)}`}>
                            View diff for {c.externalId}
                          </RowLink>
                          <span className="font-mono">{c.externalId}</span>
                        </Td>
                        <Td className="text-sm">{STATUS_LABEL[c.status]}</Td>
                        <Td>{c.critical ? <Badge>critical</Badge> : <span className="text-muted">—</span>}</Td>
                        <Td className="text-xs text-muted">{c.tags.join(', ') || '—'}</Td>
                        <Td align="right" mono>
                          {c.baselineScore === null ? <span className="text-muted">—</span> : formatScore(c.baselineScore)}
                        </Td>
                        <Td align="right" mono>
                          {c.candidateScore === null ? <span className="text-muted">—</span> : formatScore(c.candidateScore)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}

function GradeTable({ title, grades }: { title: string; grades: CaseGradeDetail[] }) {
  if (grades.length === 0) {
    return (
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        <p className="text-sm text-muted">No grades recorded.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <Table caption={`${title}: grader, score, pass/fail, rationale`}>
        <THead>
          <Tr>
            <Th>Grader</Th>
            <Th align="right">Score</Th>
            <Th>Result</Th>
          </Tr>
        </THead>
        <TBody>
          {grades.map((g) => (
            <Fragment key={g.grader}>
              <Tr>
                <Td mono className="text-xs">
                  {g.grader}
                </Td>
                <Td align="right" mono>
                  {formatScore(g.score)}
                </Td>
                <Td className="text-sm">{g.passed ? 'pass' : 'fail'}</Td>
              </Tr>
              {g.rationale && (
                <Tr>
                  <Td colSpan={3} className="text-xs italic text-muted">
                    {g.judgeModel ? `${g.judgeModel}: ` : ''}
                    {g.rationale}
                  </Td>
                </Tr>
              )}
            </Fragment>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function CaseDetailScreen({
  suiteId,
  comparisonId,
  externalId,
}: {
  suiteId: string;
  comparisonId: string;
  externalId: string;
}) {
  const state = useApi(() => getCaseDiff(comparisonId, externalId), [comparisonId, externalId]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-mono text-lg font-semibold">{externalId}</h1>
        <Link
          to={`/suites/${suiteId}/comparisons/${comparisonId}/cases`}
          className="text-xs text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Back to case list
        </Link>
      </div>
      <AsyncSection state={state}>
        {(data: CaseDiffData) => (
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {data.critical && <Badge>critical</Badge>}
              {data.critical && data.criticalReason && <span className="text-xs text-muted">{data.criticalReason}</span>}
              {data.tags.map((tag) => (
                <span key={tag} className="border border-rule px-1.5 py-0 font-mono text-xs text-muted">
                  {tag}
                </span>
              ))}
            </div>

            {data.inputMessages.length > 0 && (
              <section className="mb-6 border-t border-rule pt-4">
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Input</h2>
                <div className="space-y-1.5 text-sm">
                  {data.inputMessages.map((m, i) => (
                    <p key={i}>
                      <span className="mr-1.5 font-mono text-xs text-muted">{m.role}:</span>
                      {m.content}
                    </p>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-6 border-t border-rule pt-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Output</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Baseline</h3>
                  {data.baselineError ? (
                    <p className="border border-ink px-2 py-1.5 text-sm">
                      <span className="font-bold">Error:</span> {data.baselineError}
                    </p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words border border-rule bg-paper px-2 py-1.5 font-mono text-xs">
                      {data.baselineOutput ?? '(no output)'}
                    </pre>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Candidate</h3>
                  {data.candidateError ? (
                    <p className="border border-ink px-2 py-1.5 text-sm">
                      <span className="font-bold">Error:</span> {data.candidateError}
                    </p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words border border-rule bg-paper px-2 py-1.5 font-mono text-xs">
                      {data.candidateOutput ?? '(no output)'}
                    </pre>
                  )}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 border-t border-rule pt-4 sm:grid-cols-2">
              <GradeTable title="Baseline grades" grades={data.baselineGrades} />
              <GradeTable title="Candidate grades" grades={data.candidateGrades} />
            </section>
          </div>
        )}
      </AsyncSection>
    </div>
  );
}

export default function CaseDiff() {
  const { suiteId, comparisonId, externalId } = useParams<{ suiteId: string; comparisonId: string; externalId?: string }>();
  const params = useMemo(() => ({ suiteId, comparisonId, externalId }), [suiteId, comparisonId, externalId]);

  if (!params.suiteId || !params.comparisonId) return <p className="text-sm text-muted">Missing route parameters.</p>;

  return params.externalId ? (
    <CaseDetailScreen suiteId={params.suiteId} comparisonId={params.comparisonId} externalId={params.externalId} />
  ) : (
    <CaseListScreen suiteId={params.suiteId} comparisonId={params.comparisonId} />
  );
}
