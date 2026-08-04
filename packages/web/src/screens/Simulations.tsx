/**
 * Screen 6 (§8): "Simulations — null model rate, power curve grid, MDE
 * validation." Not suite-scoped -- reads simulations/results/*.json
 * directly, same as the API route.
 *
 * Null model: reports BOTH `regressionRate` (the one-sided rate that
 * actually fails the CI check under a true null) and `combinedRate` (the
 * two-sided rate the README's plain-language "~5%" claim is closest to) --
 * see null-model.ts's module comment for why these are two different,
 * both-correct numbers rather than a single figure.
 */

import type { NullModelResult, PowerCurveCell } from '@llmreg/core';
import { getSimulations, pairingBenefitChartUrl } from '../api/client.js';
import { AsyncSection } from '../components/AsyncSection.js';
import { TBody, THead, Table, Td, Th, Tr } from '../components/Table.js';
import { useApi } from '../hooks/useApi.js';
import { formatMagnitudePP } from '../format.js';

function formatRatePct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function NullModelSection({ nullModel }: { nullModel: NullModelResult }) {
  return (
    <section className="mb-8 border-t border-rule pt-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Null model — {nullModel.trials} trials, two identical variants
      </h2>
      <dl className="divide-y divide-rule text-sm">
        <div className="flex justify-between py-1.5">
          <dt className="text-muted">Regression rate (one-sided — what actually fails the check)</dt>
          <dd className="font-mono tabular-nums">
            {formatRatePct(nullModel.regressionRate)} (target ≈ {formatRatePct(nullModel.regressionRateTarget)},{' '}
            {nullModel.regressionRateWithinTolerance ? 'within tolerance' : 'OUT OF TOLERANCE'})
          </dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-muted">Improvement rate (one-sided, symmetric tail)</dt>
          <dd className="font-mono tabular-nums">{formatRatePct(nullModel.improvementRate)}</dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-muted">Combined rate (two-sided — CI excluded zero at all, α={nullModel.alpha})</dt>
          <dd className="font-mono tabular-nums">
            {formatRatePct(nullModel.combinedRate)} ({nullModel.combinedRateWithinTolerance ? 'within tolerance' : 'OUT OF TOLERANCE'})
          </dd>
        </div>
      </dl>
    </section>
  );
}

function PowerCurveSection({ cells }: { cells: PowerCurveCell[] }) {
  const effectSizes = Array.from(new Set(cells.map((c) => c.effectSize))).sort((a, b) => a - b);
  const sampleSizes = Array.from(new Set(cells.map((c) => c.sampleSize))).sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [`${c.effectSize}|${c.sampleSize}`, c]));

  return (
    <section className="mb-8 border-t border-rule pt-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Power curve — detection rate by effect size × sample size</h2>
      <Table caption="Power curve grid: detection rate at each effect size and sample size">
        <THead>
          <Tr>
            <Th>Effect size</Th>
            {sampleSizes.map((n) => (
              <Th key={n} align="right">
                n={n}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {effectSizes.map((es) => (
            <Tr key={es}>
              <Td mono>{formatMagnitudePP(es)}</Td>
              {sampleSizes.map((n) => {
                const cell = byKey.get(`${es}|${n}`);
                return (
                  <Td key={n} align="right" mono>
                    {cell ? formatRatePct(cell.detectionRate) : '—'}
                  </Td>
                );
              })}
            </Tr>
          ))}
        </TBody>
      </Table>
    </section>
  );
}

export default function Simulations() {
  const state = useApi(() => getSimulations(), []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Simulations</h1>
      <p className="mb-6 text-sm text-muted">
        The evidence behind every statistical claim this tool makes, per §6 — this is what makes the rest of the product
        credible.
      </p>
      <AsyncSection state={state}>
        {(data) => (
          <>
            {data.nullModel ? (
              <NullModelSection nullModel={data.nullModel} />
            ) : (
              <p className="border-t border-rule pt-5 text-sm text-muted">
                No null-model results yet. Run `llmreg simulate null` first.
              </p>
            )}

            {data.powerCurve ? (
              <PowerCurveSection cells={data.powerCurve.cells} />
            ) : (
              <p className="border-t border-rule pt-5 text-sm text-muted">
                No power-curve results yet. Run `llmreg simulate power` first.
              </p>
            )}

            <section className="mb-8 border-t border-rule pt-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">MDE validation</h2>
              {data.mdeValidation ? (
                <Table caption="MDE validation: reported closed-form MDE vs empirical MDE from the power curve, per sample size">
                  <THead>
                    <Tr>
                      <Th align="right">Sample size</Th>
                      <Th align="right">Reported MDE</Th>
                      <Th align="right">Empirical MDE</Th>
                      <Th>Within tolerance</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {data.mdeValidation.cells.map((cell) => (
                      <Tr key={cell.sampleSize}>
                        <Td align="right" mono>
                          {cell.sampleSize}
                        </Td>
                        <Td align="right" mono>
                          {formatMagnitudePP(cell.reportedMde)}
                        </Td>
                        <Td align="right" mono>
                          {cell.empiricalMde === null ? '—' : formatMagnitudePP(cell.empiricalMde)}
                        </Td>
                        <Td className="text-sm">{cell.withinTolerance ? 'yes' : 'NO'}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted">No MDE validation results yet. Run `llmreg simulate mde` first.</p>
              )}
            </section>

            <section className="border-t border-rule pt-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Pairing benefit — paired vs. unpaired detection of the same injected regression
              </h2>
              {data.pairingBenefit && (
                <dl className="mb-3 divide-y divide-rule text-sm">
                  <div className="flex justify-between py-1.5">
                    <dt className="text-muted">
                      n={data.pairingBenefit.n}, effect {formatMagnitudePP(data.pairingBenefit.effectSize)}, {data.pairingBenefit.trials} trials
                    </dt>
                    <dd />
                  </div>
                  <div className="flex justify-between py-1.5">
                    <dt className="text-muted">Paired detection rate</dt>
                    <dd className="font-mono tabular-nums">{formatRatePct(data.pairingBenefit.pairedDetectionRate)}</dd>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <dt className="text-muted">Unpaired detection rate</dt>
                    <dd className="font-mono tabular-nums">{formatRatePct(data.pairingBenefit.unpairedDetectionRate)}</dd>
                  </div>
                </dl>
              )}
              {data.hasPairingBenefitChart ? (
                <img
                  src={pairingBenefitChartUrl()}
                  alt="Chart comparing paired vs. unpaired detection rate of the same injected regression"
                  className="max-w-full border border-rule"
                />
              ) : (
                <p className="text-sm text-muted">No pairing-benefit chart yet. Run `llmreg simulate power` first.</p>
              )}
            </section>
          </>
        )}
      </AsyncSection>
    </div>
  );
}
