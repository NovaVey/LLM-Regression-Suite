// Written from packages/core/src/report/format.ts's own doc comments (the
// canonical spec this file's own header claims to reimplement "byte-for-
// byte") and .claude/commands/build-llm-regression-suite.md §8, WITHOUT
// reading this file's (packages/web/src/format.ts) implementation body
// first. Every expected value below is computed independently from the
// documented rule, not copied from either implementation's source.

import { describe, expect, it } from 'vitest';
import {
  MINUS_SIGN,
  formatDeltaPP,
  formatDeltaWithInterval,
  formatIntervalPP,
  formatMagnitudePP,
  formatPercent,
  formatScore,
  formatSignedPercentagePoints,
  formatTimestamp,
} from './format.js';

describe('positive-values-render-with-an-explicit-plus-sign', () => {
  it('0.032 (3.2pp) renders as +3.2', () => {
    expect(formatSignedPercentagePoints(0.032)).toBe('+3.2');
  });

  it('exactly zero renders as +0.0, never bare or unsigned', () => {
    expect(formatSignedPercentagePoints(0)).toBe('+0.0');
  });
});

describe('negative-values-render-with-the-typographic-minus-sign-not-an-ascii-hyphen', () => {
  it('-0.006 (-0.6pp) renders as −0.6 using U+2212', () => {
    const result = formatSignedPercentagePoints(-0.006);
    expect(result).toBe('−0.6');
    expect(result.charCodeAt(0)).toBe(0x2212);
  });

  it('MINUS_SIGN is literally U+2212 MINUS SIGN, distinct from U+002D HYPHEN-MINUS', () => {
    expect(MINUS_SIGN.charCodeAt(0)).toBe(0x2212);
    expect(MINUS_SIGN.charCodeAt(0)).not.toBe(0x2d);
    expect(MINUS_SIGN).not.toBe('-');
  });
});

describe('a-value-that-rounds-to-zero-never-renders-as-negative-zero', () => {
  it('a tiny negative value (-0.001pp) rounds to +0.0, not −0.0', () => {
    // -0.00001 on the 0..1 scale is -0.001pp -- well inside the region that
    // rounds to "0.0" at one decimal place. Per the documented rule, the
    // SIGN must be taken from the rounded value, so this must read as a
    // plain, unsigned-looking zero rather than a negative number that
    // isn't actually one.
    expect(formatSignedPercentagePoints(-0.00001)).toBe('+0.0');
  });
});

describe('deltas-carry-the-pp-unit-suffix', () => {
  it('formatDeltaPP appends "pp" to the signed value', () => {
    expect(formatDeltaPP(0.032)).toBe('+3.2pp');
    expect(formatDeltaPP(-0.045)).toBe('−4.5pp');
  });
});

describe('mde-and-other-magnitudes-render-unsigned-never-with-a-directional-sign', () => {
  it('a positive magnitude has no leading +', () => {
    expect(formatMagnitudePP(0.074)).toBe('7.4pp');
  });

  it('a magnitude computed from a negative input still renders unsigned (same as its positive counterpart)', () => {
    // MDE is a size, not a direction -- the sign of whatever produced it
    // must not leak into the rendered string.
    expect(formatMagnitudePP(-0.074)).toBe('7.4pp');
  });
});

describe('interval-brackets-are-never-dropped', () => {
  it('formats a fully negative interval with both bounds signed and bracketed', () => {
    expect(formatIntervalPP(-0.058, -0.006)).toBe('[−5.8, −0.6]');
  });

  it('formats an interval spanning zero with mixed signs, still bracketed', () => {
    expect(formatIntervalPP(-0.02, 0.04)).toBe('[−2.0, +4.0]');
  });
});

describe('the-point-estimate-never-appears-without-its-interval', () => {
  it('matches the specs own literal worked example exactly: −3.2pp [−5.8, −0.6]', () => {
    // .claude/commands/build-llm-regression-suite.md §8: "Intervals always
    // render as `−3.2pp [−5.8, −0.6]`."
    expect(formatDeltaWithInterval(-0.032, -0.058, -0.006)).toBe('−3.2pp [−5.8, −0.6]');
  });
});

describe('scores-render-on-their-stored-zero-to-one-scale', () => {
  it('0.8 renders as 0.80, two decimal places, no percent conversion', () => {
    expect(formatScore(0.8)).toBe('0.80');
  });

  it('a perfect score renders as 1.00', () => {
    expect(formatScore(1)).toBe('1.00');
  });
});

describe('cache-hit-rate-renders-as-a-whole-number-percent', () => {
  it('0.873 rounds to 87%, no decimal precision', () => {
    expect(formatPercent(0.873)).toBe('87%');
  });

  it('0.2 rounds to a clean 20%', () => {
    expect(formatPercent(0.2)).toBe('20%');
  });
});

describe('timestamps-render-unambiguously-in-utc', () => {
  it('formats an ISO timestamp as space-separated UTC, seconds precision', () => {
    expect(formatTimestamp('2024-01-15T10:30:00.000Z')).toBe('2024-01-15 10:30:00 UTC');
  });

  it('an unparseable timestamp is returned unchanged rather than throwing or printing "Invalid Date"', () => {
    expect(formatTimestamp('not-a-real-timestamp')).toBe('not-a-real-timestamp');
  });
});
