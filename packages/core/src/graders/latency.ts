import type { GraderContext, GradeResult } from './types.js';

/**
 * Passes iff the case's latency is at or under `config.maxLatencyMs`
 * (required). If latency is unknown (null), the grader fails closed rather
 * than assuming fast — an unmeasured latency is not evidence of a fast one.
 */
export function latency(ctx: GraderContext): GradeResult {
  const maxLatencyMs = ctx.config?.maxLatencyMs;
  if (typeof maxLatencyMs !== 'number' || !Number.isFinite(maxLatencyMs) || maxLatencyMs <= 0) {
    throw new Error(
      `latency grader for case "${ctx.caseData.externalId}": config.maxLatencyMs is required and must be a positive number`,
    );
  }
  if (ctx.latencyMs === null) {
    return { score: 0, passed: false, rationale: 'latency unknown — failing closed' };
  }
  const passed = ctx.latencyMs <= maxLatencyMs;
  return { score: passed ? 1 : 0, passed };
}
