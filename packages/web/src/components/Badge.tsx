/**
 * The "loud but not colored" marker (§5.9: "the check fails loudly, never
 * silently" -- but loudness here is typographic, not the alert color,
 * because alert is reserved exclusively for a `regression` verdict and its
 * interval bar; see html.ts's module comment). Used for a failing/missing
 * judge calibration, a critical-case flag, an excluded case, or a dataset
 * coverage gap -- none of which are themselves a regression finding.
 */

import type { ReactNode } from 'react';

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block border border-ink px-1.5 py-0 font-mono text-[0.68rem] font-bold uppercase tracking-wide text-ink ${className}`}
    >
      {children}
    </span>
  );
}
