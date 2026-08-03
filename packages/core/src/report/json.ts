/**
 * Programmatic JSON output — §7: `llmreg report --comparison <id> --format
 * json`. Per the interface contract: `ComparisonReportData`'s own shape is
 * already a clean serialization (every field is a plain
 * string/number/boolean/array/nested-object), so this is a thin, honest
 * `JSON.stringify`, not a reinvented schema. Consumers that want the same
 * "delta with interval, brackets never dropped" framing the human-facing
 * renderers enforce should compute it themselves from `delta`/`ciLower`/
 * `ciUpper` — a machine consumer needs the raw numbers, not a
 * pre-formatted string baked into a value it may want to recompute with.
 */

import type { ComparisonReportData } from './types.js';

export function renderJsonReport(data: ComparisonReportData): string {
  return JSON.stringify(data, null, 2);
}
