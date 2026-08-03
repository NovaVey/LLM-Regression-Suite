/**
 * Screen 1 (§8): "Suites — cases, last run, judge calibration status and
 * age." The entry point into every other screen.
 */

import type { SuiteCalibrationSummary, SuiteListItem } from '@llmreg/core';
import { getSuites } from '../api/client.js';
import { AsyncSection } from '../components/AsyncSection.js';
import { Badge } from '../components/Badge.js';
import { RowLink, TBody, THead, Table, Td, Th, Tr } from '../components/Table.js';
import { useApi } from '../hooks/useApi.js';
import { formatTimestamp } from '../format.js';

function formatAgeDays(ageDays: number): string {
  if (ageDays < 1) return '<1 day';
  const rounded = Math.round(ageDays * 10) / 10;
  return `${rounded.toFixed(1)} days`;
}

function CalibrationCell({ calibrations }: { calibrations: SuiteCalibrationSummary[] }) {
  if (calibrations.length === 0) {
    return <span className="text-sm text-muted">No judge graders</span>;
  }
  return (
    <ul className="space-y-1">
      {calibrations.map((c) => (
        <li key={c.grader} className="flex flex-wrap items-center gap-1.5 text-sm">
          <code className="font-mono text-xs">{c.grader}</code>
          {c.status === 'passing' && c.cohensKappa !== null && (
            <span className="font-mono tabular-nums text-ink">
              κ={c.cohensKappa.toFixed(2)}
              {c.ageDays !== null ? `, ${formatAgeDays(c.ageDays)} old` : ''}
            </span>
          )}
          {c.status === 'failing' && (
            <>
              <Badge>failing calibration</Badge>
              {c.cohensKappa !== null && <span className="font-mono tabular-nums text-muted">κ={c.cohensKappa.toFixed(2)}</span>}
            </>
          )}
          {c.status === 'missing' && <Badge>uncalibrated</Badge>}
        </li>
      ))}
    </ul>
  );
}

export default function Suites() {
  const state = useApi(() => getSuites(), []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Suites</h1>
      <p className="mb-6 text-sm text-muted">Every suite this API knows about, with its last run and judge calibration status.</p>
      <AsyncSection state={state}>
        {(suites: SuiteListItem[]) =>
          suites.length === 0 ? (
            <p className="text-sm text-muted">No suites yet. Run `llmreg init` and `llmreg compare` to produce one.</p>
          ) : (
            <Table caption="Suites, case counts, last run status, and judge calibration status">
              <THead>
                <Tr>
                  <Th>Suite</Th>
                  <Th align="right">Cases</Th>
                  <Th>Last run</Th>
                  <Th>Judge calibration</Th>
                </Tr>
              </THead>
              <TBody>
                {suites.map((suite) => (
                  <Tr key={suite.id}>
                    <Td>
                      <RowLink to={`/suites/${suite.id}/comparisons`}>{suite.name} suite details</RowLink>
                      <span className="font-semibold">{suite.name}</span>
                      {suite.description && <span className="block text-xs text-muted">{suite.description}</span>}
                    </Td>
                    <Td align="right" mono>
                      {suite.caseCount}
                    </Td>
                    <Td mono className="text-xs">
                      {suite.lastRun ? (
                        <>
                          {suite.lastRun.status}
                          <span className="text-muted"> · {suite.lastRun.trigger}</span>
                          {suite.lastRun.finishedAt && (
                            <span className="block text-muted">{formatTimestamp(suite.lastRun.finishedAt)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">never run</span>
                      )}
                    </Td>
                    <Td>
                      <CalibrationCell calibrations={suite.calibrations} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )
        }
      </AsyncSection>
    </div>
  );
}
