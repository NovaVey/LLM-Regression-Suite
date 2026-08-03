import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  buildJudgeSystemPrompt,
  cohensKappa,
  computeBiasNote,
  getJudgeModel,
  getHumanLabelsForGrader,
  getJudgeGradesForCalibration,
  getRunOutputsForCalibration,
  hashPromptTemplate,
  loadSuiteConfig,
  matchLabelsToJudgeGrades,
  recordHumanLabel,
  rubricFromGraderConfig,
  saveCalibration,
  stratifiedSample,
} from '@llmreg/core';
import type { SampledOutput } from '@llmreg/core';

export interface CalibrateCommandOptions {
  suite: string;
  run: string;
  grader: string;
  sampleSize?: number;
  seed?: number;
  labeledBy?: string;
  /**
   * Path to a JSON file of `{ externalId: score }` labels. When set, labels
   * are read from this file instead of prompted for interactively — this is
   * for scripted labeling sessions (e.g. mechanically verifying the
   * calibration pipeline against clearly-disclosed synthetic labels). A real
   * calibration per §5.5 ("a human labels them") omits this and labels
   * interactively.
   */
  labelsFile?: string;
  judgeModel?: string;
}

export interface CalibrateCommandOutcome {
  calibrationId: string;
  grader: string;
  judgeModel: string;
  sampledCount: number;
  labelCount: number;
  cohensKappa: number;
  agreementRate: number;
  confusionMatrix: { bothPass: number; humanPassJudgeFail: number; humanFailJudgePass: number; bothFail: number };
  biasNote: string;
  passed: boolean;
  judgeKappaFloor: number;
}

async function collectLabelsInteractively(samples: SampledOutput[], grader: string, labeledBy: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      `\nLabeling ${samples.length} sampled outputs for "${grader}". Enter a score from 0 to 1 (e.g. "1", "0", "0.5"), or "skip".\n`,
    );
    for (const [i, sample] of samples.entries()) {
      console.log(`\n--- [${i + 1}/${samples.length}] ${sample.externalId} (tags: ${sample.tags.join(', ') || 'none'}) ---`);
      console.log(sample.output);
      if (sample.judgeScore !== null) {
        console.log(`(judge scored this output ${sample.judgeScore})`);
      }
      const answer = (await rl.question('Your score: ')).trim();
      if (answer === '' || answer.toLowerCase() === 'skip') {
        continue;
      }
      const score = Number(answer);
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        console.log(`  ignored -- "${answer}" is not a number in [0, 1]`);
        continue;
      }
      await recordHumanLabel({ caseId: sample.caseId, outputHash: sample.outputHash, grader, score, labeledBy });
    }
  } finally {
    rl.close();
  }
}

async function collectLabelsFromFile(
  samples: SampledOutput[],
  grader: string,
  labeledBy: string,
  labelsFile: string,
): Promise<void> {
  const raw = JSON.parse(readFileSync(labelsFile, 'utf8')) as Record<string, number>;
  const byExternalId = new Map(samples.map((s) => [s.externalId, s]));
  for (const [externalId, score] of Object.entries(raw)) {
    const sample = byExternalId.get(externalId);
    if (!sample) {
      // A label for a case outside this sample (or this run) -- not an
      // error, just nothing to attach it to.
      continue;
    }
    await recordHumanLabel({ caseId: sample.caseId, outputHash: sample.outputHash, grader, score, labeledBy });
  }
}

export async function runCalibrateCommand(options: CalibrateCommandOptions): Promise<CalibrateCommandOutcome> {
  const suiteConfig = loadSuiteConfig(options.suite);
  const graderConfig = suiteConfig.graders.find((g) => g.name === options.grader);
  if (!graderConfig || !graderConfig.name.startsWith('judge:')) {
    throw new Error(`"${options.grader}" is not a judge:* grader configured on this suite.`);
  }

  const judgeModel = options.judgeModel ?? getJudgeModel();
  const rubric = rubricFromGraderConfig(graderConfig);
  const judgePromptHash = hashPromptTemplate(buildJudgeSystemPrompt(rubric));

  const allOutputs = await getRunOutputsForCalibration(options.run, options.grader);
  if (allOutputs.length === 0) {
    throw new Error(`Run ${options.run} has no successful outputs graded by "${options.grader}".`);
  }
  const suiteId = allOutputs[0]!.suiteId;

  const sampleSize = options.sampleSize ?? 100;
  const seed = options.seed ?? 1;
  const samples = stratifiedSample(allOutputs, sampleSize, (o) => o.tags.join(',') || '(untagged)', seed);

  const labeledBy = options.labeledBy ?? process.env.USER ?? process.env.USERNAME ?? 'unknown';

  if (options.labelsFile !== undefined) {
    await collectLabelsFromFile(samples, options.grader, labeledBy, options.labelsFile);
  } else {
    await collectLabelsInteractively(samples, options.grader, labeledBy);
  }

  const [labels, judgeGrades] = await Promise.all([
    getHumanLabelsForGrader(suiteId, options.grader),
    getJudgeGradesForCalibration(options.run, options.grader),
  ]);

  const matched = matchLabelsToJudgeGrades(labels, judgeGrades);
  if (matched.length === 0) {
    throw new Error(
      'No human labels matched a judge grade by output_hash -- nothing to compute kappa from. ' +
        'Label some outputs first (labels are collected above this error, so re-run to label more).',
    );
  }

  const humanPassed = matched.map((m) => m.humanScore >= 0.5);
  const judgePassed = matched.map((m) => m.judgeScore >= 0.5);
  const kappa = cohensKappa(humanPassed, judgePassed);
  const biasNote = computeBiasNote(matched);
  const passed = kappa.cohensKappa >= suiteConfig.thresholds.judgeKappaFloor;

  const calibrationId = await saveCalibration({
    suiteId,
    grader: options.grader,
    judgeModel,
    judgePromptHash,
    labelCount: kappa.labelCount,
    cohensKappa: kappa.cohensKappa,
    agreementRate: kappa.agreementRate,
    biasNote,
    passed,
  });

  return {
    calibrationId,
    grader: options.grader,
    judgeModel,
    sampledCount: samples.length,
    labelCount: kappa.labelCount,
    cohensKappa: kappa.cohensKappa,
    agreementRate: kappa.agreementRate,
    confusionMatrix: kappa.confusionMatrix,
    biasNote,
    passed,
    judgeKappaFloor: suiteConfig.thresholds.judgeKappaFloor,
  };
}
