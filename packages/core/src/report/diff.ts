/**
 * Word-level diffing for the PR comment's per-case output comparison. See
 * §5.8 point 3 of the spec: "the truncated diff of the two outputs."
 *
 * Pure, zero I/O — same discipline as the rest of this repo's non-DB
 * modules. Uses the `diff` npm package's `diffWords` rather than
 * reimplementing a diff algorithm: this repo's "statistics implemented
 * in-repo, not from a library" rule (docs/DECISIONS.md) is specifically
 * about statistical claims needing independent verification, not about text
 * utilities — jsdiff here is the same category of dependency as `pg` or
 * `commander`, not a claim this repo is making about the world.
 *
 * WORD-LEVEL, NOT LINE-LEVEL: outputs being compared are prose or JSON
 * blobs from an LLM, typically a paragraph or two, not source files. A
 * line-level diff on a single-paragraph string is nearly useless (the
 * whole "line" just shows as changed); word-level diffing is what actually
 * shows a reviewer which words moved.
 */

import { diffWords } from 'diff';

export type DiffOpKind = 'equal' | 'added' | 'removed';

export interface DiffOp {
  kind: DiffOpKind;
  text: string;
}

export interface TruncatedDiffOptions {
  /**
   * Each input is truncated to this many characters before diffing —
   * readability, not performance: a 5000-char output producing a
   * 5000-char diff is not "truncated" in any sense a reviewer cares about.
   * Default 600.
   */
  maxInputLength?: number;
  /**
   * After diffing, cap the rendered output to this many lines; if
   * exceeded, the ops are cut and a final synthetic note op records how
   * much was omitted. Default 20.
   */
  maxOutputLines?: number;
}

const DEFAULT_MAX_INPUT_LENGTH = 600;
const DEFAULT_MAX_OUTPUT_LINES = 20;

/**
 * Max characters shown on a single unchanged (context) line before the
 * middle is collapsed with an ellipsis. Only applies to 'equal' runs —
 * changed ('added'/'removed') text is never clipped here, because that is
 * exactly the content a reviewer opened the diff to read.
 */
const CONTEXT_LINE_CHARS = 80;

/**
 * Marks a synthetic 'equal' op inserted by `computeTruncatedDiff` to record
 * that output was cut off, so `renderDiffBlock` can recognize and render it
 * as a note rather than clipping it like ordinary context (see
 * `CONTEXT_LINE_CHARS`). Internal to this module; not part of the public
 * `DiffOp` contract, which intentionally has no separate "notice" kind.
 */
const TRUNCATION_NOTICE_PREFIX = '[diff truncated:';

function truncateInput(text: string, maxLength: number): string {
  // An exact slice, no added marker character: "truncated to this many
  // characters" is a precise claim about the diffed content itself (the
  // reconstructed baseline/candidate from the resulting ops must equal
  // exactly `text.slice(0, maxLength)`), not "roughly that many plus a
  // cosmetic ellipsis." `renderDiffBlock`'s own output-line truncation
  // (`maxOutputLines`) is where a human-readable "truncated" notice
  // belongs; this is the input-side truncation and stays silent/exact.
  return text.slice(0, maxLength);
}

/**
 * Word-level diff between baseline and candidate, truncated per
 * `options`. Each input is independently truncated to `maxInputLength`
 * characters before diffing, then the resulting op list is capped so that
 * rendering it (via `renderDiffBlock`) produces at most `maxOutputLines`
 * lines.
 */
export function computeTruncatedDiff(
  baseline: string,
  candidate: string,
  options: TruncatedDiffOptions = {},
): DiffOp[] {
  const maxInputLength = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  const maxOutputLines = options.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;

  const truncatedBaseline = truncateInput(baseline, maxInputLength);
  const truncatedCandidate = truncateInput(candidate, maxInputLength);

  const rawOps: DiffOp[] = diffWords(truncatedBaseline, truncatedCandidate).map((change) => ({
    kind: change.added ? 'added' : change.removed ? 'removed' : 'equal',
    text: change.value,
  }));

  // Drop zero-length ops (diffWords can emit them at string boundaries) so
  // every remaining op maps to exactly one rendered line downstream.
  const ops = rawOps.filter((op) => op.text.length > 0);

  if (ops.length <= maxOutputLines) {
    return ops;
  }

  const kept = ops.slice(0, maxOutputLines);
  const omitted = ops.length - maxOutputLines;
  kept.push({
    kind: 'equal',
    text: `${TRUNCATION_NOTICE_PREFIX} ${omitted} more change${omitted === 1 ? '' : 's'} omitted]`,
  });
  return kept;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Clips a context (unchanged) line so a long unchanged span doesn't blow up the block. */
function clipContext(text: string): string {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= CONTEXT_LINE_CHARS) {
    return collapsed;
  }
  const half = Math.floor((CONTEXT_LINE_CHARS - 3) / 2);
  return `${collapsed.slice(0, half)} … ${collapsed.slice(-half)}`;
}

/**
 * Renders `DiffOp[]` as text usable inside a ```diff fenced code block:
 * standard unified-diff line prefixes (' ' context, '+' added, '-'
 * removed) so GitHub's fenced-diff renderer colors +/- lines without any
 * extra markup. One line per op — each op from `computeTruncatedDiff` is
 * already a contiguous same-status run (that's what `diffWords` returns),
 * so "one line per contiguous run" falls out of that directly. Context
 * lines longer than `CONTEXT_LINE_CHARS` are collapsed in the middle;
 * changed lines are never clipped.
 */
export function renderDiffBlock(ops: DiffOp[]): string {
  const lines: string[] = [];

  for (const op of ops) {
    if (op.kind === 'equal' && op.text.startsWith(TRUNCATION_NOTICE_PREFIX)) {
      lines.push(`  ${op.text}`);
      continue;
    }
    if (op.kind === 'equal') {
      const text = clipContext(op.text);
      if (text.length === 0) continue;
      lines.push(` ${text}`);
    } else {
      const prefix = op.kind === 'added' ? '+' : '-';
      const text = collapseWhitespace(op.text);
      if (text.length === 0) continue;
      lines.push(`${prefix} ${text}`);
    }
  }

  if (lines.length === 0) {
    return ' (no differences)';
  }

  return lines.join('\n');
}
