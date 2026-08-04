/**
 * The signature element (§8): "a horizontal rule with zero marked, the CI
 * drawn as a span, the point estimate as a tick. When the span crosses
 * zero it renders grey and unbolded."
 *
 * Geometry and color rules are a direct port of the same algorithm in
 * packages/core/src/report/html.ts's `renderIntervalBar` -- the two must
 * never disagree about when something is muted vs colored, so this is a
 * translation, not a redesign.
 *
 * Color is driven PURELY by whether [ciLower, ciUpper] crosses zero, never
 * by a `verdict` prop -- this component deliberately has no `verdict` prop
 * at all, so no call site can wire the two together by accident. A
 * `regression` verdict can be driven entirely by a critical-case override
 * (§5.6) while the aggregate interval still spans zero; the bar must still
 * render muted in that case, and the caller is responsible for surfacing
 * the discrepancy in prose alongside it (see Comparison.tsx).
 *
 * "Unbolded" has no literal meaning for a div -- implemented, same as
 * html.ts, as a thinner span/tick when muted and a thicker one when the
 * result reads as directionally clear.
 *
 * No motion anywhere: `prefers-reduced-motion` is satisfied by never
 * animating in the first place, the simplest compliant choice.
 */

import { formatDeltaPP, formatIntervalPP, formatSignedPercentagePoints } from '../format.js';

export interface IntervalBarProps {
  /** Point estimate, 0..1 scale (same units as the DB/API -- multiply by 100 for pp internally). */
  delta: number;
  ciLower: number;
  ciUpper: number;
  /** Compact rendering for dense contexts (e.g. a comparison list row). Default false. */
  compact?: boolean;
  className?: string;
}

function colorClassFor(crossesZero: boolean, entirelyBelowZero: boolean): 'muted' | 'alert' | 'settled' {
  if (crossesZero) return 'muted';
  return entirelyBelowZero ? 'alert' : 'settled';
}

export function IntervalBar({ delta, ciLower, ciUpper, compact = false, className = '' }: IntervalBarProps) {
  const values = [ciLower, ciUpper, delta, 0];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Guard: comparing a run against itself yields delta = ciLower = ciUpper
  // = 0 exactly -- span would be 0, so pick an arbitrary small nonzero
  // span purely to keep the axis renderable; the bar itself still
  // correctly renders a single muted tick at center.
  const span = rawMax - rawMin || 0.01;
  const pad = span * 0.18;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min || 1;
  const pct = (v: number): number => ((v - min) / range) * 100;

  const crossesZero = ciLower <= 0 && ciUpper >= 0;
  const entirelyBelowZero = ciUpper < 0;
  const color = colorClassFor(crossesZero, entirelyBelowZero);

  const lowPct = pct(ciLower);
  const highPct = pct(ciUpper);
  const zeroPct = pct(0);
  const deltaPct = pct(delta);
  const widthPct = Math.max(highPct - lowPct, 0.6); // stay visible even for a near-zero-width CI

  const spanHeight = color === 'muted' ? 'h-[3px]' : 'h-2';
  const spanColor = color === 'muted' ? 'bg-muted' : color === 'alert' ? 'bg-alert' : 'bg-settled';
  const tickColor = color === 'muted' ? 'bg-muted' : color === 'alert' ? 'bg-alert' : 'bg-settled';
  const captionColor = color === 'muted' ? 'text-muted' : color === 'alert' ? 'text-alert' : 'text-settled';

  const caption = crossesZero
    ? 'Crosses zero — not distinguishable from no change at this confidence level.'
    : entirelyBelowZero
      ? 'Entirely below zero.'
      : 'Entirely above zero.';

  const spoken = `Point estimate ${formatDeltaPP(delta)}, 95% confidence interval ${formatIntervalPP(ciLower, ciUpper)}. ${caption}`;

  const trackHeight = compact ? 'h-4' : 'h-[30px]';

  return (
    <div className={`interval-bar ${className}`}>
      <div role="img" aria-label={spoken} className={`relative ${trackHeight}`}>
        {/* Baseline rule */}
        <div aria-hidden="true" className="absolute left-0 right-0 top-1/2 h-px bg-rule" />
        {/* Zero marker */}
        <div
          aria-hidden="true"
          className="absolute top-[3px] bottom-[3px] w-px bg-ink"
          style={{ left: `${zeroPct}%` }}
        />
        {/* CI span */}
        <div
          aria-hidden="true"
          className={`absolute top-1/2 -translate-y-1/2 ${spanHeight} ${spanColor}`}
          style={{ left: `${lowPct}%`, width: `${widthPct}%` }}
        />
        {/* Point estimate tick */}
        <div
          aria-hidden="true"
          className={`absolute top-px bottom-px w-[2px] -translate-x-px ${tickColor}`}
          style={{ left: `${deltaPct}%` }}
          title="point estimate"
        />
      </div>
      {!compact && (
        <div aria-hidden="true" className="relative mt-0.5 h-4 font-mono text-[0.68rem] tabular-nums text-muted">
          <span className="absolute left-0">{formatSignedPercentagePoints(min)}</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${zeroPct}%` }}>
            0
          </span>
          <span className="absolute right-0">{formatSignedPercentagePoints(max)}</span>
        </div>
      )}
      <p aria-hidden="true" className={`mt-1.5 text-sm ${captionColor}`}>
        {caption}
      </p>
    </div>
  );
}
