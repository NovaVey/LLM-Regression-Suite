import Anthropic from '@anthropic-ai/sdk';
import type { ReachabilityResult } from './types.js';

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function getTargetModel(): string {
  const model = process.env.TARGET_MODEL;
  if (!model) {
    throw new Error('TARGET_MODEL is not set');
  }
  return model;
}

export function getJudgeModel(): string {
  const model = process.env.JUDGE_MODEL;
  if (!model) {
    throw new Error('JUDGE_MODEL is not set');
  }
  return model;
}

// Uses models.retrieve rather than a completion call: it confirms both the API
// key and the pinned model IDs are valid without spending completion tokens on
// every doctor/health-check run.
export async function checkAnthropicReachable(): Promise<ReachabilityResult> {
  try {
    const anthropic = getAnthropicClient();
    await anthropic.models.retrieve(getTargetModel());
    await anthropic.models.retrieve(getJudgeModel());
    return { reachable: true };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface TargetMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TargetCallResult {
  output: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number;
  /**
   * The API's own reason the response ended -- "end_turn"/"stop_sequence"
   * for a genuinely complete response, "max_tokens" if it was cut off
   * before finishing. Optional (undefined for fake TargetCallers in tests
   * that don't model it) so callers that care -- currently just
   * judge/call.ts, which needs to tell "the judge's JSON is malformed" and
   * "the judge's response was truncated mid-JSON by the token budget" apart
   * -- can, without every existing fake needing to supply it.
   */
  stopReason?: string | null;
}

/**
 * True iff `err` is the specific 400 the API returns when a model rejects
 * an explicit `temperature` outright — confirmed live against claude-sonnet-5
 * ("`temperature` is deprecated for this model"), not assumed. See
 * docs/DECISIONS.md for what this means for §2's temperature-0
 * reproducibility guarantee.
 */
function isTemperatureDeprecatedError(err: unknown): boolean {
  if (!(err && typeof err === 'object' && 'status' in err)) {
    return false;
  }
  if ((err as { status?: number }).status !== 400) {
    return false;
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes('temperature') && message.toLowerCase().includes('deprecated');
}

/**
 * Calls the target model with one case's messages. Retries on transient
 * failures (429 rate limits, 5xx) are delegated to the SDK's own
 * `maxRetries` mechanism (exponential backoff, same conditions we'd
 * otherwise hand-roll — see docs/DECISIONS.md) rather than reimplemented
 * here. Non-transient errors (4xx other than 429) are not retried and
 * propagate to the caller, which is expected to isolate the failure to this
 * one case per §5.1/§5.9 rather than abort the run — except the specific
 * temperature-deprecated 400, which is retried once without `temperature`
 * (see `isTemperatureDeprecatedError`) since some models reject the
 * parameter outright rather than accepting and ignoring it.
 */
export async function callTarget(
  messages: TargetMessage[],
  model: string,
  temperature: number,
  options?: { systemPrompt?: string; maxTokens?: number; maxRetries?: number },
): Promise<TargetCallResult> {
  const anthropic = getAnthropicClient();
  const start = Date.now();
  const maxRetries = options?.maxRetries ?? 3;

  const basePayload = {
    model,
    max_tokens: options?.maxTokens ?? 1024,
    ...(options?.systemPrompt !== undefined ? { system: options.systemPrompt } : {}),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  let response;
  try {
    response = await anthropic.messages.create({ ...basePayload, temperature }, { maxRetries });
  } catch (err) {
    if (!isTemperatureDeprecatedError(err)) {
      throw err;
    }
    response = await anthropic.messages.create(basePayload, { maxRetries });
  }

  const latencyMs = Date.now() - start;
  const textBlock = response.content.find((block) => block.type === 'text');
  const output = textBlock && textBlock.type === 'text' ? textBlock.text : '';

  return {
    output,
    latencyMs,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
}
