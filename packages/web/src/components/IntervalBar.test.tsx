// @vitest-environment jsdom
//
// NOTE: the root vitest.config.ts's `environmentMatchGlobs` option does not
// exist in vitest 4.1.10 (checked against node_modules/vitest/dist/config.d.ts
// -- no such property on the config type) and is silently ignored, so without
// this per-file pragma every packages/web test runs under the default 'node'
// environment and fails immediately with "document is not defined". This
// pragma is a per-file workaround; the shared config itself needs fixing --
// see the final report.
//
// Written from .claude/commands/build-llm-regression-suite.md §8 (the
// signature-element description: "a horizontal rule with zero marked, the
// CI drawn as a span, the point estimate as a tick. When the span crosses
// zero it renders grey and unbolded") and the module's own doc comment,
// WITHOUT reading the component's render body/JSX first. The rule tested
// here is stated identically, and independently, in
// packages/core/src/report/html.ts's module comment (the Phase 7 static
// renderer for the same element): color is driven purely by whether
// [ciLower, ciUpper] crosses zero, never by any verdict-like signal. That
// file's doc comment -- not this component's implementation -- is the
// specification this suite checks the live component against.
//
// Only fact taken from source rather than derived: the prop names
// (delta/ciLower/ciUpper) and that this is the element with role="img" plus
// a full-sentence aria-label -- both are the calling contract, not behavior.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { IntervalBar } from './IntervalBar.js';

afterEach(cleanup);

/** Tailwind's `alert`/`settled`/`muted` tokens (tailwind.config.ts) map 1:1
 * to the spec's three non-neutral colors and are only ever referenced via
 * class names ending in `-alert` / `-settled` / `-muted` anywhere in this
 * package (verified: `alert` appears nowhere else in packages/web/src as a
 * class-name fragment). Checking for these substrings in the rendered
 * markup is therefore a faithful proxy for "this element is/isn't colored
 * alert/settled/muted" even though jsdom doesn't apply the compiled
 * Tailwind stylesheet to computed style. */
function colorsPresent(html: string): { alert: boolean; settled: boolean; muted: boolean } {
  return {
    alert: /-alert\b/.test(html),
    settled: /-settled\b/.test(html),
    muted: /-muted\b/.test(html),
  };
}

describe('an-interval-crossing-zero-renders-muted-regardless-of-the-point-estimates-sign', () => {
  it('stays muted with a negative point estimate', () => {
    const { container } = render(<IntervalBar delta={-0.01} ciLower={-0.05} ciUpper={0.03} />);
    const bar = container.querySelector('[role="img"]')!.closest('div')!;
    const colors = colorsPresent(bar.outerHTML);
    expect(colors.muted).toBe(true);
    expect(colors.alert).toBe(false);
    expect(colors.settled).toBe(false);
  });

  it('stays muted with a positive point estimate on the exact same interval', () => {
    // Same CI, opposite-signed delta -- if color were driven by delta's
    // sign (a stand-in for "which way did the verdict go") rather than
    // purely by whether the interval crosses zero, this would flip to
    // settled. It must not.
    const { container } = render(<IntervalBar delta={0.02} ciLower={-0.05} ciUpper={0.03} />);
    const bar = container.querySelector('[role="img"]')!.closest('div')!;
    const colors = colorsPresent(bar.outerHTML);
    expect(colors.muted).toBe(true);
    expect(colors.alert).toBe(false);
    expect(colors.settled).toBe(false);
  });

  it('a self-comparison (delta = ciLower = ciUpper = 0) still renders muted, not uncolored or crashing', () => {
    // Phase 4 exit criterion: "comparing a run against itself yields ... an
    // interval containing 0." Zero is inside [0, 0], so this must read as
    // crossing zero (muted), never alert/settled, and must not throw despite
    // the degenerate zero-width span.
    const { container } = render(<IntervalBar delta={0} ciLower={0} ciUpper={0} />);
    const bar = container.querySelector('[role="img"]')!.closest('div')!;
    const colors = colorsPresent(bar.outerHTML);
    expect(colors.muted).toBe(true);
    expect(colors.alert).toBe(false);
    expect(colors.settled).toBe(false);
  });
});

describe('an-interval-entirely-above-zero-renders-the-settled-color', () => {
  it('colors the bar settled, not muted or alert', () => {
    const { container } = render(<IntervalBar delta={0.04} ciLower={0.02} ciUpper={0.06} />);
    const bar = container.querySelector('[role="img"]')!.closest('div')!;
    const colors = colorsPresent(bar.outerHTML);
    expect(colors.settled).toBe(true);
    expect(colors.muted).toBe(false);
    expect(colors.alert).toBe(false);
  });
});

describe('an-interval-entirely-below-zero-renders-the-alert-color', () => {
  it('colors the bar alert, not muted or settled', () => {
    const { container } = render(<IntervalBar delta={-0.04} ciLower={-0.06} ciUpper={-0.02} />);
    const bar = container.querySelector('[role="img"]')!.closest('div')!;
    const colors = colorsPresent(bar.outerHTML);
    expect(colors.alert).toBe(true);
    expect(colors.muted).toBe(false);
    expect(colors.settled).toBe(false);
  });
});

describe('the-bars-text-alternative-never-drops-the-interval-brackets', () => {
  it('includes a bracketed interval with the typographic minus sign for a negative bound', () => {
    const { getByRole } = render(<IntervalBar delta={-0.032} ciLower={-0.058} ciUpper={-0.006} />);
    const img = getByRole('img');
    const label = img.getAttribute('aria-label') ?? '';
    // Independently computed per §8's own literal example format
    // (`−3.2pp [−5.8, −0.6]`): one decimal place, U+2212 minus, brackets.
    expect(label).toContain('[−5.8, −0.6]');
  });

  it('includes a bracketed interval with an explicit plus sign for a positive bound, brackets present even when the interval crosses zero', () => {
    const { getByRole } = render(<IntervalBar delta={0.01} ciLower={-0.02} ciUpper={0.04} />);
    const img = getByRole('img');
    const label = img.getAttribute('aria-label') ?? '';
    expect(label).toContain('[−2.0, +4.0]');
    // The brackets themselves must survive verbatim -- no call site may
    // format only the numbers and drop the enclosing '[' ']'.
    expect(label).toMatch(/\[[−+]\d+\.\d, [−+]\d+\.\d\]/);
  });
});
