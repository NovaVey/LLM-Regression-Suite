import type { GraderContext, GradeResult } from './types.js';

/**
 * Passes iff `output` matches `config.pattern` (a JS regex source string,
 * required). `config.flags` is an optional flags string (e.g. "i", "gm").
 */
export function regex(ctx: GraderContext): GradeResult {
  const pattern = ctx.config?.pattern;
  if (typeof pattern !== 'string') {
    throw new Error(
      `regex grader for case "${ctx.caseData.externalId}": config.pattern is required and must be a string`,
    );
  }
  const flags = ctx.config?.flags;
  if (flags !== undefined && typeof flags !== 'string') {
    throw new Error(`regex grader for case "${ctx.caseData.externalId}": config.flags must be a string if present`);
  }

  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(
      `regex grader for case "${ctx.caseData.externalId}": invalid pattern/flags — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const passed = re.test(ctx.output);
  return { score: passed ? 1 : 0, passed };
}
