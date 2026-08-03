/**
 * Pairing per §5.1: "Both variants run every case in the dataset, and the
 * statistic is computed on the per-case difference `d_i = score_candidate(i)
 * − score_baseline(i)`... Only cases with a valid result in both runs enter
 * the comparison. A case that errored on one side is excluded from the
 * comparison and reported separately as an error, never silently scored
 * zero — scoring an infrastructure timeout as a quality failure is how a
 * flaky network becomes a 'regression'."
 *
 * This file is pure and does zero I/O: it takes two arrays of already-graded
 * per-case outcomes (one per run, produced upstream by whatever averages
 * repeat samples per §5.3 and reduces a run's grades down to one score/pass
 * per case) and returns which cases may enter the statistic and which must
 * be reported as excluded, with why.
 *
 * ASSUMPTIONS:
 *
 * 1. Each side (`baseline`, `candidate`) contains at most one CaseOutcome
 *    per `externalId`. This module does not itself deduplicate repeat
 *    samples — that is §5.3's job, upstream of pairing ("average the
 *    per-case scores, and pair on the averaged score"). If a side contains
 *    more than one outcome for the same `externalId`, the later entry in
 *    array order silently wins (`Map` overwrite semantics) rather than
 *    throwing; this is a caller bug, not something pairing can detect from
 *    the data alone, so it is documented rather than defended against.
 * 2. `score === null` and `passed === null` are treated as synonymous with
 *    "this case errored on this side" — either one being null is enough to
 *    exclude the case, even if (due to an upstream inconsistency) the other
 *    field is non-null. This is the conservative reading: a case that
 *    errored must never contribute a real `difference` to the statistic,
 *    and treating "one of the two fields is null" as fully valid data would
 *    risk exactly that.
 * 3. `critical` is a property of the underlying `cases` row, not of a run —
 *    both sides *should* report the same value for a given `externalId`.
 *    When they disagree (a data inconsistency this module cannot rule out
 *    from its inputs alone), pairing takes `baseline.critical ||
 *    candidate.critical`: treating a case as critical if *either* side says
 *    so. Under-flagging a critical case is the worse failure mode here —
 *    §5.6's critical-case override exists specifically so a single bad case
 *    cannot hide inside an aggregate, and silently dropping that protection
 *    because of a data inconsistency would be the wrong direction to err
 *    in. See docs/DECISIONS.md.
 */

export interface CaseOutcome {
  externalId: string;
  critical: boolean;
  /** null iff this case errored on this side (infra failure, not a quality failure). */
  score: number | null;
  /** null iff this case errored on this side. */
  passed: boolean | null;
}

export interface PairedCase {
  externalId: string;
  critical: boolean;
  baselineScore: number;
  candidateScore: number;
  baselinePassed: boolean;
  candidatePassed: boolean;
  /** candidateScore - baselineScore, per spec §5.1: d_i = candidate_i - baseline_i */
  difference: number;
}

export type ExclusionReason =
  | 'errored-baseline' // present in both, but errored on the baseline side
  | 'errored-candidate' // present in both, but errored on the candidate side
  | 'errored-both'
  | 'missing-baseline' // externalId present in candidate list but not baseline list at all
  | 'missing-candidate';

export interface Exclusion {
  externalId: string;
  reason: ExclusionReason;
}

export interface PairingResult {
  paired: PairedCase[];
  excluded: Exclusion[];
}

/** True iff this outcome represents an error on its side, per assumption 2 above. */
function erroredOnThisSide(outcome: CaseOutcome): boolean {
  return outcome.score === null || outcome.passed === null;
}

/**
 * Pairs baseline and candidate outcomes by `externalId`. A case enters
 * `paired` only if it has a non-null score AND a non-null passed flag on
 * BOTH sides. Every case that fails that bar appears exactly once in
 * `excluded`, with a reason distinguishing "present on both sides but
 * errored on one/both" from "not present on one side at all." A case's own
 * `externalId` never appears in both `paired` and `excluded` — the two
 * output arrays partition the union of externalIds seen across both inputs.
 */
export function pairCases(baseline: CaseOutcome[], candidate: CaseOutcome[]): PairingResult {
  const baselineById = new Map<string, CaseOutcome>();
  for (const outcome of baseline) {
    baselineById.set(outcome.externalId, outcome);
  }
  const candidateById = new Map<string, CaseOutcome>();
  for (const outcome of candidate) {
    candidateById.set(outcome.externalId, outcome);
  }

  const paired: PairedCase[] = [];
  const excluded: Exclusion[] = [];

  // Walk the baseline list first (in its given order, which drives the
  // order of `paired` and most of `excluded` deterministically), resolving
  // every externalId that has a baseline entry.
  for (const [externalId, baseOutcome] of baselineById) {
    const candOutcome = candidateById.get(externalId);
    if (candOutcome === undefined) {
      excluded.push({ externalId, reason: 'missing-candidate' });
      continue;
    }

    const baseErrored = erroredOnThisSide(baseOutcome);
    const candErrored = erroredOnThisSide(candOutcome);

    if (baseErrored && candErrored) {
      excluded.push({ externalId, reason: 'errored-both' });
      continue;
    }
    if (baseErrored) {
      excluded.push({ externalId, reason: 'errored-baseline' });
      continue;
    }
    if (candErrored) {
      excluded.push({ externalId, reason: 'errored-candidate' });
      continue;
    }

    // Neither side errored: both `score` and `passed` are guaranteed
    // non-null by `erroredOnThisSide` above, so the casts below are safe.
    const baselineScore = baseOutcome.score as number;
    const candidateScore = candOutcome.score as number;
    const baselinePassed = baseOutcome.passed as boolean;
    const candidatePassed = candOutcome.passed as boolean;

    paired.push({
      externalId,
      critical: baseOutcome.critical || candOutcome.critical,
      baselineScore,
      candidateScore,
      baselinePassed,
      candidatePassed,
      difference: candidateScore - baselineScore, // §5.1: d_i = candidate_i - baseline_i
    });
  }

  // Anything left in candidate that baseline never had at all.
  for (const externalId of candidateById.keys()) {
    if (!baselineById.has(externalId)) {
      excluded.push({ externalId, reason: 'missing-baseline' });
    }
  }

  return { paired, excluded };
}
