// Written from:
//   - §4 (data model): `cases.external_id` is "stable, human-authored" and
//     carries `unique (suite_id, external_id)`; `cases.critical boolean`;
//     `cases.tags text[]`.
//   - §9 Phase 2: "Schema, loaders, YAML/JSON suite config with graders and
//     thresholds, tags, critical flags... validation rejects a malformed
//     config with a specific message."
//   - §5.9: "The check fails loudly, never silently... It never passes by
//     default because something went wrong upstream." Applied here to the
//     loader itself: a malformed file must fail with a *named* reason, not
//     a generic "invalid config" or a raw, uncaught parser exception.
//   - The interface contract handed down for this phase (Case, GraderConfig,
//     SuiteConfig, DatasetValidationError, loadSuiteConfig, loadCases).
//
// `packages/core/src/dataset/{schema,load,split}.ts` were confirmed EMPTY
// (`ls` before writing this file) and were not read. Every expected value
// and every rejected-input case below is derived from the contract text
// above and from the data model in §4, not from any implementation.
//
// ---------------------------------------------------------------------
// Message-content assertions
// ---------------------------------------------------------------------
// Per the task brief: "an assertion that the thrown error is a
// DatasetValidationError AND that its message actually names the problem
// (not just 'invalid config')". Each rejection test below asserts both
// (a) the error is a `DatasetValidationError` instance, and (b) the
// message contains the specific offending field name (using `\b` word
// boundaries where the field name is a common English word, so the
// assertion can't pass by coincidentally matching a substring of an
// unrelated word).
//
// ---------------------------------------------------------------------
// AMBIGUITY noted, not silently resolved
// ---------------------------------------------------------------------
// The contract's `loadCases` doc comment explicitly lists "malformed JSON"
// and "non-array top level" as rejection cases with a *specific* message,
// but says nothing about the exact wording required, and `loadSuiteConfig`'s
// doc comment doesn't call out JSON-parse-failure explicitly at all (only
// "on any malformed input"). The malformed-JSON tests below therefore only
// assert `instanceof DatasetValidationError` with a non-empty message,
// not a specific substring -- asserting particular wording for a JSON
// syntax error was not something the contract specified precisely enough
// to derive independently, and I did not want to smuggle in an implied
// stylistic preference no section of the spec actually states.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSuiteConfig, loadCases, DatasetValidationError } from '../../src/dataset/load.js';
import type { Case, SuiteConfig } from '../../src/dataset/schema.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llmreg-dataset-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJSON(name: string, data: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  return path;
}

function writeRaw(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ===========================================================================
// loadSuiteConfig
// ===========================================================================

const validConfig: SuiteConfig = {
  name: 'support-agent',
  description: 'Support agent regression suite',
  graders: [
    { name: 'exact' },
    { name: 'contains', weight: 1 },
    { name: 'judge:helpfulness', weight: 2, config: { rubric: 'Rate helpfulness from 0 to 1' } },
  ],
  thresholds: {
    significanceAlpha: 0.05,
    mdeCeiling: 0.08,
    minPairedN: 30,
    judgeKappaFloor: 0.6,
  },
};

describe('a-well-formed-suite-config-loads-with-all-fields-preserved', () => {
  it('a-well-formed-suite-config-loads-with-all-fields-preserved', () => {
    const path = writeJSON('suite.json', validConfig);
    const loaded = loadSuiteConfig(path);
    expect(loaded).toEqual(validConfig);
    // Spot-check the specific values a bug could silently corrupt (e.g.
    // truncating the graders array, or coercing threshold numbers).
    expect(loaded.name).toBe('support-agent');
    expect(loaded.graders).toHaveLength(3);
    expect(loaded.graders[2]?.name).toBe('judge:helpfulness');
    expect(loaded.graders[2]?.config).toEqual({ rubric: 'Rate helpfulness from 0 to 1' });
    expect(loaded.thresholds.significanceAlpha).toBe(0.05);
    expect(loaded.thresholds.mdeCeiling).toBe(0.08);
    expect(loaded.thresholds.minPairedN).toBe(30);
    expect(loaded.thresholds.judgeKappaFloor).toBe(0.6);
  });

  it('an-optional-description-field-may-be-omitted', () => {
    // description is `description?: string` in the contract -- must not be
    // wrongly required.
    const { description, ...withoutDescription } = validConfig;
    const path = writeJSON('suite.json', withoutDescription);
    expect(() => loadSuiteConfig(path)).not.toThrow();
  });

  it('a-grader-with-only-a-name-and-no-weight-or-config-loads-fine', () => {
    // weight and config are both optional per `GraderConfig`.
    const cfg = structuredClone(validConfig);
    cfg.graders = [{ name: 'exact' }];
    const path = writeJSON('suite.json', cfg);
    expect(() => loadSuiteConfig(path)).not.toThrow();
  });
});

describe('a-suite-config-missing-the-name-field-is-rejected-with-a-message-naming-name', () => {
  it('a-suite-config-missing-the-name-field-is-rejected-with-a-message-naming-name', () => {
    const cfg: any = structuredClone(validConfig);
    delete cfg.name;
    const path = writeJSON('suite.json', cfg);

    expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
    let error: unknown;
    try {
      loadSuiteConfig(path);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DatasetValidationError);
    expect((error as Error).message).toMatch(/\bname\b/i);
    // Guard against a generic message that would make the assertion above
    // vacuous (e.g. "invalid config" doesn't contain "name" but neither
    // does a message that happens to mention "graders" -- this just
    // confirms the message isn't the empty-content failure mode described
    // in the task brief).
    expect((error as Error).message.toLowerCase()).not.toBe('invalid config');
  });
});

describe('a-significance-alpha-outside-the-open-unit-interval-is-rejected-with-a-message-naming-the-field', () => {
  it.each([0, 1, -0.1, 1.5, 2])('rejects thresholds.significanceAlpha = %p', (badAlpha) => {
    const cfg = structuredClone(validConfig);
    cfg.thresholds.significanceAlpha = badAlpha;
    const path = writeJSON('suite.json', cfg);

    expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
    expect(() => loadSuiteConfig(path)).toThrow(/significanceAlpha/i);
  });

  it('accepts significanceAlpha values just inside the open interval', () => {
    // Control: 0.001 and 0.999 are valid (strictly inside (0,1)) so the
    // rejection above is provably about the boundary, not about validation
    // being over-eager and rejecting everything.
    for (const okAlpha of [0.001, 0.5, 0.999]) {
      const cfg = structuredClone(validConfig);
      cfg.thresholds.significanceAlpha = okAlpha;
      const path = writeJSON(`suite-ok-${okAlpha}.json`, cfg);
      expect(() => loadSuiteConfig(path)).not.toThrow();
    }
  });
});

describe('a-non-array-graders-field-is-rejected-with-a-message-naming-graders', () => {
  it.each([
    ['a string', 'not-an-array'],
    ['an object', { name: 'exact' }],
    ['null', null],
  ])('rejects graders as %s', (_label, badGraders) => {
    const cfg: any = structuredClone(validConfig);
    cfg.graders = badGraders;
    const path = writeJSON('suite.json', cfg);

    expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
    expect(() => loadSuiteConfig(path)).toThrow(/graders/i);
  });
});

describe('a-suite-config-missing-a-threshold-field-entirely-is-rejected-with-a-message-naming-it', () => {
  it('a-suite-config-missing-a-threshold-field-entirely-is-rejected-with-a-message-naming-it', () => {
    const cfg: any = structuredClone(validConfig);
    delete cfg.thresholds.mdeCeiling;
    const path = writeJSON('suite.json', cfg);

    expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
    expect(() => loadSuiteConfig(path)).toThrow(/mdeCeiling/i);
  });

  it('a-suite-config-with-no-thresholds-object-at-all-is-rejected', () => {
    const cfg: any = structuredClone(validConfig);
    delete cfg.thresholds;
    const path = writeJSON('suite.json', cfg);

    expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
    expect(() => loadSuiteConfig(path)).toThrow(/thresholds/i);
  });
});

// --- Additional coverage beyond the requested 3-4 malformations, because
// the contract states explicit numeric ranges for the other three
// threshold fields too ("mdeCeiling: number; // > 0", "minPairedN: number;
// // integer >= 1", "judgeKappaFloor: number; // in (0, 1)") and each is a
// distinct, independently testable guarantee.
describe('threshold-values-outside-their-documented-ranges-are-rejected', () => {
  it('rejects a non-positive mdeCeiling', () => {
    for (const bad of [0, -0.1]) {
      const cfg = structuredClone(validConfig);
      cfg.thresholds.mdeCeiling = bad;
      const path = writeJSON(`suite-mde-${bad}.json`, cfg);
      expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
      expect(() => loadSuiteConfig(path)).toThrow(/mdeCeiling/i);
    }
  });

  it('rejects a minPairedN that is not a positive integer', () => {
    for (const bad of [0, -1, 2.5]) {
      const cfg = structuredClone(validConfig);
      cfg.thresholds.minPairedN = bad;
      const path = writeJSON(`suite-minn-${bad}.json`, cfg);
      expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
      expect(() => loadSuiteConfig(path)).toThrow(/minPairedN/i);
    }
  });

  it('rejects a judgeKappaFloor outside the open unit interval', () => {
    for (const bad of [0, 1, -0.2, 1.1]) {
      const cfg = structuredClone(validConfig);
      cfg.thresholds.judgeKappaFloor = bad;
      const path = writeJSON(`suite-kappa-${bad}.json`, cfg);
      expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
      expect(() => loadSuiteConfig(path)).toThrow(/judgeKappaFloor/i);
    }
  });
});

// --- Additional coverage: the load.ts doc comment calls out "unknown
// grader name shape" as a rejection case distinct from "graders not an
// array" -- a grader *entry* without a usable name.
describe('a-grader-entry-without-a-name-is-rejected', () => {
  it('a-grader-entry-without-a-name-is-rejected', () => {
    const cfg: any = structuredClone(validConfig);
    cfg.graders = [{ weight: 1 }];
    const path = writeJSON('suite.json', cfg);

    expect(() => loadSuiteConfig(path)).toThrow(DatasetValidationError);
    expect(() => loadSuiteConfig(path)).toThrow(/name/i);
  });
});

describe('malformed-json-in-a-suite-config-file-is-rejected-as-a-dataset-validation-error-not-a-raw-syntax-error', () => {
  it('malformed-json-in-a-suite-config-file-is-rejected-as-a-dataset-validation-error-not-a-raw-syntax-error', () => {
    // §5.9: the check "fails loudly, never silently" and never passes by
    // default because something went wrong upstream. A raw, uncaught
    // SyntaxError leaking out of the loader is exactly the kind of
    // unstructured failure that principle exists to prevent -- callers
    // (the CLI, the CI check) need a single, catchable error type.
    const path = writeRaw('suite.json', '{ "name": "support-agent", ');
    let error: unknown;
    try {
      loadSuiteConfig(path);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DatasetValidationError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(typeof (error as Error).message).toBe('string');
    expect((error as Error).message.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// loadCases
// ===========================================================================

const validCases: Case[] = [
  {
    externalId: 'refund-past-window',
    input: { messages: [{ role: 'user', content: 'Can I get a refund? It has been 45 days.' }] },
    expected: null,
    tags: ['refunds', 'critical-path'],
    critical: true,
    criticalReason: 'Refund eligibility mistakes cause direct financial harm.',
  },
  {
    externalId: 'greeting-basic',
    input: { messages: [{ role: 'user', content: 'Hi there' }] },
    expected: null,
    tags: ['tone'],
    critical: false,
    criticalReason: null,
  },
  {
    externalId: 'escalation-angry-customer',
    input: { messages: [{ role: 'user', content: 'This is unacceptable, I want a manager now.' }] },
    expected: { mustContain: 'escalate' },
    tags: ['escalation', 'tone'],
    critical: true,
    criticalReason: 'Failing to escalate a hostile customer is a safety-relevant failure.',
  },
];

describe('well-formed-cases-load-with-all-fields-preserved', () => {
  it('well-formed-cases-load-with-all-fields-preserved', () => {
    const path = writeJSON('cases.json', validCases);
    const loaded = loadCases(path);
    expect(loaded).toEqual(validCases);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]?.critical).toBe(true);
    expect(loaded[0]?.criticalReason).toBe('Refund eligibility mistakes cause direct financial harm.');
    expect(loaded[1]?.critical).toBe(false);
    expect(loaded[1]?.criticalReason).toBeNull();
    expect(loaded[2]?.expected).toEqual({ mustContain: 'escalate' });
  });
});

describe('a-critical-case-with-a-null-or-empty-critical-reason-is-rejected', () => {
  it('rejects criticalReason: null when critical is true', () => {
    const cases = structuredClone(validCases);
    cases[0]!.critical = true;
    cases[0]!.criticalReason = null;
    const path = writeJSON('cases.json', cases);

    expect(() => loadCases(path)).toThrow(DatasetValidationError);
    expect(() => loadCases(path)).toThrow(/criticalReason/i);
  });

  it('rejects criticalReason: "" (empty string) when critical is true', () => {
    const cases = structuredClone(validCases);
    cases[0]!.critical = true;
    // Type-valid (criticalReason: string | null admits ''), but violates
    // the "non-empty" business rule the loader must enforce at runtime.
    cases[0]!.criticalReason = '';
    const path = writeJSON('cases.json', cases);

    expect(() => loadCases(path)).toThrow(DatasetValidationError);
    expect(() => loadCases(path)).toThrow(/criticalReason/i);
  });
});

describe('a-non-critical-case-with-a-non-null-critical-reason-is-rejected', () => {
  it('a-non-critical-case-with-a-non-null-critical-reason-is-rejected', () => {
    const cases = structuredClone(validCases);
    cases[1]!.critical = false;
    cases[1]!.criticalReason = 'this should not be here';
    const path = writeJSON('cases.json', cases);

    expect(() => loadCases(path)).toThrow(DatasetValidationError);
    expect(() => loadCases(path)).toThrow(/criticalReason/i);
  });
});

describe('duplicate-external-ids-across-cases-are-rejected', () => {
  it('duplicate-external-ids-across-cases-are-rejected', () => {
    // §4: `unique (suite_id, external_id)` -- externalId must be unique
    // within a suite's case set.
    const cases = structuredClone(validCases);
    cases[1]!.externalId = cases[0]!.externalId; // both become 'refund-past-window'
    const path = writeJSON('cases.json', cases);

    let error: unknown;
    try {
      loadCases(path);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DatasetValidationError);
    expect((error as Error).message).toMatch(/externalId/i);
    // The message should name *which* id collided, not just that a
    // collision occurred -- that's the difference between "actionable"
    // and merely "specific-sounding."
    expect((error as Error).message).toContain('refund-past-window');
  });
});

describe('a-case-missing-tags-or-with-tags-not-an-array-is-rejected', () => {
  it('rejects a case with the tags field missing entirely', () => {
    const cases: any = structuredClone(validCases);
    delete cases[0].tags;
    const path = writeJSON('cases.json', cases);

    expect(() => loadCases(path)).toThrow(DatasetValidationError);
    expect(() => loadCases(path)).toThrow(/tags/i);
  });

  it('rejects a case whose tags field is not an array', () => {
    const cases: any = structuredClone(validCases);
    cases[0].tags = 'refunds'; // a bare string, not an array of strings
    const path = writeJSON('cases.json', cases);

    expect(() => loadCases(path)).toThrow(DatasetValidationError);
    expect(() => loadCases(path)).toThrow(/tags/i);
  });
});

// --- Additional coverage: the load.ts doc comment explicitly promises
// rejection of "non-array top level" and "malformed JSON" with a specific
// message, distinct from per-case field problems.
describe('a-non-array-top-level-cases-file-is-rejected', () => {
  it('a-non-array-top-level-cases-file-is-rejected', () => {
    const path = writeJSON('cases.json', { notAnArray: true });

    let error: unknown;
    try {
      loadCases(path);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DatasetValidationError);
    expect((error as Error).message).toMatch(/array/i);
  });
});

describe('malformed-json-in-a-cases-file-is-rejected-as-a-dataset-validation-error-not-a-raw-syntax-error', () => {
  it('malformed-json-in-a-cases-file-is-rejected-as-a-dataset-validation-error-not-a-raw-syntax-error', () => {
    const path = writeRaw('cases.json', '[ { "externalId": "x", ');
    let error: unknown;
    try {
      loadCases(path);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DatasetValidationError);
    expect(error).not.toBeInstanceOf(SyntaxError);
  });
});
