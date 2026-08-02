import { contains } from './contains.js';
import { exact } from './exact.js';
import { jsonSchema } from './json.js';
import { latency } from './latency.js';
import { regex } from './regex.js';
import type { Grader } from './types.js';

/**
 * The five deterministic graders per Phase 3. `judge:<name>` graders are
 * Phase 5 work and deliberately not registered here — they need
 * calibration-gate wiring this registry doesn't have.
 */
const registry: Record<string, Grader> = {
  exact,
  contains,
  regex,
  json_schema: jsonSchema,
  latency,
};

export function getGrader(name: string): Grader {
  const grader = registry[name];
  if (!grader) {
    throw new Error(`Unknown grader "${name}". Known graders: ${Object.keys(registry).join(', ')}`);
  }
  return grader;
}
