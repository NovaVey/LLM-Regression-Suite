/**
 * Screen 4 (§8): "Calibration — kappa over time per judge, confusion
 * matrix against human labels, bias note."
 */

import { useParams } from 'react-router-dom';
import type { CalibrationHistoryEntry, GraderCalibrationOverview } from '@llmreg/core';
import { getSuiteCalibrations } from '../api/client.js';
import { AsyncSection } from '../components/AsyncSection.js';
import { Badge } from '../components/Badge.js';
import { SuiteSubNav } from '../components/Layout.js';
import { TBody, THead, Table, Td, Th, Tr } from '../components/Table.js';
import { useApi } from '../hooks/useApi.js';
import { formatTimestamp } from '../format.js';

function ConfusionMatrix({ entry }: { entry: CalibrationHistoryEntry }) {
  const { bothPass, humanPassJudgeFail, humanFailJudgePass, bothFail } = entry.confusionMatrix;
  return (
    <table className="w-fit border-collapse text-sm">
      <caption className="sr-only">Confusion matrix: human label vs judge label, most recent calibration</caption>
      <thead>
        <tr>
          <th scope="col" className="px-2.5 py-1.5" />
          <th scope="col" className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Judge: pass
          </th>
          <th scope="col" className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Judge: fail
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-rule">
          <th scope="row" className="px-2.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            Human: pass
          </th>
          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{bothPass}</td>
          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{humanPassJudgeFail}</td>
        </tr>
        <tr className="border-t border-rule">
          <th scope="row" className="px-2.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            Human: fail
          </th>
          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{humanFailJudgePass}</td>
          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{bothFail}</td>
        </tr>
      </tbody>
    </table>
  );
}

function GraderSection({ grader, judgeKappaFloor }: { grader: GraderCalibrationOverview; judgeKappaFloor: number }) {
  const latest = grader.history[grader.history.length - 1];
  return (
    <section className="mb-8 border-t border-rule pt-5">
      <h2 className="mb-1 font-mono text-sm font-semibold">{grader.grader}</h2>
      <p className="mb-3 text-xs text-muted">Suite floor: κ ≥ {judgeKappaFloor.toFixed(2)}</p>

      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Kappa over time</h3>
      <Table caption={`${grader.grader}: calibration history, oldest first`}>
        <THead>
          <Tr>
            <Th>Calibrated at</Th>
            <Th align="right">κ</Th>
            <Th align="right">Agreement</Th>
            <Th align="right">Labels</Th>
            <Th>Status</Th>
          </Tr>
        </THead>
        <TBody>
          {grader.history.map((entry) => (
            <Tr key={entry.id}>
              <Td mono className="text-xs">
                {formatTimestamp(entry.calibratedAt)}
              </Td>
              <Td align="right" mono>
                {entry.cohensKappa.toFixed(2)}
              </Td>
              <Td align="right" mono>
                {(entry.agreementRate * 100).toFixed(0)}%
              </Td>
              <Td align="right" mono>
                {entry.labelCount}
              </Td>
              <Td>{entry.passed ? <span className="text-sm">passing</span> : <Badge>failing</Badge>}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {latest && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Confusion matrix (most recent)
            </h3>
            <ConfusionMatrix entry={latest} />
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Bias note</h3>
            <p className="text-sm">{latest.biasNote ?? <span className="text-muted">No systematic bias recorded.</span>}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Calibration() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const state = useApi(() => (suiteId ? getSuiteCalibrations(suiteId) : Promise.reject(new Error('missing suiteId'))), [
    suiteId,
  ]);

  if (!suiteId) return <p className="text-sm text-muted">Missing suite.</p>;

  return (
    <div>
      <SuiteSubNav suiteId={suiteId} active="calibrations" />
      <AsyncSection state={state}>
        {(data) => (
          <div>
            <h1 className="mb-1 text-lg font-semibold">{data.suiteName} — Calibration</h1>
            <p className="mb-4 text-sm text-muted">
              An uncalibrated or failing-calibration judge cannot produce a blocking verdict; its scores are advisory only.
            </p>
            {data.graders.length === 0 ? (
              <p className="text-sm text-muted">No judge:* graders configured for this suite.</p>
            ) : (
              data.graders.map((g) => <GraderSection key={g.grader} grader={g} judgeKappaFloor={data.judgeKappaFloor} />)
            )}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
