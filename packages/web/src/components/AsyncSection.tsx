/**
 * Shared loading/error chrome so every screen renders the same, calm
 * "still measuring" / "could not load" states rather than each screen
 * reinventing its own. Errors surface the API's own message (§8: "errors
 * name the fix") -- never a generic "something went wrong."
 */

import type { ReactNode } from 'react';
import type { ApiState } from '../hooks/useApi.js';

export function AsyncSection<T>({
  state,
  children,
}: {
  state: ApiState<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') {
    return <p className="font-mono text-sm text-muted">Loading…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="border border-rule px-3 py-2 font-mono text-sm text-ink">
        Could not load this screen: {state.error.message}
      </p>
    );
  }
  return <>{children(state.data)}</>;
}
