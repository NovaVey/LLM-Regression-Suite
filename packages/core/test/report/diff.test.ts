// Written from the Phase 7 interface contract
// (.claude/commands/build-llm-regression-suite.md §5.8 point 3, plus the
// phase7-contract.md handed down for this delegation) WITHOUT reading
// src/report/diff.ts (implemented concurrently by report-designer).
//
// Contract, given (not read from src):
//   type DiffOpKind = 'equal' | 'added' | 'removed';
//   interface DiffOp { kind: DiffOpKind; text: string; }
//   interface TruncatedDiffOptions {
//     maxInputLength?: number; // default 600 -- "Each input is truncated to
//       this many characters before diffing" (BEFORE, not after)
//     maxOutputLines?: number; // default 20 -- "After diffing, cap the
//       rendered output to this many lines; if exceeded, truncate and note it."
//   }
//   function computeTruncatedDiff(baseline, candidate, options?): DiffOp[]
//   function renderDiffBlock(ops: DiffOp[]): string
//     -- must be directly usable inside a ```diff fenced code block: one
//        line per contiguous run, "-"/"+" prefixed for removed/added.
//
// Word-level diff (via jsdiff's diffWords per the contract) is a partition
// of edits: concatenating every op that is NOT 'added' reconstructs the
// (possibly-truncated) baseline exactly, and concatenating every op that is
// NOT 'removed' reconstructs the (possibly-truncated) candidate exactly.
// This is a structural property of any correct diff (you can always
// reconstruct both documents from their own diff) and is used below as a
// strong, implementation-agnostic correctness check instead of asserting
// jsdiff's exact internal tokenization.
//
// -----------------------------------------------------------------------
// FLAGGED AMBIGUITY (not silently resolved): `maxOutputLines` is documented
// on `TruncatedDiffOptions` as capping "the rendered output" to N lines,
// but `renderDiffBlock` takes no options -- it only receives `DiffOp[]`.
// The only place the cap can actually be enforced, therefore, is inside
// `computeTruncatedDiff` itself, which means that function must anticipate
// how many lines its own *returned ops* will become once rendered by a
// *different* function it doesn't control the options of. The exact
// mechanism (cap by "changed run" count? by op count? note embedded as a
// synthetic 'equal' op, since DiffOpKind has no 'truncated' variant?) is
// left as "your call" by the contract. The test below is written to be
// agnostic to that mechanism: it compares a small cap against a large cap
// on the *same* underlying diff and asserts the small-cap render is
// shorter and visibly notes truncation, rather than asserting an exact
// line count or exact wording.
// -----------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { computeTruncatedDiff, renderDiffBlock, type DiffOp } from '../../src/report/diff.js';

describe('computeTruncatedDiff-identifies-word-level-additions-and-removals-on-a-hand-verified-example', () => {
  it('computeTruncatedDiff-identifies-word-level-additions-and-removals-on-a-hand-verified-example', () => {
    const baseline = 'The quick brown fox jumps over the lazy dog';
    const candidate = 'The quick brown fox leaps gracefully over the lazy dog';

    const ops = computeTruncatedDiff(baseline, candidate);

    // Structural correctness: the diff must be a lossless partition of both
    // strings (neither input exceeds the 600-char default, so no
    // truncation is in play here -- this isolates diff correctness from
    // truncation behaviour, which is tested separately below).
    const baselineRecon = ops.filter((o) => o.kind !== 'added').map((o) => o.text).join('');
    const candidateRecon = ops.filter((o) => o.kind !== 'removed').map((o) => o.text).join('');
    expect(baselineRecon).toBe(baseline);
    expect(candidateRecon).toBe(candidate);

    // The changed word must be attributed correctly: "jumps" only ever
    // appears inside a 'removed' op, "leaps" only ever inside an 'added' op.
    const removedText = ops.filter((o) => o.kind === 'removed').map((o) => o.text).join('');
    const addedText = ops.filter((o) => o.kind === 'added').map((o) => o.text).join('');
    expect(removedText).toContain('jumps');
    expect(addedText).not.toContain('jumps');
    expect(addedText).toContain('leaps');
    expect(removedText).not.toContain('leaps');

    // This must be a WORD-level diff, not a whole-string replacement: the
    // long common prefix and suffix must survive as 'equal' text, not get
    // swallowed into a removed+added pair covering the entire string.
    const equalText = ops.filter((o) => o.kind === 'equal').map((o) => o.text).join('');
    expect(equalText).toContain('brown fox');
    expect(equalText).toContain('lazy dog');
    const changedLength = removedText.length + addedText.length;
    expect(changedLength).toBeLessThan(baseline.length); // far less than a full replace would produce
  });
});

describe('computeTruncatedDiff-truncates-each-input-to-maxInputLength-before-diffing-not-after', () => {
  it('the-reconstructed-baseline-and-candidate-are-bounded-to-exactly-maxInputLength-characters-by-default', () => {
    // 500 repetitions of a 5-letter word + separating spaces = 2999 chars,
    // comfortably over the documented default of 600. Element 1 is changed
    // (same length swap, "lorem" -> "ipsum") so the truncated window still
    // contains real diff content near the start, ruling out a
    // vacuously-all-equal result from masking whether truncation happened
    // at all.
    const baseWords = Array.from({ length: 500 }, () => 'lorem');
    const baseline = baseWords.join(' ');
    const candWords = [...baseWords];
    candWords[1] = 'ipsum';
    const candidate = candWords.join(' ');
    expect(baseline.length).toBeGreaterThan(600);
    expect(candidate.length).toBeGreaterThan(600);

    const ops = computeTruncatedDiff(baseline, candidate); // default maxInputLength = 600

    const baselineRecon = ops.filter((o) => o.kind !== 'added').map((o) => o.text).join('');
    const candidateRecon = ops.filter((o) => o.kind !== 'removed').map((o) => o.text).join('');

    // "Truncated to this many characters before diffing" is a precise claim:
    // the reconstructed baseline/candidate sides must equal the first 600
    // characters of each original string, exactly -- not merely "shorter
    // than before" (which "doesn't crash" would already satisfy).
    expect(baselineRecon).toBe(baseline.slice(0, 600));
    expect(candidateRecon).toBe(candidate.slice(0, 600));
    expect(baselineRecon.length).toBe(600);
    expect(candidateRecon.length).toBe(600);
  });

  it('a-divergence-past-the-truncation-window-is-invisible-to-the-diff-while-a-divergence-inside-it-is-detected', () => {
    // Same 50-char common prefix in both cases; the single point of
    // difference ("apple" vs "banana") sits right after it, around
    // character 51-57.
    const common = 'x'.repeat(50);
    const baseline = `${common} apple ${'y'.repeat(300)}`;
    const candidate = `${common} banana ${'y'.repeat(300)}`;

    // maxInputLength=40 cuts BEFORE the divergence -- both truncated inputs
    // are identical ('x' * 40), so the diff must report no changes at all.
    const shallow = computeTruncatedDiff(baseline, candidate, { maxInputLength: 40 });
    expect(shallow.length).toBeGreaterThan(0);
    expect(shallow.every((o) => o.kind === 'equal')).toBe(true);

    // maxInputLength=200 includes the divergence -- it must now be visible.
    const deep = computeTruncatedDiff(baseline, candidate, { maxInputLength: 200 });
    expect(deep.some((o) => o.kind === 'removed' && o.text.includes('apple'))).toBe(true);
    expect(deep.some((o) => o.kind === 'added' && o.text.includes('banana'))).toBe(true);
  });
});

describe('computeTruncatedDiff-produces-an-all-equal-diff-for-identical-inputs', () => {
  it('computeTruncatedDiff-produces-an-all-equal-diff-for-identical-inputs', () => {
    const text =
      'The assistant should refuse to provide legal advice, but may offer to connect ' +
      'the user with a licensed professional. This keeps the response both safe and useful.';

    const ops = computeTruncatedDiff(text, text);

    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.kind === 'equal')).toBe(true);
    expect(ops.map((o) => o.text).join('')).toBe(text);

    // Also true for the empty string, an edge case a naive implementation
    // could mishandle (e.g. treating "" as producing no ops at all is fine,
    // but must never report an 'added' or 'removed' op with nothing to add
    // or remove).
    const emptyOps = computeTruncatedDiff('', '');
    expect(emptyOps.every((o) => o.kind === 'equal')).toBe(true);
  });
});

describe('renderDiffBlock-produces-github-diff-fence-compatible-plus-minus-lines', () => {
  it('a-hand-built-op-list-renders-removed-lines-prefixed-minus-and-added-lines-prefixed-plus', () => {
    const ops: DiffOp[] = [
      { kind: 'equal', text: 'Hello ' },
      { kind: 'removed', text: 'world' },
      { kind: 'added', text: 'there' },
      { kind: 'equal', text: '!' },
    ];

    const block = renderDiffBlock(ops);
    const lines = block.split('\n');

    expect(lines.some((l) => l.startsWith('-') && l.includes('world'))).toBe(true);
    expect(lines.some((l) => l.startsWith('+') && l.includes('there'))).toBe(true);
    // A line reporting a removal must never also read as an addition, and
    // vice versa -- ruling out an implementation that just prefixes every
    // line with both / neither.
    expect(lines.some((l) => l.startsWith('-') && l.includes('there'))).toBe(false);
    expect(lines.some((l) => l.startsWith('+') && l.includes('world'))).toBe(false);

    // Embedding literal ``` inside the block would prematurely close a
    // surrounding ```diff fence in the PR comment -- must never appear.
    expect(block).not.toContain('```');
  });

  it('a-realistic-multi-sentence-diff-renders-as-sane-plus-minus-lines-not-a-wall-of-context', () => {
    // Deliberately no hyphenated compounds spanning a change boundary
    // (e.g. "30-day"): a word-level tokenizer may legitimately split
    // "30-day" into "30" + "-day", which would make an assertion like
    // `.includes('30-day')` fail for a perfectly correct word-level diff.
    // Plain space-separated words keep this test about diff correctness,
    // not about a specific tokenizer's punctuation-splitting rules.
    const baseline =
      'The assistant apologized and offered a refund within the standard 30 day window, ' +
      'citing store policy section 4.2.';
    const candidate =
      'The assistant apologized and offered a full refund within an extended 45 day window, ' +
      'citing updated store policy section 4.2 and escalated the case to a supervisor.';

    const ops = computeTruncatedDiff(baseline, candidate);
    const block = renderDiffBlock(ops);
    const lines = block.split('\n').filter((l) => l.trim() !== '');

    expect(block).not.toContain('```');
    expect(lines.some((l) => l.startsWith('-'))).toBe(true);
    expect(lines.some((l) => l.startsWith('+'))).toBe(true);
    // The specific changed content must land on the correctly-prefixed line.
    expect(lines.some((l) => l.startsWith('-') && /\b30\b/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith('+') && /\b45\b/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith('+') && l.includes('supervisor'))).toBe(true);
    // "store policy section 4.2" is common to both inputs and must not be
    // reported as changed merely because nearby words changed.
    expect(block).toContain('store policy section 4.2');
  });
});

describe('long-diffs-are-capped-to-the-configured-output-line-count-and-the-cap-is-visibly-noted', () => {
  it('a-small-maxOutputLines-produces-a-shorter-render-than-a-large-one-for-the-same-diff-and-notes-the-truncation', () => {
    // 60 short tokens, half of them changed -- comfortably under the
    // 600-char default maxInputLength (so this exercises maxOutputLines in
    // isolation from maxInputLength truncation), but with far more than 20
    // distinct changed "runs" once diffed.
    const words = Array.from({ length: 60 }, (_, i) => `tok${i}`);
    const baseline = words.join(' ');
    const candidate = words.map((w, i) => (i % 2 === 0 ? `${w}X` : w)).join(' ');
    expect(baseline.length).toBeLessThan(600);

    const uncapped = computeTruncatedDiff(baseline, candidate, { maxOutputLines: 1000 });
    const capped = computeTruncatedDiff(baseline, candidate, { maxOutputLines: 5 });

    const uncappedBlock = renderDiffBlock(uncapped);
    const cappedBlock = renderDiffBlock(capped);
    const uncappedChangeLines = uncappedBlock.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
    const cappedLines = cappedBlock.split('\n').filter((l) => l.trim() !== '');

    // Sanity check on the fixture itself: this really does produce more
    // change-lines than either cap, uncapped.
    expect(uncappedChangeLines.length).toBeGreaterThan(10);

    // The capped render must be meaningfully shorter than the uncapped one.
    expect(cappedLines.length).toBeLessThan(uncappedChangeLines.length);

    // Truncation must be visibly noted somewhere (exact wording is the
    // implementer's call per the contract -- accept any reasonable signal).
    expect(/truncat|omit|more (line|change)|\.\.\./i.test(cappedBlock)).toBe(true);
  });
});
