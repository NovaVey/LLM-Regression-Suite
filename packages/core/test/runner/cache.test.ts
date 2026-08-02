// Written from:
//   - §5.7: "The cache is keyed so that only relevant edits invalidate.
//     sha256(model | temperature | prompt_hash | serialized_input |
//     sample_index)."
//   - §4 `response_cache.cache_key`: "sha256(model|temp|prompt_hash|
//     input|sample_index)" -- primary key, one row per distinct key.
//   - The interface contract handed down for Phase 3:
//       export interface CacheKeyParams { model: string; temperature: number;
//         promptHash: string; input: unknown; sampleIndex: number }
//       export function computeCacheKey(params: CacheKeyParams): string
//       // sha256 hex, deterministic -- identical params always produce the
//       // identical key, and changing ANY field changes the key.
//
// `packages/core/src/runner/cache.ts` was NOT read before writing this file.
// Everything below is derived from the doc comment on `computeCacheKey` and
// the literal "sha256(...)" wording of §5.7/§4 -- both of which make
// specific, checkable claims: (1) determinism, (2) sensitivity to every one
// of the five inputs individually, (3) the output shape of a sha256 hex
// digest (64 lowercase hex characters). None of these require knowing the
// exact serialization the implementation chose internally.
//
// ---------------------------------------------------------------------
// AMBIGUITY noted, not silently resolved
// ---------------------------------------------------------------------
// The contract does not say whether `computeCacheKey` deep-equality-compares
// `input` structurally or requires reference equality. §5.7's whole premise
// -- "only relevant edits invalidate" -- only makes sense if two calls
// across two separate process runs (which can never share object identity)
// still produce the same key for the same logical input. The determinism
// test below therefore explicitly uses a deep-equal-but-distinct object for
// `input` on the second call, which is the only reading consistent with the
// cache being useful across runs at all.

import { describe, it, expect } from 'vitest';
import { computeCacheKey, type CacheKeyParams } from '../../src/runner/cache.js';

const base: CacheKeyParams = {
  model: 'claude-sonnet-5',
  temperature: 0,
  promptHash: 'prompt-hash-aaa',
  input: { messages: [{ role: 'user', content: 'Can I get a refund?' }] },
  sampleIndex: 0,
};

describe('computeCacheKey', () => {
  it('identical-params-produce-the-identical-key-even-with-a-freshly-built-input-object', () => {
    const first = computeCacheKey(base);
    // A structurally-identical but reference-distinct `input`, as would
    // happen loading the same dataset file in two separate `llmreg run`
    // invocations.
    const second = computeCacheKey({
      model: 'claude-sonnet-5',
      temperature: 0,
      promptHash: 'prompt-hash-aaa',
      input: { messages: [{ role: 'user', content: 'Can I get a refund?' }] },
      sampleIndex: 0,
    });
    expect(second).toBe(first);
    // And a repeated call with the very same object is of course also equal.
    expect(computeCacheKey(base)).toBe(first);
  });

  it('changing-the-model-changes-the-key', () => {
    const original = computeCacheKey(base);
    const changed = computeCacheKey({ ...base, model: 'claude-opus-5' });
    expect(changed).not.toBe(original);
  });

  it('changing-the-temperature-changes-the-key', () => {
    const original = computeCacheKey(base);
    const changed = computeCacheKey({ ...base, temperature: 0.7 });
    expect(changed).not.toBe(original);
  });

  it('changing-the-prompt-hash-changes-the-key', () => {
    // This is the whole point of §5.7: editing a prompt changes prompt_hash,
    // which must change the cache key so the edit isn't served stale output.
    const original = computeCacheKey(base);
    const changed = computeCacheKey({ ...base, promptHash: 'prompt-hash-bbb' });
    expect(changed).not.toBe(original);
  });

  it('changing-the-input-changes-the-key', () => {
    const original = computeCacheKey(base);
    const changed = computeCacheKey({
      ...base,
      input: { messages: [{ role: 'user', content: 'Can I get a refund? (edited)' }] },
    });
    expect(changed).not.toBe(original);
  });

  it('changing-the-sample-index-changes-the-key', () => {
    // Required so repeat sampling (§5.3) computes and caches each of the k
    // samples independently rather than colliding on one cache entry.
    const original = computeCacheKey(base);
    const changed = computeCacheKey({ ...base, sampleIndex: 1 });
    expect(changed).not.toBe(original);
  });

  it('the-key-is-a-sha256-hex-digest-shaped-string', () => {
    // "sha256(...)" per §5.7/§4 is a literal, checkable claim about shape:
    // exactly 64 lowercase hex characters.
    const key = computeCacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
