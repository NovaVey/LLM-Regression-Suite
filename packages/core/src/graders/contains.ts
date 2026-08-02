import type { GraderContext, GradeResult } from './types.js';

/**
 * Passes iff `output` contains the target substring. Target comes from
 * `config.substring` if present, else `caseData.expected` (must be a
 * string). `config.caseSensitive` defaults to true.
 */
export function contains(ctx: GraderContext): GradeResult {
  const target = ctx.config?.substring ?? ctx.caseData.expected;
  if (typeof target !== 'string') {
    throw new Error(
      `contains grader for case "${ctx.caseData.externalId}": no string target — set config.substring or case.expected to a string`,
    );
  }
  const caseSensitive = ctx.config?.caseSensitive !== false;
  const output = caseSensitive ? ctx.output : ctx.output.toLowerCase();
  const needle = caseSensitive ? target : target.toLowerCase();
  const passed = output.includes(needle);
  return { score: passed ? 1 : 0, passed };
}
