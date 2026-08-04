/**
 * Real `<table>` markup, not divs -- §8's quality floor: "tables
 * keyboard-navigable." A native table with real `<a>`/`<button>` elements
 * inside it is keyboard-operable by construction (standard tab order,
 * standard Enter/Space activation); nothing here reimplements a grid
 * widget, because doing so would be the kind of unrequested complexity
 * that itself risks breaking keyboard behaviour rather than fixing it.
 *
 * `RowLink` implements the "stretched link" pattern so an entire row can
 * be a single, real, keyboard-focusable link (one tab stop per row, not
 * one per cell) without wrapping a `<tr>` in an `<a>` (illegal HTML) --
 * the `<a>` lives inside one cell and is visually stretched to cover the
 * row via `absolute inset-0`, with the row given `position: relative`.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-rule">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Th({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  className = '',
  emphasized = false,
}: {
  children: ReactNode;
  className?: string;
  emphasized?: boolean;
}) {
  return (
    <tr className={`relative border-b border-rule ${emphasized ? 'border-l-2 border-l-ink' : ''} ${className}`}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = 'left',
  mono = false,
  className = '',
  colSpan,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-2.5 py-1.5 ${align === 'right' ? 'text-right' : 'text-left'} ${
        mono ? 'font-mono tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * Renders inside the first `<td>` of a row that should navigate somewhere
 * on click/Enter — visually stretched to the full row via `absolute
 * inset-0`, so the whole row reads as clickable while remaining exactly
 * one real, focusable `<a>` per row.
 */
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="absolute inset-0 z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
    >
      <span className="sr-only">{children}</span>
    </Link>
  );
}
