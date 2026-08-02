#!/usr/bin/env node
import { Command } from 'commander';
import {
  checkAnthropicReachable,
  checkDatabaseReachable,
  closeDb,
  getJudgeModel,
  getTargetModel,
  runMigrations,
} from '@llmreg/core';
import { runInit } from './commands/init.js';
import { runRunCommand } from './commands/run.js';

function readEnv(fn: () => string): string | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

const program = new Command();

program
  .name('llmreg')
  .description(
    'Paired evaluation with statistical significance for LLM prompt and model changes.'
  )
  .version('0.0.0');

program
  .command('doctor')
  .description(
    'Check that the database and Anthropic API are reachable, and print the pinned model IDs.'
  )
  .action(async () => {
    const targetModel = readEnv(getTargetModel);
    const judgeModel = readEnv(getJudgeModel);

    console.log(`target model : ${targetModel ?? '(TARGET_MODEL not set)'}`);
    console.log(`judge model  : ${judgeModel ?? '(JUDGE_MODEL not set)'}`);

    const db = await checkDatabaseReachable();
    console.log(
      `database     : ${db.reachable ? 'reachable' : `unreachable (${db.error ?? 'unknown error'})`}`
    );

    const anthropic = await checkAnthropicReachable();
    console.log(
      `anthropic api: ${
        anthropic.reachable ? 'reachable' : `unreachable (${anthropic.error ?? 'unknown error'})`
      }`
    );

    if (!targetModel || !judgeModel || !db.reachable || !anthropic.reachable) {
      process.exitCode = 3; // infrastructure failure, per §7 exit codes
    }
  });

program
  .command('init')
  .description('Scaffold a suite config + example dataset in a directory (defaults to the current one).')
  .argument('[directory]', 'target directory', '.')
  .action((directory: string) => {
    try {
      const { suitePath, casesPath } = runInit(directory);
      console.log(`Scaffolded suite config: ${suitePath}`);
      console.log(`Scaffolded example dataset (2 cases): ${casesPath}`);
      console.log('Edit both, then run `llmreg run` once the runner is built (Phase 3).');
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 3;
    }
  });

program
  .command('migrate')
  .description('Apply pending database migrations (idempotent — safe to run repeatedly).')
  .action(async () => {
    try {
      const { applied, alreadyApplied } = await runMigrations();
      if (applied.length === 0) {
        console.log(`Nothing to apply — ${alreadyApplied.length} migration(s) already up to date.`);
      } else {
        console.log(`Applied ${applied.length} migration(s):`);
        for (const f of applied) {
          console.log(`  - ${f}`);
        }
      }
      await closeDb();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 3;
    }
  });

program
  .command('run')
  .description('Run a suite against the target model, cache-aware.')
  .requiredOption('--suite <path>', 'path to suite.json')
  .requiredOption('--dataset <path>', 'path to dataset.json')
  .requiredOption('--label <label>', 'variant label — "baseline", "candidate", or a git sha')
  .option('--system-prompt-file <path>', 'path to a text file with this variant\'s system prompt')
  .option('--model <model>', 'overrides TARGET_MODEL')
  .option('--temperature <n>', 'overrides TARGET_TEMPERATURE', Number)
  .option('--max-concurrency <n>', 'overrides MAX_CONCURRENCY', Number)
  .option('--sample-count <n>', "repeat-sampling count per case, per §5.3 (default 1)", Number)
  .option('--no-cache', 'disable the response cache for this run')
  .option('--limit <n>', 'only run the first N cases from the dataset', Number)
  .action(async (opts) => {
    try {
      const outcome = await runRunCommand({
        suite: opts.suite,
        dataset: opts.dataset,
        label: opts.label,
        ...(opts.systemPromptFile !== undefined ? { systemPromptFile: opts.systemPromptFile } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxConcurrency !== undefined ? { maxConcurrency: opts.maxConcurrency } : {}),
        ...(opts.sampleCount !== undefined ? { sampleCount: opts.sampleCount } : {}),
        cache: opts.cache,
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      });

      console.log(`Run ${outcome.runId} complete.`);
      console.log(
        `  cases: ${outcome.caseCount}, samples: ${outcome.sampleCount}, cache hits: ${outcome.cacheHits} (${(outcome.cacheHitRate * 100).toFixed(1)}%)`,
      );
      console.log(`  errors: ${outcome.errorCount}`);
      for (const e of outcome.errors) {
        console.log(`    - ${e.externalId} (sample ${e.sampleIndex}): ${e.error}`);
      }

      await closeDb();

      if (outcome.sampleCount > 0 && outcome.errorCount === outcome.sampleCount) {
        process.exitCode = 3; // every single call failed -- infrastructure failure, per §7
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 3;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 3;
});
