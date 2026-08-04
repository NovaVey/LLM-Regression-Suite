/**
 * Reimplemented, byte-for-byte, from packages/core/src/report/format.ts.
 *
 * WHY DUPLICATED RATHER THAN IMPORTED: packages/web may only ever import
 * *types* from '@llmreg/core' -- the package's barrel file
 * (packages/core/src/index.ts) transitively pulls in `pg`, `drizzle-orm`,
 * and Node built-ins that cannot be bundled for a browser and will break
 * Vite's build. See the CRITICAL CONSTRAINT in the Phase 9 build brief.
 *
 * Every rule here exists to enforce §8 of the spec, literally:
 *   - "Intervals always render as `−3.2pp [−5.8, −0.6]` — the brackets are
 *     never dropped, anywhere."
 *   - percentage-point formatting: multiply the 0..1 delta/CI by 100, one
 *     decimal place, explicit sign.
 *   - the minus sign is U+2212 (MINUS SIGN), not U+002D (HYPHEN-MINUS).
 *
 * Keep this in lockstep with report/format.ts. If one changes, the other
 * must change with it -- there is no automated guard against drift because
 * there is no runtime import to enforce it, only this comment.
 */

/** U+2212 MINUS SIGN, per the spec's own interval examples (not ASCII '-'). */
export const MINUS_SIGN = '−';

/**
 * Formats a plain (0..1 scale) number as a signed percentage-point string
 * with one decimal place, e.g. 0.032 -> "+3.2", -0.006 -> "−0.6",
 * 0 -> "+0.0". "Explicit sign" (§8) means every value gets a sign,
 * including zero — there is no unsigned case, so there is no ambiguity
 * about whether a bare number is positive.
 */
export function formatSignedPercentagePoints(value: number): string {
  const pp = value * 100;
  // Round first, then take the sign of the ROUNDED value — otherwise a
  // tiny negative value that rounds to "0.0" (e.g. -0.001pp) would render
  // as "−0.0", which reads as a negative number that isn't one.
  const rounded = Math.round(pp * 10) / 10;
  const sign = rounded < 0 ? MINUS_SIGN : '+';
  return `${sign}${Math.abs(rounded).toFixed(1)}`;
}

/** Same as `formatSignedPercentagePoints` with the "pp" unit suffix appended. */
export function formatDeltaPP(delta: number): string {
  return `${formatSignedPercentagePoints(delta)}pp`;
}

/**
 * An unsigned percentage-point magnitude, e.g. for MDE ("this suite can
 * detect changes of 7.4pp or larger") — the MDE is a magnitude, not a
 * signed directional delta, so it never carries the +/− the interval and
 * delta figures do.
 */
export function formatMagnitudePP(value: number): string {
  return `${(Math.abs(value) * 100).toFixed(1)}pp`;
}

/**
 * The bracketed CI, per §8: `[−5.8, −0.6]`. Brackets are hard-coded into
 * this function precisely so no call site can accidentally drop them.
 */
export function formatIntervalPP(ciLower: number, ciUpper: number): string {
  return `[${formatSignedPercentagePoints(ciLower)}, ${formatSignedPercentagePoints(ciUpper)}]`;
}

/**
 * The delta with its interval, exactly per §8's own example:
 * `−3.2pp [−5.8, −0.6]`. This is the ONE function every renderer should
 * call whenever a point estimate is shown — per the product principle that
 * the point estimate never appears without its interval, there should be
 * no call site anywhere that formats `delta` without also calling this
 * (or `formatIntervalPP`) for the same figure.
 */
export function formatDeltaWithInterval(delta: number, ciLower: number, ciUpper: number): string {
  return `${formatDeltaPP(delta)} ${formatIntervalPP(ciLower, ciUpper)}`;
}

/** A plain 0..1 case/grader score, e.g. 0.8 -> "0.80". Matches `grades.score`'s stored 0..1 scale (§4) directly, with no unit conversion to guess at. */
export function formatScore(score: number): string {
  return score.toFixed(2);
}

/** 0..1 rate -> "87%" (integer percent — cache hit rate doesn't need decimal precision to be useful). */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Renders an ISO-8601 timestamp for a human reading the methods block, in UTC, unambiguous. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`;
}
