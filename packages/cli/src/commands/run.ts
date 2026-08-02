import { readFileSync } from 'node:fs';
import {
  createVariant,
  ensureCases,
  ensureSuite,
  executeRun,
  getTargetModel,
  hashPromptTemplate,
  loadCases,
  loadSuiteConfig,
  persistRun,
} from '@llmreg/core';

export interface RunCommandOptions {
  suite: string;
  dataset: string;
  label: string;
  systemPromptFile?: string;
  model?: string;
  temperature?: number;
  maxConcurrency?: number;
  sampleCount?: number;
  cache: boolean;
  limit?: number;
}

export interface RunCommandOutcome {
  runId: string;
  caseCount: number;
  sampleCount: number;
  cacheHits: number;
  cacheHitRate: number;
  errorCount: number;
  errors: Array<{ externalId: string; sampleIndex: number; error: string }>;
}

export async function runRunCommand(options: RunCommandOptions): Promise<RunCommandOutcome> {
  const suiteConfig = loadSuiteConfig(options.suite);
  let cases = loadCases(options.dataset);
  if (options.limit !== undefined) {
    cases = cases.slice(0, options.limit);
  }

  const model = options.model ?? getTargetModel();
  const temperature =
    options.temperature ?? (process.env.TARGET_TEMPERATURE !== undefined ? Number(process.env.TARGET_TEMPERATURE) : 0);
  const maxConcurrency =
    options.maxConcurrency ?? (process.env.MAX_CONCURRENCY !== undefined ? Number(process.env.MAX_CONCURRENCY) : 8);
  const sampleCount = options.sampleCount ?? 1;

  const systemPrompt = options.systemPromptFile !== undefined ? readFileSync(options.systemPromptFile, 'utf8') : undefined;
  const promptHash = hashPromptTemplate(systemPrompt ?? '');

  const suiteId = await ensureSuite(suiteConfig);
  const caseIdByExternalId = await ensureCases(suiteId, cases);
  const variantId = await createVariant(suiteId, {
    label: options.label,
    model,
    temperature,
    promptHash,
  });

  const { results, cacheHits } = await executeRun({
    cases,
    variant: { model, temperature, promptHash, ...(systemPrompt !== undefined ? { systemPrompt } : {}) },
    maxConcurrency,
    sampleCount,
    useCache: options.cache,
  });

  const { runId, cacheHitRate } = await persistRun({
    suiteId,
    variantId,
    trigger: 'cli',
    cases,
    caseIdByExternalId,
    executionResults: results,
    cacheHits,
    graders: suiteConfig.graders,
  });

  const errored = results.filter((r): r is typeof r & { error: string } => r.error !== null);

  return {
    runId,
    caseCount: cases.length,
    sampleCount: results.length,
    cacheHits,
    cacheHitRate,
    errorCount: errored.length,
    errors: errored.map((r) => ({ externalId: r.externalId, sampleIndex: r.sampleIndex, error: r.error })),
  };
}
