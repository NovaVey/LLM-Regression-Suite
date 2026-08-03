/**
 * The PR comment — §5.8: "the PR comment is the product... It is not a
 * link to a dashboard." Renders the fixed §5.8 ordering:
 *
 *   1. One-line verdict with delta and CI
 *   2. n paired cases, MDE, judge calibration status
 *   3. Regressed cases table + truncated diffs
 *   4. Fixed cases, collapsed
 *   5. Methods, collapsed
 *
 * DESIGN RESOLUTION — "one line" vs. the detail §5.8/§8 also asks item 1 to
 * carry (regressed count + critical flag for `regression`; the MDE
 * sentence for `no_detectable_difference`; "detected not proven" for
 * `improvement_detected`; the dataset-specific reason for
 * `insufficient_data`): §8 is explicit that "someone skimming on their
 * phone must be able to tell whether to worry from the first line alone,"
 * and that verdict+delta+interval is what may occupy that line — nothing
 * else competes for it. This module resolves the tension by splitting
 * item 1 into two visually distinct lines within the same block (a `<br>`
 * forces the break in GFM, since a bare `\n` inside a paragraph does not):
 * an unadorned "verdict: delta [CI]." sentence that is complete and
 * sufficient on its own, followed immediately by the elaboration §5.8/§8
 * separately requires. A reader who stops after the first line is never
 * missing the number that matters; a reader who reads one line further
 * gets the required context.
 *
 * Non-significant verdicts (`no_detectable_difference`, `insufficient_data`)
 * render with NO bold and NO exclamation anywhere in this module —
 * markdown has no color, so the only lever available to keep "visual
 * weight matching statistical weight" (§8) is typographic emphasis, and
 * that lever is spent entirely on `regression`. `improvement_detected`
 * also renders unbolded: this tool never certifies a change as good
 * (spec §0 rule 10), and bolding "improvement" would visually rank it
 * alongside a regression finding, which is exactly backwards.
 */

import { verdictElaboration, verdictHeadline } from './copy.js';
import { computeTruncatedDiff, renderDiffBlock } from './diff.js';
import { escapeHtml, formatMagnitudePP, formatPercent, formatScore, formatTimestamp } from './format.js';
import type { ComparisonReportData } from './types.js';

/**
 * Embedded verbatim, identical across every render regardless of
 * `comparisonId`/suite/verdict, so Phase 8's GitHub Action can grep an
 * existing PR's comments for this exact string to decide whether to update
 * in place or create a new one. See §5.8: "The comment updates in place on
 * new commits rather than posting again — twelve stacked bot comments is
 * how a bot gets muted."
 */
export const PR_COMMENT_MARKER = '<!-- llmreg-regression-suite-comment -->';

function renderVerdictSection(data: ComparisonReportData): string {
  const headlineText = verdictHeadline(data);
  // Bold is spent ONLY on `regression` (§8: non-significant results must
  // never look alarming; this tool also never certifies a change as good,
  // so `improvement_detected` gets no emphasis either — bolding it would
  // visually rank "improved" next to "regressed," which is exactly
  // backwards). `<br>` forces a real line break in GFM (a bare `\n` inside
  // a paragraph does not), so the headline is a genuinely separate,
  // self-sufficient first line and the elaboration reads as a second.
  const headline = data.verdict === 'regression' ? `**${headlineText}**` : headlineText;
  const elaboration = verdictElaboration(data);
  return `${headline}<br>\n${elaboration}`;
}

function renderEvidenceSection(data: ComparisonReportData): string {
  const lines: string[] = [
    '### Evidence',
    '',
    `- Paired cases: ${data.pairedCaseCount} (${data.excludedCount} excluded)`,
    `- Minimum detectable effect: ${Number.isFinite(data.mde) ? formatMagnitudePP(data.mde) : 'undefined — zero paired cases'}`,
  ];

  if (data.judgeCalibrations.length === 0) {
    lines.push('- Judge calibration: no `judge:*` graders used in this suite.');
  } else {
    lines.push('- Judge calibration:');
    for (const jc of data.judgeCalibrations) {
      const kappa = jc.cohensKappa.toFixed(2);
      if (jc.status === 'passing') {
        lines.push(`  - \`${jc.grader}\`: passing (κ=${kappa}, n=${jc.labelCount} labels)`);
      } else {
        // §5.9: "the check fails loudly, never silently." Bold + an
        // explicit statement that this judge's scores did not drive the
        // verdict -- the one place besides `regression` this module uses
        // emphasis, because a silently-failing judge is exactly the kind
        // of problem a skimming reader must not be able to miss.
        lines.push(
          `  - \`${jc.grader}\`: **FAILING calibration** (κ=${kappa}, n=${jc.labelCount} labels) — scores from this judge are advisory only and did not drive this verdict.`,
        );
      }
    }
  }

  return lines.join('\n');
}

function renderRegressedCasesSection(data: ComparisonReportData): string {
  const { regressedCases } = data;
  const lines: string[] = ['### Regressed cases'];

  if (regressedCases.length === 0) {
    lines.push('', 'No cases regressed.');
    return lines.join('\n');
  }

  lines.push('', '| Case | Critical | Baseline | Candidate |', '|---|---|---|---|');
  for (const c of regressedCases) {
    // Bold, explicit "critical" text (not just a checkmark/glyph) so the
    // marking survives even where color/emphasis doesn't render (e.g. a
    // terminal `gh pr view --comments`) -- §5.6: "no aggregate will tell
    // you that" about a critical regression, so this row must not read as
    // just another row.
    const criticalCell = c.critical ? '**critical**' : '—';
    lines.push(`| \`${escapeHtml(c.externalId)}\` | ${criticalCell} | ${formatScore(c.baselineScore)} | ${formatScore(c.candidateScore)} |`);
  }

  lines.push('');
  for (const c of regressedCases) {
    const diffOps = computeTruncatedDiff(c.baselineOutput, c.candidateOutput);
    const diffText = renderDiffBlock(diffOps);
    lines.push(
      '<details>',
      `<summary>Diff: <code>${escapeHtml(c.externalId)}</code>${c.critical ? ' — critical' : ''}</summary>`,
      '',
      '```diff',
      diffText,
      '```',
      '',
      '</details>',
      '',
    );
  }

  return lines.join('\n').trimEnd();
}

function renderFixedCasesSection(data: ComparisonReportData): string {
  const { fixedCases } = data;
  const lines: string[] = ['<details>', `<summary>Fixed cases (${fixedCases.length})</summary>`, ''];

  if (fixedCases.length === 0) {
    lines.push('No cases fixed.');
  } else {
    lines.push('| Case | Baseline | Candidate |', '|---|---|---|');
    for (const c of fixedCases) {
      lines.push(`| \`${escapeHtml(c.externalId)}\` | ${formatScore(c.baselineScore)} | ${formatScore(c.candidateScore)} |`);
    }
  }

  lines.push('', '</details>');
  return lines.join('\n');
}

function renderMethodsSection(data: ComparisonReportData): string {
  const { methods } = data;
  const testLabel =
    methods.bootstrapIterations !== null
      ? `\`${methods.test}\` (${methods.bootstrapIterations} iterations)`
      : `\`${methods.test}\``;

  const lines: string[] = [
    '<details>',
    '<summary>Methods</summary>',
    '',
    `- Test: ${testLabel}`,
    `- Baseline: \`${escapeHtml(methods.baselineLabel)}\` — model \`${escapeHtml(methods.baselineModel)}\`, prompt hash \`${escapeHtml(methods.baselinePromptHash)}\`, cache hit rate ${formatPercent(methods.baselineCacheHitRate)}`,
    `- Candidate: \`${escapeHtml(methods.candidateLabel)}\` — model \`${escapeHtml(methods.candidateModel)}\`, prompt hash \`${escapeHtml(methods.candidatePromptHash)}\`, cache hit rate ${formatPercent(methods.candidateCacheHitRate)}`,
    `- Suite: \`${escapeHtml(data.suiteName)}\``,
    `- Comparison id: \`${escapeHtml(data.comparisonId)}\``,
    `- Computed at: ${formatTimestamp(data.computedAt)}`,
    '',
    '</details>',
  ];

  return lines.join('\n');
}

export function renderMarkdownReport(data: ComparisonReportData): string {
  const parts = [
    PR_COMMENT_MARKER,
    renderVerdictSection(data),
    renderEvidenceSection(data),
    renderRegressedCasesSection(data),
    renderFixedCasesSection(data),
    renderMethodsSection(data),
  ];
  return `${parts.join('\n\n')}\n`;
}
