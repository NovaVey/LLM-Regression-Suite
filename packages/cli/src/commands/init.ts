import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Case, SuiteConfig } from '@llmreg/core';

const STARTER_SUITE: SuiteConfig = {
  name: 'my-suite',
  description: 'Starter suite scaffolded by `llmreg init` — edit thresholds and graders for your use case.',
  graders: [{ name: 'exact' }],
  thresholds: {
    significanceAlpha: 0.05,
    mdeCeiling: 0.1,
    minPairedN: 30,
    judgeKappaFloor: 0.6,
  },
};

const STARTER_CASES: Case[] = [
  {
    externalId: 'example-case-01',
    input: {
      messages: [{ role: 'user', content: 'Replace this with a real input for your target.' }],
    },
    expected: null,
    tags: ['example'],
    critical: false,
    criticalReason: null,
  },
  {
    externalId: 'example-critical-case-01',
    input: {
      messages: [
        { role: 'user', content: 'Replace this with a case where a wrong answer is unacceptable.' },
      ],
    },
    expected: null,
    tags: ['example'],
    critical: true,
    criticalReason:
      'Replace with a specific, written reason this case is critical — not "important". See §5.6.',
  },
];

/** Scaffolds `suite.json` and `dataset.json` in `targetDir`. Refuses to overwrite. */
export function runInit(targetDir: string): { suitePath: string; casesPath: string } {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const suitePath = join(targetDir, 'suite.json');
  const casesPath = join(targetDir, 'dataset.json');

  for (const path of [suitePath, casesPath]) {
    if (existsSync(path)) {
      throw new Error(
        `${path} already exists — refusing to overwrite. Remove it first if you want to re-scaffold.`,
      );
    }
  }

  writeFileSync(suitePath, `${JSON.stringify(STARTER_SUITE, null, 2)}\n`);
  writeFileSync(casesPath, `${JSON.stringify(STARTER_CASES, null, 2)}\n`);

  return { suitePath, casesPath };
}
