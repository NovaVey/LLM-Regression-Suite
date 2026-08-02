import type { GraderContext, GradeResult } from './types.js';

/**
 * Passes iff the trimmed output exactly equals the trimmed target string.
 * Target comes from `config.value` if present, else `caseData.expected`
 * (which must then be a string — anything else is a config error, not a
 * failed case, so it throws rather than silently scoring 0).
 */
export function exact(ctx: GraderContext): GradeResult {
  const target = ctx.config?.value ?? ctx.caseData.expected;
  if (typeof target !== 'string') {
    throw new Error(
      `exact grader for case "${ctx.caseData.externalId}": no string target — set config.value or case.expected to a string`,
    );
  }
  const passed = ctx.output.trim() === target.trim();
  return { score: passed ? 1 : 0, passed };
}
