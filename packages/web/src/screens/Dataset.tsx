/**
 * Screen 5 (§8): "Dataset — cases, tags, critical flags, coverage gaps by
 * tag." A coverage gap (§4's `isGap`) is a warning about the dataset, not
 * a verdict about a change -- rendered informational/muted, never in the
 * alert color, same discipline as `insufficient_data`.
 */

import { useParams } from 'react-router-dom';
import type { TagCoverage } from '@llmreg/core';
import { getSuiteDataset } from '../api/client.js';
import { AsyncSection } from '../components/AsyncSection.js';
import { Badge } from '../components/Badge.js';
import { SuiteSubNav } from '../components/Layout.js';
import { TBody, THead, Table, Td, Th, Tr } from '../components/Table.js';
import { useApi } from '../hooks/useApi.js';

function TagCoverageRow({ coverage }: { coverage: TagCoverage }) {
  return (
    <Tr>
      <Td mono className="text-xs">
        {coverage.tag}
      </Td>
      <Td align="right" mono>
        {coverage.caseCount}
      </Td>
      <Td>
        {coverage.isGap ? (
          <span className="text-xs text-muted">
            <Badge className="mr-1.5">coverage gap</Badge>
            too few cases to trust a tag-specific finding
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </Td>
    </Tr>
  );
}

export default function Dataset() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const state = useApi(() => (suiteId ? getSuiteDataset(suiteId) : Promise.reject(new Error('missing suiteId'))), [
    suiteId,
  ]);

  if (!suiteId) return <p className="text-sm text-muted">Missing suite.</p>;

  return (
    <div>
      <SuiteSubNav suiteId={suiteId} active="dataset" />
      <AsyncSection state={state}>
        {(data) => (
          <div>
            <h1 className="mb-1 text-lg font-semibold">{data.suiteName} — Dataset</h1>
            <p className="mb-6 font-mono text-sm text-muted tabular-nums">
              {data.cases.length} cases · {data.criticalCount} critical · paired-n floor {data.minPairedN}
            </p>

            <section className="mb-8">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Tag coverage</h2>
              {data.tagCoverage.length === 0 ? (
                <p className="text-sm text-muted">No tags recorded.</p>
              ) : (
                <Table caption="Tag coverage: tag, case count, coverage gap flag">
                  <THead>
                    <Tr>
                      <Th>Tag</Th>
                      <Th align="right">Cases</Th>
                      <Th>Note</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {data.tagCoverage.map((tc) => (
                      <TagCoverageRow key={tc.tag} coverage={tc} />
                    ))}
                  </TBody>
                </Table>
              )}
            </section>

            <section className="border-t border-rule pt-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Cases</h2>
              <Table caption="Cases: external id, tags, critical flag, critical reason">
                <THead>
                  <Tr>
                    <Th>Case</Th>
                    <Th>Tags</Th>
                    <Th>Critical</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.cases.map((c) => (
                    <Tr key={c.externalId} emphasized={c.critical}>
                      <Td mono>{c.externalId}</Td>
                      <Td className="text-xs text-muted">{c.tags.join(', ') || '—'}</Td>
                      <Td>
                        {c.critical ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge>critical</Badge>
                            {c.criticalReason && <span className="text-xs text-muted">{c.criticalReason}</span>}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </section>
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
