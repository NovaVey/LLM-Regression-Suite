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
import { runCalibrateCommand } from './commands/calibrate.js';
import { runCompareCommand } from './commands/compare.js';
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

program
  .command('compare')
  .description('Paired comparison of a baseline run against a candidate run; writes a comparison row.')
  .requiredOption('--suite <path>', 'path to suite.json (for graders and thresholds)')
  .requiredOption('--baseline-run <id>', 'baseline run id')
  .requiredOption('--candidate-run <id>', 'candidate run id')
  .option('--bootstrap-iterations <n>', 'overrides BOOTSTRAP_ITERATIONS', Number)
  .action(async (opts) => {
    try {
      const outcome = await runCompareCommand({
        suite: opts.suite,
        baselineRun: opts.baselineRun,
        candidateRun: opts.candidateRun,
        ...(opts.bootstrapIterations !== undefined ? { bootstrapIterations: opts.bootstrapIterations } : {}),
      });

      const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(4) : String(n));
      console.log(`Comparison ${outcome.comparisonId} complete.`);
      console.log(`  verdict: ${outcome.verdict}`);
      console.log(`  delta: ${fmt(outcome.delta)}  CI: [${fmt(outcome.ciLower)}, ${fmt(outcome.ciUpper)}]  MDE: ${fmt(outcome.mde)}`);
      console.log(
        `  paired: ${outcome.pairedCaseCount}  excluded: ${outcome.excludedCount}  regressed: ${outcome.regressedCount}  fixed: ${outcome.fixedCount}  critical regressed: ${outcome.criticalRegressed}`,
      );

      if (outcome.verdict === 'regression') {
        process.exitCode = 1;
      } else if (outcome.verdict === 'insufficient_data') {
        process.exitCode = 2;
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 3;
    }
  });

program
  .command('calibrate')
  .description('Label a sample of judge-graded outputs and compute Cohen\'s kappa against the judge (§5.5).')
  .requiredOption('--suite <path>', 'path to suite.json')
  .requiredOption('--run <id>', 'run id to sample judge-graded outputs from')
  .requiredOption('--grader <name>', 'the judge:* grader to calibrate, e.g. judge:helpfulness')
  .option('--sample-size <n>', 'stratified sample size, per §5.5 (100-300 recommended)', Number)
  .option('--seed <n>', 'stratified-sample seed, for a reproducible sample', Number)
  .option('--labeled-by <name>', 'identifier recorded on each label (defaults to $USER)')
  .option(
    '--labels-file <path>',
    'JSON file of { externalId: score } -- skips interactive prompting (scripted/synthetic labeling only; a real calibration labels interactively)',
  )
  .option('--judge-model <model>', 'overrides JUDGE_MODEL for the calibration gate check')
  .action(async (opts) => {
    try {
      const outcome = await runCalibrateCommand({
        suite: opts.suite,
        run: opts.run,
        grader: opts.grader,
        ...(opts.sampleSize !== undefined ? { sampleSize: opts.sampleSize } : {}),
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.labeledBy !== undefined ? { labeledBy: opts.labeledBy } : {}),
        ...(opts.labelsFile !== undefined ? { labelsFile: opts.labelsFile } : {}),
        ...(opts.judgeModel !== undefined ? { judgeModel: opts.judgeModel } : {}),
      });

      console.log(`\nCalibration ${outcome.calibrationId} saved for "${outcome.grader}" (${outcome.judgeModel}).`);
      console.log(`  sampled: ${outcome.sampledCount}  labeled+matched: ${outcome.labelCount}`);
      console.log(
        `  cohen's kappa: ${outcome.cohensKappa.toFixed(3)}  raw agreement: ${(outcome.agreementRate * 100).toFixed(1)}%  floor: ${outcome.judgeKappaFloor}`,
      );
      console.log(
        `  confusion matrix: bothPass=${outcome.confusionMatrix.bothPass} humanPassJudgeFail=${outcome.confusionMatrix.humanPassJudgeFail} humanFailJudgePass=${outcome.confusionMatrix.humanFailJudgePass} bothFail=${outcome.confusionMatrix.bothFail}`,
      );
      console.log(`  bias: ${outcome.biasNote}`);
      console.log(`  result: ${outcome.passed ? 'PASSED — this judge may now drive a blocking verdict' : 'FAILED — judge scores remain advisory-only until recalibrated'}`);

      await closeDb();

      if (!outcome.passed) {
        process.exitCode = 2; // uncalibrated/failing judge -- warn-level per §7 exit codes
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
