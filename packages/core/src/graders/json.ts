import type { GraderContext, GradeResult } from './types.js';

/**
 * A deliberately small, documented subset of JSON Schema: `type`,
 * `required`, `properties`, `items`, `enum`. Not full JSON Schema
 * compliance — no $ref, oneOf/anyOf/allOf, pattern, format, or numeric
 * bounds. See docs/DECISIONS.md for why this is hand-rolled rather than a
 * library (ajv) — same reasoning as Phase 2's dataset validation.
 */
export interface MiniSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  required?: string[];
  properties?: Record<string, MiniSchema>;
  items?: MiniSchema;
  enum?: unknown[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: NonNullable<MiniSchema['type']>): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
  }
}

function validate(value: unknown, schema: MiniSchema, path: string): string[] {
  if (schema.enum !== undefined) {
    const serializedEnum = schema.enum.map((e) => JSON.stringify(e));
    if (!serializedEnum.includes(JSON.stringify(value))) {
      return [`${path}: value not in enum ${JSON.stringify(schema.enum)}`];
    }
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    return [`${path}: expected type "${schema.type}", got ${describeType(value)}`];
  }

  const errors: string[] = [];

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    if (schema.properties) {
      for (const [key, subschema] of Object.entries(schema.properties)) {
        if (key in value) {
          errors.push(...validate(value[key], subschema, `${path}.${key}`));
        }
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    const itemSchema = schema.items;
    value.forEach((item, i) => {
      errors.push(...validate(item, itemSchema, `${path}[${i}]`));
    });
  }

  return errors;
}

/**
 * Parses `output` as JSON, then validates against `config.schema` (a
 * MiniSchema, required). Passes iff the output is valid JSON and matches.
 */
export function jsonSchema(ctx: GraderContext): GradeResult {
  const schema = ctx.config?.schema;
  if (!isPlainObject(schema)) {
    throw new Error(
      `json_schema grader for case "${ctx.caseData.externalId}": config.schema is required and must be an object`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.output);
  } catch (err) {
    return {
      score: 0,
      passed: false,
      rationale: `output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const errors = validate(parsed, schema as MiniSchema, '$');
  if (errors.length > 0) {
    return { score: 0, passed: false, rationale: errors.join('; ') };
  }
  return { score: 1, passed: true };
}
