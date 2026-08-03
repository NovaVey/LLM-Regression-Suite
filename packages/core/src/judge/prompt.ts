/**
 * Judge prompt construction per §5.5 / Phase 5: "Judge prompt with an
 * explicit rubric and required rationale."
 *
 * Split into a stable system prompt (the rubric + output-format
 * instructions — this is what `judge_prompt_hash` hashes, so editing the
 * rubric invalidates calibration per §5.5) and a per-case user message
 * (the conversation + candidate output being judged — this varies every
 * call and must NOT be part of the hash, or every case would look like a
 * different judge prompt).
 */

import type { TargetMessage } from '../anthropic.js';
import type { GraderConfig } from '../dataset/schema.js';

export interface JudgeRubric {
  /** e.g. "helpfulness" — combined with this prefix to form the grader key "judge:helpfulness". */
  name: string;
  /** What this dimension measures, one line. */
  description: string;
  /** The full rubric: what a 0, a 0.5, and a 1 look like. Concrete, not vague adjectives alone. */
  criteria: string;
}

const RESPONSE_FORMAT_INSTRUCTIONS = `Respond with a single JSON object and nothing else — no markdown fences, no commentary before or after it. The object must have exactly these two fields:

{
  "score": <number between 0 and 1, inclusive>,
  "rationale": "<one or two sentences explaining the score, citing something specific in the output — not a restatement of the rubric>"
}

A rationale is required on every response, including a perfect or a zero score. "N/A" or an empty string is not an acceptable rationale.`;

/**
 * The stable, hashed part of the judge prompt. Editing `rubric.criteria`
 * (or `rubric.description`) changes this string, which changes
 * `judge_prompt_hash`, which invalidates any existing calibration per
 * §5.5 — this is intentional and is the whole point of hashing it.
 */
/** Derives a JudgeRubric from a suite config's `judge:<name>` grader entry — shared by the runner, the comparison gate, and the calibrate CLI so all three hash the identical prompt for the identical rubric. */
export function rubricFromGraderConfig(graderConfig: GraderConfig): JudgeRubric {
  const name = graderConfig.name.slice('judge:'.length);
  const config = graderConfig.config ?? {};
  return {
    name,
    description: typeof config.description === 'string' ? config.description : '',
    criteria: typeof config.criteria === 'string' ? config.criteria : '',
  };
}

export function buildJudgeSystemPrompt(rubric: JudgeRubric): string {
  return `You are grading a single AI assistant response on exactly one dimension: ${rubric.name}.

${rubric.description}

Rubric:
${rubric.criteria}

${RESPONSE_FORMAT_INSTRUCTIONS}`;
}

/**
 * The per-case content: the conversation the target model was given, and
 * the output it produced, which this call is grading. Deliberately does
 * NOT include the target's own system prompt or any other variant-specific
 * configuration — the judge should grade the output on its merits against
 * the rubric, not learn to recognize which variant produced it.
 */
export function buildJudgeUserMessage(caseMessages: readonly TargetMessage[], candidateOutput: string): string {
  const conversation = caseMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  return `CONVERSATION:
${conversation}

RESPONSE TO GRADE:
${candidateOutput}`;
}
