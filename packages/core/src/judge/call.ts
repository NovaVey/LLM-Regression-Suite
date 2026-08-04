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

function parseJudgeResponse(raw: string, stopReason?: string | null): { score: number; rationale: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // "Malformed JSON" and "the response was cut off before it finished"
    // are different failures calling for different fixes -- the first
    // means the judge ignored the format instruction, the second means
    // maxTokens was too small for what the judge had to say. Distinguish
    // them rather than reporting every truncated response as generically
    // invalid, per the project's "errors name the fix" rule (README §8/§12).
    if (stopReason === 'max_tokens') {
      throw new JudgeResponseError(
        `Judge response was truncated (stop_reason: max_tokens) before it finished -- this is not malformed JSON, it's an incomplete response. Raw response: ${raw.slice(0, 200)}`,
      );
    }
    if (stopReason === 'refusal') {
      throw new JudgeResponseError(
        'Judge model refused to grade this case/output (stop_reason: refusal) -- not malformed JSON, the judge declined to respond at all.',
      );
    }
    if (raw.trim() === '') {
      throw new JudgeResponseError(
        `Judge model returned no text content at all (stop_reason: ${stopReason ?? 'unknown'}) -- not malformed JSON, there was nothing to parse.`,
      );
    }
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
    // The prompt asks for "one or two sentences," but that's an instruction
    // the model doesn't always follow exactly -- 1024 (callTarget's own
    // default) left too little headroom and produced truncated,
    // unparseable JSON in real runs. A judge rationale is never going to
    // need anywhere near 4096 tokens; this is slack against the model
    // occasionally running longer than asked, not a real ceiling.
    maxTokens: 4096,
  });

  const { score, rationale } = parseJudgeResponse(result.output, result.stopReason);

  return {
    score,
    rationale,
    latencyMs: result.latencyMs,
    judgeTokens: (result.inputTokens ?? 0) + result.outputTokens,
  };
}
