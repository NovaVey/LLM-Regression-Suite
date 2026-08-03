/**
 * Calls the judge model and parses its structured {score, rationale}
 * response. Reuses `callTarget()` (Phase 3) rather than duplicating
 * retry/backoff and the temperature-deprecation fallback — the judge call
 * is mechanically the same kind of Anthropic call as a target call, just
 * with a different system prompt, model, and temperature source.
 */

import { callTarget, type TargetMessage } from '../anthropic.js';
import { buildJudgeSystemPrompt, buildJudgeUserMessage, type JudgeRubric } from './prompt.js';

export interface JudgeCallResult {
  score: number;
  rationale: string;
  latencyMs: number;
  /** Input + output tokens for this judge call, combined (grades.judge_tokens is a single column). */
  judgeTokens: number;
}

class JudgeResponseError extends Error {}

function parseJudgeResponse(raw: string): { score: number; rationale: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new JudgeResponseError(
      `Judge response is not valid JSON: ${err instanceof Error ? err.message : String(err)}. Raw response: ${raw.slice(0, 200)}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JudgeResponseError(`Judge response must be a JSON object, got: ${raw.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;

  const score = obj.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new JudgeResponseError(`Judge response "score" must be a number in [0, 1], got: ${JSON.stringify(score)}`);
  }

  const rationale = obj.rationale;
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    throw new JudgeResponseError(
      `Judge response is missing a required rationale (empty or absent), per Phase 5's "required rationale" — raw response: ${raw.slice(0, 200)}`,
    );
  }

  return { score, rationale: rationale.trim() };
}

export async function callJudge(
  rubric: JudgeRubric,
  caseMessages: readonly TargetMessage[],
  candidateOutput: string,
  judgeModel: string,
  judgeTemperature: number,
): Promise<JudgeCallResult> {
  const systemPrompt = buildJudgeSystemPrompt(rubric);
  const userMessage = buildJudgeUserMessage(caseMessages, candidateOutput);

  const result = await callTarget([{ role: 'user', content: userMessage }], judgeModel, judgeTemperature, {
    systemPrompt,
  });

  const { score, rationale } = parseJudgeResponse(result.output);

  return {
    score,
    rationale,
    latencyMs: result.latencyMs,
    judgeTokens: (result.inputTokens ?? 0) + result.outputTokens,
  };
}
