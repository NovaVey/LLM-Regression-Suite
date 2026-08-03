/**
 * HTTP layer for the Report UI (Phase 9). Every route is a thin wrapper
 * around a `@llmreg/core` loader (packages/core/src/web/load.ts,
 * packages/core/src/report/load.ts) -- this file does routing, status
 * codes, and query/param parsing only; it never touches Drizzle directly.
 * The one exception is the /api/simulations routes, which read
 * `simulations/results/*.json` from disk -- Phase 6 never persisted those
 * to Postgres (see docs/DECISIONS.md), so there is no loader to wrap.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  getCalibrationOverview,
  getCaseDiffDetail,
  getComparisonCaseList,
  getComparisonsForSuite,
  getDatasetOverview,
  getSuiteList,
  loadComparisonReportData,
} from '@llmreg/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/server.js -> packages/api/dist -> up 3 to the repo root, where
// `simulations/` lives (see docs/DECISIONS.md for why this isn't DB-backed).
// Overridable so a deployment that doesn't ship the whole monorepo checkout
// can point this at wherever it copies the results files instead.
const SIMULATIONS_DIR = process.env.SIMULATIONS_DIR ?? join(__dirname, '..', '..', '..', 'simulations', 'results');

function readJsonIfExists(path: string): unknown | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function buildServer() {
  const app = Fastify({ logger: true });

  // The web dev server (Vite, a different origin/port) is this API's only
  // consumer, and this is a self-hosted internal tool, not a multi-tenant
  // service with untrusted origins to guard against -- a permissive CORS
  // policy here is a deliberate scope choice, not an oversight.
  app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/suites', async (_req, reply) => {
    const suites = await getSuiteList();
    return reply.send(suites);
  });

  app.get<{ Params: { suiteId: string } }>('/api/suites/:suiteId/comparisons', async (req, reply) => {
    const comparisons = await getComparisonsForSuite(req.params.suiteId);
    return reply.send(comparisons);
  });

  app.get<{ Params: { suiteId: string } }>('/api/suites/:suiteId/dataset', async (req, reply) => {
    try {
      return reply.send(await getDatasetOverview(req.params.suiteId));
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { suiteId: string } }>('/api/suites/:suiteId/calibrations', async (req, reply) => {
    try {
      return reply.send(await getCalibrationOverview(req.params.suiteId));
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { comparisonId: string } }>('/api/comparisons/:comparisonId', async (req, reply) => {
    try {
      return reply.send(await loadComparisonReportData(req.params.comparisonId));
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { comparisonId: string } }>('/api/comparisons/:comparisonId/cases', async (req, reply) => {
    try {
      return reply.send(await getComparisonCaseList(req.params.comparisonId));
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { comparisonId: string; externalId: string } }>(
    '/api/comparisons/:comparisonId/cases/:externalId',
    async (req, reply) => {
      try {
        return reply.send(await getCaseDiffDetail(req.params.comparisonId, req.params.externalId));
      } catch (err) {
        return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/api/simulations', async (_req, reply) => {
    return reply.send({
      nullModel: readJsonIfExists(join(SIMULATIONS_DIR, 'null-model.json')),
      powerCurve: (readJsonIfExists(join(SIMULATIONS_DIR, 'power-curve.json')) as { powerCurve?: unknown })?.powerCurve ?? null,
      pairingBenefit:
        (readJsonIfExists(join(SIMULATIONS_DIR, 'power-curve.json')) as { pairingBenefit?: unknown })?.pairingBenefit ?? null,
      mdeValidation: readJsonIfExists(join(SIMULATIONS_DIR, 'mde-validation.json')),
      hasPairingBenefitChart: existsSync(join(SIMULATIONS_DIR, 'pairing-benefit-chart.svg')),
    });
  });

  app.get('/api/simulations/pairing-benefit-chart.svg', async (_req, reply) => {
    const path = join(SIMULATIONS_DIR, 'pairing-benefit-chart.svg');
    if (!existsSync(path)) {
      return reply.code(404).send({ error: 'pairing-benefit-chart.svg not found -- run `llmreg simulate power` first' });
    }
    return reply.type('image/svg+xml').send(readFileSync(path, 'utf8'));
  });

  return app;
}

async function main() {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
