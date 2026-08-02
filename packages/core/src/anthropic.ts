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
