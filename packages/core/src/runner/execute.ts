/**
 * Orchestrates a run: concurrency-limited (§ MAX_CONCURRENCY), cache-aware
 * (§5.7), per-case error isolation (§5.1/§5.9 — one case erroring is
 * reported as an error and excluded, never scored as a zero, and never
 * aborts the rest of the run).
 *
 * `cacheStore` and `targetCaller` are injectable (defaulting to the real
 * DB-backed cache and the real Anthropic call) specifically so this can be
 * tested without a database or an API key — a fake in-memory cache and a
 * fake target caller exercise the exact same code path.
 */

import { callTarget, type TargetCallResult, type TargetMessage } from '../anthropic.js';
import type { Case } from '../dataset/schema.js';
import { computeCacheKey, getCachedResponse, putCachedResponse, type CachedEntry } from './cache.js';
import { runWithConcurrency } from './concurrency.js';

export interface RunVariant {
  model: string;
  temperature: number;
  /** Hash of the resolved prompt template — the cache key ingredient that changes when the prompt does. */
  promptHash: string;
  systemPrompt?: string;
}

export interface CaseExecutionResult {
  externalId: string;
  sampleIndex: number;
  output: string | null;
  error: string | null;
  latencyMs: number | null;
  fromCache: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface CacheStore {
  get(cacheKey: string): Promise<CachedEntry | null>;
  put(cacheKey: string, model: string, entry: CachedEntry): Promise<void>;
}

export type TargetCaller = (
  messages: TargetMessage[],
  model: string,
  temperature: number,
  options?: { systemPrompt?: string },
) => Promise<TargetCallResult>;

export interface ExecuteRunOptions {
  cases: Case[];
  variant: RunVariant;
  maxConcurrency: number;
  /** Repeat-sampling count per §5.3. Default 1 (no repeat sampling). */
  sampleCount?: number;
  /** Default true. */
  useCache?: boolean;
  cacheStore?: CacheStore;
  targetCaller?: TargetCaller;
}

export interface ExecuteRunResult {
  results: CaseExecutionResult[];
  cacheHits: number;
}

const defaultCacheStore: CacheStore = { get: getCachedResponse, put: putCachedResponse };

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const sampleCount = options.sampleCount ?? 1;
  const useCache = options.useCache ?? true;
  const cacheStore = options.cacheStore ?? defaultCacheStore;
  const targetCaller = options.targetCaller ?? callTarget;

  const work: Array<{ caseData: Case; sampleIndex: number }> = [];
  for (const caseData of options.cases) {
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      work.push({ caseData, sampleIndex });
    }
  }

  let cacheHits = 0;

  const results = await runWithConcurrency(work, options.maxConcurrency, async ({ caseData, sampleIndex }) => {
    const cacheKey = computeCacheKey({
      model: options.variant.model,
      temperature: options.variant.temperature,
      promptHash: options.variant.promptHash,
      input: caseData.input,
      sampleIndex,
    });

    if (useCache) {
      const cached = await cacheStore.get(cacheKey);
      if (cached) {
        cacheHits += 1;
        return {
          externalId: caseData.externalId,
          sampleIndex,
          output: cached.output,
          error: null,
          latencyMs: cached.latencyMs,
          fromCache: true,
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
        } satisfies CaseExecutionResult;
      }
    }

    try {
      const callResult = await targetCaller(
        caseData.input.messages,
        options.variant.model,
        options.variant.temperature,
        options.variant.systemPrompt !== undefined ? { systemPrompt: options.variant.systemPrompt } : {},
      );

      if (useCache) {
        await cacheStore.put(cacheKey, options.variant.model, {
          output: callResult.output,
          latencyMs: callResult.latencyMs,
          inputTokens: callResult.inputTokens,
          outputTokens: callResult.outputTokens,
        });
      }

      return {
        externalId: caseData.externalId,
        sampleIndex,
        output: callResult.output,
        error: null,
        latencyMs: callResult.latencyMs,
        fromCache: false,
        inputTokens: callResult.inputTokens,
        outputTokens: callResult.outputTokens,
      } satisfies CaseExecutionResult;
    } catch (err) {
      // Error isolation: one case failing must never abort the run and must
      // be reported as an error, never silently scored as a zero (§5.1/§5.9).
      return {
        externalId: caseData.externalId,
        sampleIndex,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: null,
        fromCache: false,
        inputTokens: null,
        outputTokens: null,
      } satisfies CaseExecutionResult;
    }
  });

  return { results, cacheHits };
}

export interface GradedSample {
  externalId: string;
  sampleIndex: number;
  score: number;
  passed: boolean;
}

export interface AveragedCaseScore {
  externalId: string;
  /** Mean of the per-sample scores. */
  score: number;
  /** Derived from the averaged score (>= 0.5), not a vote across sample `passed` flags — see §5.3. */
  passed: boolean;
  sampleCount: number;
}

/**
 * Averages per-case scores across repeat samples (§5.3) before pairing.
 * Grouped by `externalId`; each case's score is the mean of its samples'
 * scores, and `passed` is derived from that averaged score rather than a
 * vote across the samples' individual `passed` flags — a case that passes
 * 2 of 3 samples with scores [1, 1, 0] averages to a passing 0.67, which is
 * the intended behavior for continuous graders. Whether McNemar's binary
 * pairing needs different repeat-sampling semantics is a Phase 4 question,
 * not resolved here.
 */
export function averagePerCaseScores(samples: readonly GradedSample[]): AveragedCaseScore[] {
  const byExternalId = new Map<string, GradedSample[]>();
  for (const sample of samples) {
    const group = byExternalId.get(sample.externalId);
    if (group) {
      group.push(sample);
    } else {
      byExternalId.set(sample.externalId, [sample]);
    }
  }

  const result: AveragedCaseScore[] = [];
  for (const [externalId, group] of byExternalId) {
    const score = group.reduce((sum, s) => sum + s.score, 0) / group.length;
    result.push({ externalId, score, passed: score >= 0.5, sampleCount: group.length });
  }
  return result;
}
