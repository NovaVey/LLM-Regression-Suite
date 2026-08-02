/**
 * Loads and validates suite config and case-dataset JSON files from disk.
 *
 * Hand-rolled rather than a schema library (Zod, ajv, etc.): this repo's
 * own stance on dependencies (see docs/DECISIONS.md, "Statistics
 * implemented in-repo") is that anything short enough to verify by hand and
 * central to trusting the tool's output is worth writing directly. Config
 * validation errors are also this project's first line of "fails loudly,
 * never silently, with a specific reason" (§5.9) — a library's generic
 * error shape would need translating into that voice anyway.
 *
 * Every validation failure throws `DatasetValidationError` with a message
 * that names the exact field and what's wrong with it — never a bare
 * "invalid config".
 */

import { readFileSync } from 'node:fs';
import type { Case, GraderConfig, SuiteConfig } from './schema.js';

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetValidationError';
  }
}

function readJsonFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new DatasetValidationError(
      `Could not read file at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new DatasetValidationError(
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

export function loadSuiteConfig(path: string): SuiteConfig {
  const data = readJsonFile(path);
  if (!isPlainObject(data)) {
    throw new DatasetValidationError(
      `${path}: suite config must be a JSON object, got ${describeType(data)}`,
    );
  }

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    throw new DatasetValidationError(`${path}: "name" is required and must be a non-empty string`);
  }
  if (data.description !== undefined && typeof data.description !== 'string') {
    throw new DatasetValidationError(`${path}: "description" must be a string if present`);
  }
  if (!Array.isArray(data.graders)) {
    throw new DatasetValidationError(`${path}: "graders" is required and must be an array`);
  }
  const graders: GraderConfig[] = data.graders.map((g, i) => validateGrader(g, i, path));

  if (!isPlainObject(data.thresholds)) {
    throw new DatasetValidationError(`${path}: "thresholds" is required and must be an object`);
  }
  const thresholds = validateThresholds(data.thresholds, path);

  return {
    name: data.name,
    ...(data.description !== undefined ? { description: data.description as string } : {}),
    graders,
    thresholds,
  };
}

function validateGrader(raw: unknown, index: number, path: string): GraderConfig {
  if (!isPlainObject(raw)) {
    throw new DatasetValidationError(`${path}: graders[${index}] must be an object`);
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new DatasetValidationError(
      `${path}: graders[${index}].name is required and must be a non-empty string`,
    );
  }
  if (raw.weight !== undefined && (typeof raw.weight !== 'number' || !Number.isFinite(raw.weight))) {
    throw new DatasetValidationError(`${path}: graders[${index}].weight must be a finite number if present`);
  }
  if (raw.config !== undefined && !isPlainObject(raw.config)) {
    throw new DatasetValidationError(`${path}: graders[${index}].config must be an object if present`);
  }
  return {
    name: raw.name,
    ...(raw.weight !== undefined ? { weight: raw.weight as number } : {}),
    ...(raw.config !== undefined ? { config: raw.config as Record<string, unknown> } : {}),
  };
}

function requireRangeField(
  thresholds: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  path: string,
): number {
  const value = thresholds[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DatasetValidationError(`${path}: thresholds.${field} is required and must be a number`);
  }
  if (!(value > min && value < max)) {
    throw new DatasetValidationError(
      `${path}: thresholds.${field} must be strictly between ${min} and ${max}, got ${value}`,
    );
  }
  return value;
}

function validateThresholds(
  thresholds: Record<string, unknown>,
  path: string,
): SuiteConfig['thresholds'] {
  const significanceAlpha = requireRangeField(thresholds, 'significanceAlpha', 0, 1, path);
  const judgeKappaFloor = requireRangeField(thresholds, 'judgeKappaFloor', 0, 1, path);

  const mdeCeiling = thresholds.mdeCeiling;
  if (typeof mdeCeiling !== 'number' || !Number.isFinite(mdeCeiling) || mdeCeiling <= 0) {
    throw new DatasetValidationError(
      `${path}: thresholds.mdeCeiling is required and must be a positive number`,
    );
  }

  const minPairedN = thresholds.minPairedN;
  if (typeof minPairedN !== 'number' || !Number.isInteger(minPairedN) || minPairedN < 1) {
    throw new DatasetValidationError(
      `${path}: thresholds.minPairedN is required and must be an integer >= 1`,
    );
  }

  return { significanceAlpha, mdeCeiling, minPairedN, judgeKappaFloor };
}

export function loadCases(path: string): Case[] {
  const data = readJsonFile(path);
  if (!Array.isArray(data)) {
    throw new DatasetValidationError(`${path}: dataset must be a top-level JSON array, got ${describeType(data)}`);
  }

  const seenIds = new Set<string>();
  return data.map((raw, index) => validateCase(raw, index, path, seenIds));
}

function validateCase(raw: unknown, index: number, path: string, seenIds: Set<string>): Case {
  if (!isPlainObject(raw)) {
    throw new DatasetValidationError(`${path}: cases[${index}] must be an object`);
  }

  if (typeof raw.externalId !== 'string' || raw.externalId.trim() === '') {
    throw new DatasetValidationError(
      `${path}: cases[${index}].externalId is required and must be a non-empty string`,
    );
  }
  if (seenIds.has(raw.externalId)) {
    throw new DatasetValidationError(
      `${path}: duplicate externalId "${raw.externalId}" — externalId must be unique within a suite`,
    );
  }
  seenIds.add(raw.externalId);
  const label = `cases[${index}] ("${raw.externalId}")`;

  if (!isPlainObject(raw.input) || !Array.isArray(raw.input.messages)) {
    throw new DatasetValidationError(`${path}: ${label}.input.messages is required and must be an array`);
  }
  const messages = raw.input.messages;
  messages.forEach((m, mi) => {
    if (!isPlainObject(m) || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new DatasetValidationError(
        `${path}: ${label}.input.messages[${mi}] must be { role: "user"|"assistant", content: string }`,
      );
    }
  });

  if (!('expected' in raw)) {
    throw new DatasetValidationError(
      `${path}: ${label}.expected is required (use null when only graders apply)`,
    );
  }

  if (
    !Array.isArray(raw.tags) ||
    raw.tags.length === 0 ||
    !raw.tags.every((t) => typeof t === 'string' && t.trim() !== '')
  ) {
    throw new DatasetValidationError(
      `${path}: ${label}.tags is required and must be a non-empty array of non-empty strings`,
    );
  }

  if (typeof raw.critical !== 'boolean') {
    throw new DatasetValidationError(`${path}: ${label}.critical is required and must be a boolean`);
  }

  const criticalReason = raw.criticalReason;
  if (raw.critical) {
    if (typeof criticalReason !== 'string' || criticalReason.trim() === '') {
      throw new DatasetValidationError(
        `${path}: ${label} is critical but has no criticalReason — a written reason is required, per §5.6`,
      );
    }
  } else if (criticalReason !== null && criticalReason !== undefined) {
    throw new DatasetValidationError(
      `${path}: ${label} has critical=false but a non-null criticalReason — set criticalReason to null when critical is false`,
    );
  }

  return {
    externalId: raw.externalId,
    input: { messages: messages as Case['input']['messages'] },
    expected: raw.expected,
    tags: raw.tags as string[],
    critical: raw.critical,
    criticalReason: raw.critical ? (criticalReason as string) : null,
  };
}
