#!/usr/bin/env node
import { Command } from 'commander';
import {
  checkAnthropicReachable,
  checkDatabaseReachable,
  getJudgeModel,
  getTargetModel,
} from '@llmreg/core';
import { runInit } from './commands/init.js';

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

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 3;
});
