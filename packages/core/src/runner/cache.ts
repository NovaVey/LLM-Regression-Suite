/**
 * The response cache per §5.7: keyed so that only relevant edits invalidate.
 * `sha256(model | temperature | prompt_hash | serialized_input | sample_index)`
 * — changing the candidate's prompt changes `prompt_hash`, which changes
 * every one of that variant's cache keys, while an unchanged baseline keeps
 * hitting cache. Backed by the `response_cache` table (§4), keyed on
 * `cache_key` as primary key so a repeated insert of the same key is a
 * no-op rather than a duplicate row or an error.
 */

import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { responseCache } from '../db/schema.js';

export interface CacheKeyParams {
  model: string;
  temperature: number;
  promptHash: string;
  input: unknown;
  sampleIndex: number;
}

/** Hashes a resolved prompt template (a variant's system prompt) into the `prompt_hash` used in the cache key and stored on `variants`. */
export function hashPromptTemplate(promptText: string): string {
  return createHash('sha256').update(promptText).digest('hex');
}

export function computeCacheKey(params: CacheKeyParams): string {
  const serializedInput = JSON.stringify(params.input);
  const raw = `${params.model}|${params.temperature}|${params.promptHash}|${serializedInput}|${params.sampleIndex}`;
  return createHash('sha256').update(raw).digest('hex');
}

export interface CachedEntry {
  output: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function getCachedResponse(cacheKey: string): Promise<CachedEntry | null> {
  const db = getDb();
  const rows = await db.select().from(responseCache).where(eq(responseCache.cacheKey, cacheKey)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  // Touch last_hit_at so hit recency is inspectable later; best-effort, not
  // awaited-for-correctness by the caller (a cache hit is a cache hit
  // whether or not this bookkeeping write lands first).
  await db.update(responseCache).set({ lastHitAt: sql`now()` }).where(eq(responseCache.cacheKey, cacheKey));
  return {
    output: row.output,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  };
}

export async function putCachedResponse(
  cacheKey: string,
  model: string,
  entry: CachedEntry,
): Promise<void> {
  const db = getDb();
  await db
    .insert(responseCache)
    .values({
      cacheKey,
      model,
      output: entry.output,
      latencyMs: entry.latencyMs,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
    })
    .onConflictDoNothing();
}
