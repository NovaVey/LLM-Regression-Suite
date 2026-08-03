export * as schema from './db/schema.js';
export { checkDatabaseReachable, closeDb, getDb, getPool } from './db/client.js';
export { runMigrations } from './db/migrate.js';
export type { MigrationResult } from './db/migrate.js';
export {
  callTarget,
  checkAnthropicReachable,
  getAnthropicClient,
  getJudgeModel,
  getTargetModel,
} from './anthropic.js';
export type { TargetCallResult, TargetMessage } from './anthropic.js';
export type { ReachabilityResult } from './types.js';
export { DatasetValidationError, loadCases, loadSuiteConfig } from './dataset/load.js';
export { mulberry32, stratifiedSample } from './dataset/split.js';
export type { Case, CaseMessage, GraderConfig, SuiteConfig } from './dataset/schema.js';
export { getGrader } from './graders/registry.js';
export type { GraderContext, GradeResult, Grader } from './graders/types.js';
export type { MiniSchema } from './graders/json.js';
export { computeCacheKey, getCachedResponse, hashPromptTemplate, putCachedResponse } from './runner/cache.js';
export type { CacheKeyParams, CachedEntry } from './runner/cache.js';
export { runWithConcurrency } from './runner/concurrency.js';
export { averagePerCaseScores, executeRun } from './runner/execute.js';
export type {
  AveragedCaseScore,
  CacheStore,
  CaseExecutionResult,
  ExecuteRunOptions,
  ExecuteRunResult,
  GradedSample,
  RunVariant,
  TargetCaller,
} from './runner/execute.js';
export { createVariant, ensureCases, ensureSuite, persistRun } from './runner/persist.js';
export type { PersistRunResult, VariantInput } from './runner/persist.js';
export { pairCases } from './comparison/pairing.js';
export type { CaseOutcome, Exclusion, ExclusionReason, PairedCase, PairingResult } from './comparison/pairing.js';
export { computeComparison } from './comparison/statistics.js';
export type { ComparisonStats, RegressionComparisonInput } from './comparison/statistics.js';
export { compareRuns } from './comparison/compare.js';
export type { CompareRunsParams, CompareRunsResult } from './comparison/compare.js';
export { buildJudgeSystemPrompt, buildJudgeUserMessage, rubricFromGraderConfig } from './judge/prompt.js';
export type { JudgeRubric } from './judge/prompt.js';
export { callJudge } from './judge/call.js';
export type { JudgeCallResult } from './judge/call.js';
export { cohensKappa } from './judge/kappa.js';
export type { ConfusionMatrix, KappaResult } from './judge/kappa.js';
export { checkCalibrationGate, computeBiasNote, matchLabelsToJudgeGrades } from './judge/calibration.js';
export type {
  CalibrationRecord,
  GateStatus,
  HumanLabelRecord,
  JudgeGradeRecord,
  MatchedLabel,
} from './judge/calibration.js';
export {
  getCalibrationsForGrader,
  getHumanLabelsForGrader,
  getJudgeGradesForCalibration,
  getRunOutputsForCalibration,
  hashOutput,
  recordHumanLabel,
  saveCalibration,
} from './judge/persist.js';
export type { SampledOutput } from './judge/persist.js';
export { generateSyntheticPairedCases } from './simulations/generator.js';
export type { CaseGeneratorParams } from './simulations/generator.js';
export { runNullModelSimulation } from './simulations/null-model.js';
export type { NullModelParams, NullModelResult } from './simulations/null-model.js';
export { interpolateDetectionThreshold, runPowerCurveSimulation } from './simulations/power-curve.js';
export type { PowerCurveCell, PowerCurveParams, PowerCurveResult } from './simulations/power-curve.js';
export { runMdeValidation } from './simulations/mde-validation.js';
export type { MdeValidationCell, MdeValidationParams, MdeValidationResult } from './simulations/mde-validation.js';
export { runPairingBenefitSimulation } from './simulations/pairing-benefit.js';
export type { PairingBenefitParams, PairingBenefitResult } from './simulations/pairing-benefit.js';
export { runJudgeDriftSimulation } from './simulations/judge-drift.js';
export type { JudgeDriftParams, JudgeDriftResult } from './simulations/judge-drift.js';
