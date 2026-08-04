/**
 * Cross-screen shell. §8: "lab notebook, not dashboard" -- a plain
 * masthead and hairline rule, no cards, no shadow, nothing that reads as
 * a marketing surface.
 */

import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `border-b-2 pb-0.5 ${
    isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
  } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`;
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-4xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
          <Link
            to="/suites"
            className="font-mono text-sm font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            LLM Regression Suite
          </Link>
          <nav aria-label="Primary" className="flex gap-5 font-mono text-sm">
            <NavLink to="/suites" className={navLinkClass}>
              Suites
            </NavLink>
            <NavLink to="/simulations" className={navLinkClass}>
              Simulations
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

export function SuiteSubNav({
  suiteId,
  active,
}: {
  suiteId: string;
  active: 'comparisons' | 'dataset' | 'calibrations';
}) {
  const items: Array<{ key: typeof active; label: string; to: string }> = [
    { key: 'comparisons', label: 'Comparisons', to: `/suites/${suiteId}/comparisons` },
    { key: 'dataset', label: 'Dataset', to: `/suites/${suiteId}/dataset` },
    { key: 'calibrations', label: 'Calibration', to: `/suites/${suiteId}/calibrations` },
  ];
  return (
    <nav aria-label="Suite" className="mb-6 flex gap-5 border-b border-rule pb-3 font-mono text-sm">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          aria-current={item.key === active ? 'page' : undefined}
          className={`focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
            item.key === active ? 'font-semibold text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
