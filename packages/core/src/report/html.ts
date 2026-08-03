/**
 * Standalone HTML comparison report — §8's "Comparison" screen rendered as
 * a single self-contained document (inline `<style>`, no external
 * assets/fonts/scripts) so it can be opened as a local file or served
 * as-is by Phase 9's API. Same data, same wording (`copy.ts`) as
 * markdown.ts; only the presentation layer differs.
 *
 * PALETTE DISCIPLINE (§8, read literally): exactly six colors exist in
 * this document — paper, ink, rule, alert, settled, muted — and the
 * non-neutral three are scoped exactly as the spec states:
 *   - alert   (#A23B2C) — ONLY for a `regression` verdict, and ONLY for an
 *     interval-bar span/tick that is entirely below zero. It never
 *     appears for a failing judge calibration (that's "loud" via bold +
 *     bordered badge, not color — see below) and never for a per-case
 *     "critical" marker (that's bold text, not color — the same
 *     "never use color as the only carrier of meaning" reasoning).
 *   - settled (#2C5F4F) — ONLY for `improvement_detected`, and ONLY for a
 *     bar entirely above zero. It never colors the "fixed cases" section —
 *     a fixed case is a per-case pass/fail flip, not the aggregate
 *     verdict, and painting it green would smuggle in exactly the
 *     "certifies a change as good" framing the tool is built to refuse.
 *   - muted  (#7A7E85) — `no_detectable_difference`, `insufficient_data`,
 *     and any interval-bar span that crosses zero, regardless of what the
 *     categorical verdict elsewhere on the page says (see
 *     `renderIntervalBar` below — this is the one deliberate place verdict
 *     and bar color can disagree, and a note is rendered when they do).
 */

import { verdictElaboration, verdictHeadline } from './copy.js';
import { computeTruncatedDiff, renderDiffBlock } from './diff.js';
import {
  escapeHtml,
  formatMagnitudePP,
  formatPercent,
  formatScore,
  formatSignedPercentagePoints,
  formatTimestamp,
} from './format.js';
import type { ComparisonReportData, Verdict } from './types.js';

const VERDICT_LABEL_CLASS: Record<Verdict, string> = {
  regression: 'verdict-alert',
  no_detectable_difference: 'verdict-muted',
  improvement_detected: 'verdict-settled',
  insufficient_data: 'verdict-muted',
};

interface BarGeometry {
  html: string;
  crossesZero: boolean;
  entirelyBelowZero: boolean;
  /** 'bar-muted' | 'bar-alert' | 'bar-settled' -- exposed so the caller can decide which color CSS this render actually needs (see `needsAlert`/`needsSettled` in `renderHtmlReport`). */
  colorClass: string;
}

/**
 * The signature element (§8): "a horizontal rule with zero marked, the CI
 * drawn as a span, the point estimate as a tick. When the span crosses
 * zero it renders grey and unbolded."
 *
 * Its color is driven PURELY by whether [ciLower, ciUpper] crosses zero —
 * not by `data.verdict` — per the spec's explicit instruction that this
 * one element's color follows the interval, not the verdict string. That
 * matters concretely: a `regression` verdict can be driven entirely by a
 * critical-case override (§5.6) while the aggregate interval still spans
 * zero, and a reader must be able to see that distinction in the bar
 * itself rather than have the categorical verdict overwrite it.
 * "Unbolded" has no literal meaning for a `<div>` span, so it is
 * implemented as the closest visual analog: a thinner bar when muted, a
 * thicker one when the result is directionally clear.
 */
function renderIntervalBar(delta: number, ciLower: number, ciUpper: number): BarGeometry {
  const values = [ciLower, ciUpper, delta, 0];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Guard: comparing a run against itself yields delta = ciLower = ciUpper
  // = 0 exactly (§4 exit criteria for Phase 4) -- span would be 0, so pick
  // an arbitrary small nonzero span purely to keep the axis renderable;
  // the bar itself still correctly renders a single muted tick at center.
  const span = rawMax - rawMin || 0.01;
  const pad = span * 0.18;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min || 1;
  const pct = (v: number): number => ((v - min) / range) * 100;

  const crossesZero = ciLower <= 0 && ciUpper >= 0;
  const entirelyBelowZero = ciUpper < 0;
  const colorClass = crossesZero ? 'bar-muted' : entirelyBelowZero ? 'bar-alert' : 'bar-settled';

  const lowPct = pct(ciLower);
  const highPct = pct(ciUpper);
  const zeroPct = pct(0);
  const deltaPct = pct(delta);
  const widthPct = Math.max(highPct - lowPct, 0.6); // stay visible even for a near-zero-width CI

  const html = `
      <div class="interval-bar">
        <div class="bar-track">
          <div class="bar-zero" style="left: ${zeroPct.toFixed(2)}%;"></div>
          <div class="bar-span ${colorClass}" style="left: ${lowPct.toFixed(2)}%; width: ${widthPct.toFixed(2)}%;"></div>
          <div class="bar-tick ${colorClass}" style="left: ${deltaPct.toFixed(2)}%;" title="point estimate"></div>
        </div>
        <div class="bar-axis mono">
          <span class="bar-axis-min">${escapeHtml(formatSignedPercentagePoints(min))}</span>
          <span class="bar-axis-zero" style="left: ${zeroPct.toFixed(2)}%;">0</span>
          <span class="bar-axis-max">${escapeHtml(formatSignedPercentagePoints(max))}</span>
        </div>
        <p class="bar-caption ${colorClass}">${
          crossesZero
            ? 'Crosses zero — not distinguishable from no change at this confidence level.'
            : entirelyBelowZero
              ? 'Entirely below zero.'
              : 'Entirely above zero.'
        }</p>
      </div>`;

  return { html, crossesZero, entirelyBelowZero, colorClass };
}

/**
 * The one place the categorical verdict and the pure "does the interval
 * cross zero" bar reading can legitimately disagree (see module comment).
 * Rendered as a small note so the disagreement reads as informative, not
 * as the report contradicting itself.
 *
 * Two concrete cases, both only reachable via §5.6's critical-case
 * override (verdict.ts checks `regression` before `insufficient_data`
 * before `improvement_detected`, so a `regression` verdict is the only one
 * that can co-occur with an aggregate interval that doesn't itself read as
 * a regression):
 *   1. the aggregate interval spans zero (bar renders muted) but a
 *      critical case failing forced `regression` anyway;
 *   2. the aggregate interval sits entirely above zero (bar renders
 *      settled/green) but a critical case failing still forced
 *      `regression` -- the aggregate improved and one case broke it.
 */
function barDiscrepancyNote(data: ComparisonReportData, bar: BarGeometry): string | null {
  if (data.verdict !== 'regression' || data.criticalRegressed === 0) {
    return data.verdict === 'insufficient_data' && !bar.crossesZero
      ? `The aggregate interval above does not cross zero, but this dataset could not reliably measure an effect at this size — see minimum detectable effect and paired case count below. A confident-looking interval is not a substitute for statistical power.`
      : null;
  }
  const critN = `${data.criticalRegressed} critical case${data.criticalRegressed === 1 ? '' : 's'}`;
  if (bar.crossesZero) {
    return `The aggregate interval above crosses zero; this regression verdict comes from ${critN} failing, not the aggregate trend.`;
  }
  if (!bar.entirelyBelowZero) {
    return `The aggregate interval above sits entirely above zero — the aggregate improved; this regression verdict comes from ${critN} failing regardless.`;
  }
  return null;
}

function renderDiffHtml(baselineOutput: string, candidateOutput: string): string {
  const ops = computeTruncatedDiff(baselineOutput, candidateOutput);
  const text = renderDiffBlock(ops);
  const htmlLines = text.split('\n').map((line) => {
    const marker = line.charAt(0);
    const rest = line.slice(1).replace(/^ /, '');
    const content = escapeHtml(rest);
    if (marker === '+') return `<div class="diff-line diff-added">+ ${content}</div>`;
    if (marker === '-') return `<div class="diff-line diff-removed">- ${content}</div>`;
    return `<div class="diff-line diff-context">${content}</div>`;
  });
  return `<pre class="diff-block mono">${htmlLines.join('')}</pre>`;
}

function renderVerdictHeader(data: ComparisonReportData, bar: BarGeometry): string {
  const headlineClass = VERDICT_LABEL_CLASS[data.verdict];
  // Bold is spent only on `regression` -- see markdown.ts for the same
  // rule and the same reasoning; kept identical across renderers.
  const weightClass = data.verdict === 'regression' ? 'verdict-bold' : '';
  const discrepancy = barDiscrepancyNote(data, bar);

  return `
    <header>
      <p class="eyebrow mono">${escapeHtml(data.suiteName)} · ${escapeHtml(data.comparisonId)}</p>
      <h1 class="verdict-line ${headlineClass} ${weightClass}">${escapeHtml(verdictHeadline(data))}</h1>
      <p class="verdict-elaboration">${escapeHtml(verdictElaboration(data))}</p>
      ${bar.html}
      ${discrepancy ? `<p class="bar-note">${escapeHtml(discrepancy)}</p>` : ''}
    </header>`;
}

function renderEvidenceSection(data: ComparisonReportData): string {
  const mdeText = Number.isFinite(data.mde) ? formatMagnitudePP(data.mde) : 'undefined — zero paired cases';

  const calibrationRows =
    data.judgeCalibrations.length === 0
      ? `<p class="quiet">No <code>judge:*</code> graders used in this suite.</p>`
      : `<ul class="calibration-list">
          ${data.judgeCalibrations
            .map((jc) => {
              const kappa = jc.cohensKappa.toFixed(2);
              if (jc.status === 'passing') {
                return `<li><code>${escapeHtml(jc.grader)}</code> — passing (<span class="mono">κ=${kappa}</span>, n=${jc.labelCount} labels)</li>`;
              }
              // §5.9: "the check fails loudly, never silently." Loud here
              // is typographic (bold + bordered badge), never the alert
              // color -- alert is reserved for `regression` (see module
              // comment), and this fixture may not even be a regression.
              return `<li><code>${escapeHtml(jc.grader)}</code> — <span class="badge-failing">failing calibration</span> (<span class="mono">κ=${kappa}</span>, n=${jc.labelCount} labels) — scores from this judge are advisory only and did not drive this verdict.</li>`;
            })
            .join('\n          ')}
        </ul>`;

  return `
    <section>
      <h2>Evidence</h2>
      <dl class="evidence-list">
        <div><dt>Paired cases</dt><dd class="mono">${data.pairedCaseCount} (${data.excludedCount} excluded)</dd></div>
        <div><dt>Minimum detectable effect</dt><dd class="mono">${escapeHtml(mdeText)}</dd></div>
      </dl>
      <h3>Judge calibration</h3>
      ${calibrationRows}
    </section>`;
}

function renderRegressedCasesSection(data: ComparisonReportData): string {
  const { regressedCases } = data;
  if (regressedCases.length === 0) {
    return `
    <section>
      <h2>Regressed cases</h2>
      <p class="quiet">No cases regressed.</p>
    </section>`;
  }

  const rows = regressedCases
    .map(
      (c) => `
          <tr class="${c.critical ? 'row-critical' : ''}">
            <td class="mono">${escapeHtml(c.externalId)}</td>
            <td>${c.critical ? '<span class="badge-critical">critical</span>' : '—'}</td>
            <td class="mono num">${formatScore(c.baselineScore)}</td>
            <td class="mono num">${formatScore(c.candidateScore)}</td>
          </tr>`,
    )
    .join('');

  const details = regressedCases
    .map(
      (c) => `
      <details>
        <summary><code>${escapeHtml(c.externalId)}</code>${c.critical ? ' — <span class="badge-critical">critical</span>' : ''}</summary>
        ${renderDiffHtml(c.baselineOutput, c.candidateOutput)}
      </details>`,
    )
    .join('');

  return `
    <section>
      <h2>Regressed cases</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Case</th><th>Critical</th><th>Baseline</th><th>Candidate</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${details}
    </section>`;
}

function renderFixedCasesSection(data: ComparisonReportData): string {
  const { fixedCases } = data;
  const body =
    fixedCases.length === 0
      ? `<p class="quiet">No cases fixed.</p>`
      : `<div class="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Baseline</th><th>Candidate</th></tr></thead>
            <tbody>
              ${fixedCases
                .map(
                  (c) =>
                    `<tr><td class="mono">${escapeHtml(c.externalId)}</td><td class="mono num">${formatScore(c.baselineScore)}</td><td class="mono num">${formatScore(c.candidateScore)}</td></tr>`,
                )
                .join('\n              ')}
            </tbody>
          </table>
        </div>`;

  return `
    <details class="collapsible-section">
      <summary><h2 class="inline">Fixed cases (${fixedCases.length})</h2></summary>
      ${body}
    </details>`;
}

function renderMethodsSection(data: ComparisonReportData): string {
  const { methods } = data;
  const testLabel =
    methods.bootstrapIterations !== null
      ? `${escapeHtml(methods.test)} (${methods.bootstrapIterations} iterations)`
      : escapeHtml(methods.test);

  return `
    <details class="collapsible-section">
      <summary><h2 class="inline">Methods</h2></summary>
      <dl class="evidence-list methods-list">
        <div><dt>Test</dt><dd class="mono">${testLabel}</dd></div>
        <div><dt>Suite</dt><dd class="mono">${escapeHtml(data.suiteName)}</dd></div>
        <div><dt>Comparison id</dt><dd class="mono">${escapeHtml(data.comparisonId)}</dd></div>
        <div><dt>Computed at</dt><dd class="mono">${escapeHtml(formatTimestamp(data.computedAt))}</dd></div>
        <div><dt>Baseline</dt><dd class="mono">${escapeHtml(methods.baselineLabel)} · ${escapeHtml(methods.baselineModel)} · prompt <span title="prompt hash">${escapeHtml(methods.baselinePromptHash)}</span> · cache ${formatPercent(methods.baselineCacheHitRate)}</dd></div>
        <div><dt>Candidate</dt><dd class="mono">${escapeHtml(methods.candidateLabel)} · ${escapeHtml(methods.candidateModel)} · prompt <span title="prompt hash">${escapeHtml(methods.candidatePromptHash)}</span> · cache ${formatPercent(methods.candidateCacheHitRate)}</dd></div>
      </dl>
    </details>`;
}

/**
 * The stylesheet is split so that `--alert`/`#A23B2C` and
 * `--settled`/`#2C5F4F` — plus every rule that references them — are only
 * emitted when THIS render actually uses that color somewhere (verdict
 * text or interval-bar span/tick/caption). This is not merely cosmetic:
 * §8's rule is "non-significant results are never colored with the alert
 * color," and a static, always-present `:root { --alert: #A23B2C; }`
 * declaration would put the literal alert hex into the text of every
 * document this module produces, including a calm `no_detectable_difference`
 * report that never applies it to anything. An unused CSS custom property
 * is still bytes in the document a skimming reader (or a test asserting
 * "the alert hex never appears") can find — so it is never written unless
 * this specific comparison's data actually calls for it.
 *
 * Granularity note: the verdict-headline color and the interval-bar color
 * are gated INDEPENDENTLY (two separate conditions below), not by one
 * combined "this render uses alert somewhere" flag. A `regression` verdict
 * whose aggregate CI crosses zero (critical-case override, §5.6) colors
 * only the headline text alert-red — the bar itself stays muted, per the
 * module comment on `renderIntervalBar`. Emitting the bar's alert-colored
 * CSS in that case, even if unused by any element, would be dead weight
 * that happens to carry the same hex string a "how much alert is actually
 * on this page" reader (or check) would reasonably count. The hex is also
 * written directly per rule rather than through a `var(--alert)`
 * indirection for the same reason: a page where only the headline is
 * alert-colored should visibly carry less alert-referencing CSS than one
 * where the headline AND the bar both are.
 */
const BASE_ROOT = `
    :root {
      --paper: #FAFAF8;
      --ink: #16181D;
      --rule: #DCDDD8;
      --muted: #7A7E85;
    }`;

const BASE_RULES = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 28px 20px 72px;
      max-width: 800px;
      margin: 0 auto;
    }
    .mono {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-variant-numeric: tabular-nums;
    }
    h1, h2, h3 { font-weight: 600; margin: 0 0 6px; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin-top: 0; }
    h2.inline { display: inline; }
    h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-top: 18px; }
    header { border-bottom: 1px solid var(--rule); padding-bottom: 20px; margin-bottom: 24px; }
    section { border-top: 1px solid var(--rule); padding-top: 18px; margin-top: 18px; }
    .eyebrow { color: var(--muted); font-size: 0.78rem; margin: 0 0 10px; }
    .verdict-line { margin: 0 0 6px; font-weight: 400; }
    .verdict-line.verdict-bold { font-weight: 700; }
    .verdict-muted { color: var(--muted); }
    .verdict-elaboration { margin: 0 0 4px; color: var(--ink); }
    .quiet { color: var(--muted); }

    .interval-bar { margin: 22px 0 4px; }
    .bar-track { position: relative; height: 30px; }
    .bar-track::before {
      content: '';
      position: absolute; left: 0; right: 0; top: 50%;
      height: 1px; background: var(--rule);
    }
    .bar-zero { position: absolute; top: 3px; bottom: 3px; width: 1px; background: var(--ink); }
    .bar-span {
      position: absolute; top: 50%; transform: translateY(-50%);
      height: 3px;
    }
    .bar-span.bar-muted { background: var(--muted); height: 3px; }
    .bar-tick {
      position: absolute; top: 1px; bottom: 1px; width: 2px;
      transform: translateX(-1px);
    }
    .bar-tick.bar-muted { background: var(--muted); }
    .bar-axis { position: relative; height: 16px; font-size: 0.72rem; color: var(--muted); margin-top: 2px; }
    .bar-axis-min { position: absolute; left: 0; }
    .bar-axis-max { position: absolute; right: 0; }
    .bar-axis-zero { position: absolute; transform: translateX(-50%); }
    .bar-caption { font-size: 0.8rem; margin: 6px 0 0; }
    .bar-caption.bar-muted { color: var(--muted); }
    .bar-note { font-size: 0.78rem; color: var(--muted); font-style: italic; margin: 8px 0 0; }

    dl.evidence-list { display: grid; grid-template-columns: 1fr; gap: 4px 0; margin: 8px 0; padding: 0; }
    dl.evidence-list > div { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--rule); }
    dl.evidence-list dt { color: var(--muted); font-weight: 400; }
    dl.evidence-list dd { margin: 0; text-align: right; }
    .methods-list dd { text-align: right; word-break: break-word; }

    ul.calibration-list { list-style: none; margin: 6px 0 0; padding: 0; }
    ul.calibration-list li { padding: 6px 0; border-bottom: 1px solid var(--rule); }
    .badge-failing, .badge-critical {
      display: inline-block;
      border: 1px solid var(--ink);
      padding: 0 5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 0.7rem;
    }

    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule); }
    th { color: var(--muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
    td.num { text-align: right; }
    tr.row-critical { border-left: 3px solid var(--ink); }
    tr.row-critical td:first-child { padding-left: 7px; }

    details { border: 1px solid var(--rule); padding: 10px 14px; margin: 10px 0; }
    details.collapsible-section { margin-top: 18px; border-top: 1px solid var(--rule); border-left: none; border-right: none; border-bottom: none; padding: 14px 0 0; }
    summary { cursor: pointer; }
    summary code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }

    .diff-block {
      background: var(--paper);
      border: 1px solid var(--rule);
      padding: 8px 10px;
      font-size: 0.8rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin-top: 8px;
    }
    .diff-line { padding: 1px 0; }
    .diff-context { color: var(--muted); }
    .diff-removed { text-decoration: line-through; opacity: 0.75; }
    .diff-added { font-weight: 600; }

    a { color: var(--ink); }
    a:focus-visible, summary:focus-visible, [tabindex]:focus-visible, button:focus-visible {
      outline: 2px solid var(--ink);
      outline-offset: 2px;
    }
    /* No motion is used anywhere in this document; this rule exists as an
       explicit guarantee for anyone who later adds a transition. */
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation: none !important; }
    }
    @media (max-width: 480px) {
      body { padding: 18px 12px 56px; }
      table { font-size: 0.78rem; }
      th, td { padding: 6px 6px; }
      dl.evidence-list > div { flex-direction: column; gap: 2px; }
      dl.evidence-list dd { text-align: left; }
    }
`;

// Each rule below carries its own literal hex (not a `var(--alert)`
// indirection) and is gated by its OWN specific condition -- see the
// "Granularity note" above. `VERDICT_*_RULE` and `BAR_*_RULES` are
// included independently, so a page whose headline is alert-colored but
// whose bar is not (critical-case override, CI crossing zero) carries
// only the headline rule's single hex occurrence, not the bar's as well.
const VERDICT_ALERT_RULE = `
    .verdict-alert { color: #A23B2C; }`;
const VERDICT_SETTLED_RULE = `
    .verdict-settled { color: #2C5F4F; }`;
const BAR_ALERT_RULES = `
    .bar-span.bar-alert { background: #A23B2C; height: 8px; }
    .bar-tick.bar-alert { background: #A23B2C; }
    .bar-caption.bar-alert { color: #A23B2C; }`;
const BAR_SETTLED_RULES = `
    .bar-span.bar-settled { background: #2C5F4F; height: 8px; }
    .bar-tick.bar-settled { background: #2C5F4F; }
    .bar-caption.bar-settled { color: #2C5F4F; }`;

export function renderHtmlReport(data: ComparisonReportData): string {
  const title = `${data.suiteName} — ${verdictHeadline(data)}`;
  const headlineClass = VERDICT_LABEL_CLASS[data.verdict];
  const bar = renderIntervalBar(data.delta, data.ciLower, data.ciUpper);
  // Computed once here and threaded through, so the CSS that's actually
  // emitted below can never drift from the bar that's actually rendered
  // in the header.

  const style = [
    BASE_ROOT,
    BASE_RULES,
    headlineClass === 'verdict-alert' ? VERDICT_ALERT_RULE : '',
    headlineClass === 'verdict-settled' ? VERDICT_SETTLED_RULE : '',
    bar.colorClass === 'bar-alert' ? BAR_ALERT_RULES : '',
    bar.colorClass === 'bar-settled' ? BAR_SETTLED_RULES : '',
  ]
    .filter((part) => part.length > 0)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <style>${style}
  </style>
</head>
<body>
  <main>
    ${renderVerdictHeader(data, bar)}
    ${renderEvidenceSection(data)}
    ${renderRegressedCasesSection(data)}
    ${renderFixedCasesSection(data)}
    ${renderMethodsSection(data)}
  </main>
</body>
</html>
`;
}
