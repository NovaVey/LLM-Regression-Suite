// Written from spec §5.5 ("A judge is not trusted until it is validated...")
// and §10's Judge bucket, plus the pure-function interface contract supplied
// for Phase 5, WITHOUT reading src/judge/kappa.ts.
//
// §5.5: "Compute Cohen's kappa between human and judge, plus raw agreement...
// Raw agreement alone is not enough: on a task where 90% of cases pass, a
// judge that says 'pass' unconditionally scores 90% agreement and knows
// nothing. Kappa corrects for agreement expected by chance, which is exactly
// the failure mode here."
//
// Interface contract (given, not read from src):
//   interface ConfusionMatrix { bothPass; humanPassJudgeFail; humanFailJudgePass; bothFail }
//   interface KappaResult { cohensKappa; agreementRate; labelCount; confusionMatrix }
//   function cohensKappa(humanPassed: boolean[], judgePassed: boolean[]): KappaResult
//   Standard unweighted 2-category Cohen's kappa:
//     Po = (bothPass + bothFail) / n
//     Pe = humanPassRate * judgePassRate + humanFailRate * judgeFailRate
//     kappa = (Po - Pe) / (1 - Pe)
//   Throws on length mismatch or empty input.
//
// ---------------------------------------------------------------------
// AMBIGUITY flagged, not silently resolved by reading the implementation:
// ---------------------------------------------------------------------
// The contract explicitly DELEGATES the Pe === 1 degenerate case ("both
// raters unanimous in the identical direction") to the implementer: "decide
// and document a sane return value." It does not pin one down -- unlike the
// McNemar continuity-correction question in Phase 1 (which was later
// resolved and recorded in DECISIONS.md), this one is presented as an open
// implementation decision, not an underspecified requirement. Reasonable,
// defensible choices exist on both sides (return kappa = 1, since perfect
// predictable agreement is not disagreement; OR throw, since 0/0 has no
// well-defined "true skill above chance" when there is no chance variance to
// correct for -- R's psych::cohen.kappa() reports NaN with a warning in this
// exact case, for reference). Rather than assert an unspecified value and
// risk failing a defensible implementation, the test below
// (`a-rubber-stamp-judge-does-not-produce-nan-or-a-silent-crash`) asserts
// only the invariant both defensible choices satisfy: no unhandled NaN, no
// silent garbage. If the implementer documents a specific chosen value in
// kappa.ts, that choice should be pinned down with an additional assertion
// by whoever reviews the implementation against this test.

import { describe, it, expect } from 'vitest';
import { cohensKappa, type KappaResult } from '../../src/judge/kappa.js';

/** Build paired boolean arrays from confusion-matrix counts. */
function buildPairs(
  bothPass: number,
  humanPassJudgeFail: number,
  humanFailJudgePass: number,
  bothFail: number,
): { humanPassed: boolean[]; judgePassed: boolean[] } {
  const humanPassed: boolean[] = [];
  const judgePassed: boolean[] = [];
  for (let i = 0; i < bothPass; i++) { humanPassed.push(true); judgePassed.push(true); }
  for (let i = 0; i < humanPassJudgeFail; i++) { humanPassed.push(true); judgePassed.push(false); }
  for (let i = 0; i < humanFailJudgePass; i++) { humanPassed.push(false); judgePassed.push(true); }
  for (let i = 0; i < bothFail; i++) { humanPassed.push(false); judgePassed.push(false); }
  return { humanPassed, judgePassed };
}

describe('kappa-matches-a-hand-computed-textbook-example', () => {
  it('kappa-matches-a-hand-computed-textbook-example', () => {
    // Standard, widely-cited worked example (2 raters, binary category),
    // n = 50:
    //   bothPass (human yes, judge yes)          = 20
    //   humanPassJudgeFail (human yes, judge no)  = 5
    //   humanFailJudgePass (human no, judge yes)  = 10
    //   bothFail (human no, judge no)             = 15
    //
    // Po = (20 + 15) / 50 = 0.7
    // humanPassRate = (20 + 5) / 50 = 0.5    humanFailRate = 0.5
    // judgePassRate = (20 + 10) / 50 = 0.6   judgeFailRate = 0.4
    // Pe = 0.5*0.6 + 0.5*0.4 = 0.3 + 0.2 = 0.5
    // kappa = (Po - Pe) / (1 - Pe) = (0.7 - 0.5) / (1 - 0.5) = 0.2 / 0.5 = 0.4
    //
    // kappa = 0.4 lands at the boundary of "fair" agreement (Landis & Koch),
    // matching §5.5's own framing of what a mediocre-but-not-worthless judge
    // looks like.
    const { humanPassed, judgePassed } = buildPairs(20, 5, 10, 15);

    const result = cohensKappa(humanPassed, judgePassed);

    expect(result.labelCount).toBe(50);
    expect(result.confusionMatrix).toEqual({
      bothPass: 20,
      humanPassJudgeFail: 5,
      humanFailJudgePass: 10,
      bothFail: 15,
    });
    expect(result.agreementRate).toBeCloseTo(0.7, 9);
    expect(result.cohensKappa).toBeCloseTo(0.4, 9);
  });
});

describe('kappa-is-near-zero-for-a-judge-that-always-says-pass-on-a-ninety-percent-pass-set', () => {
  it('kappa-is-near-zero-for-a-judge-that-always-says-pass-on-a-ninety-percent-pass-set', () => {
    // §5.5's own worked scenario, reconstructed: a set where ~90% of cases
    // genuinely pass (by human label), and a judge that says "pass"
    // unconditionally. n = 53, 48 true (48/53 = 0.90566...) -- a realistic,
    // not-suspiciously-round ~90% mix.
    //
    // Because judgePassed is constant (always true):
    //   judgePassRate = 1, judgeFailRate = 0
    //   Pe = humanPassRate * 1 + humanFailRate * 0 = humanPassRate
    //   Po = (bothPass + bothFail) / n = bothPass / n = humanPassRate
    //     (bothFail must be 0: the judge never says fail, so there are no
    //     "both fail" pairs)
    // So Po === Pe exactly, and kappa = (Po - Pe) / (1 - Pe) = 0 / (1 - Pe)
    // = 0 -- mathematically EXACT, not merely "close to zero": a rater that
    // never varies has zero skill above chance by construction, regardless
    // of the underlying base rate. This is the concrete instance of §5.5's
    // point: raw agreement is high, kappa reveals the judge knows nothing.
    const humanTrueCount = 48;
    const humanFalseCount = 5; // 53 total, 48/53 ≈ 0.9057
    const humanPassed = [
      ...new Array(humanTrueCount).fill(true),
      ...new Array(humanFalseCount).fill(false),
    ];
    const judgePassed = new Array(humanPassed.length).fill(true); // judge always says pass

    const result = cohensKappa(humanPassed, judgePassed);

    expect(result.labelCount).toBe(53);
    // Raw agreement is high...
    expect(result.agreementRate).toBeGreaterThan(0.85);
    expect(result.agreementRate).toBeCloseTo(48 / 53, 9);
    // ...but kappa reveals zero true skill above chance, in the SAME test,
    // to make the §5.5 point explicit: agreement alone would be misleading.
    expect(result.cohensKappa).toBeLessThan(0.15);
    expect(result.cohensKappa).toBeCloseTo(0, 6);
  });
});

describe('kappa-equals-one-for-perfect-human-judge-agreement', () => {
  it('kappa-equals-one-for-perfect-human-judge-agreement', () => {
    // Reachability/control check: the "kappa is low for a bad judge" and
    // "kappa is 0.4 for a mediocre judge" guarantees above would be
    // uninteresting if kappa could never register a GOOD judge either.
    // Perfect agreement, balanced pass/fail split so Pe is not itself
    // degenerate (Pe = 0.5, not 1): kappa must be exactly 1.
    const { humanPassed, judgePassed } = buildPairs(10, 0, 0, 10);

    const result = cohensKappa(humanPassed, judgePassed);

    expect(result.agreementRate).toBeCloseTo(1, 9);
    expect(result.cohensKappa).toBeCloseTo(1, 9);
  });
});

describe('a-rubber-stamp-judge-does-not-produce-nan-or-a-silent-crash', () => {
  it('a-rubber-stamp-judge-does-not-produce-nan-or-a-silent-crash', () => {
    // Pe === 1 degenerate case: both human and judge are unanimous in the
    // IDENTICAL direction (both always say pass) -- exactly what a
    // rubber-stamp judge scored against an all-pass label sample produces.
    // Po = 1, Pe = 1, so the raw formula (Po - Pe) / (1 - Pe) is 0/0.
    //
    // The interface contract explicitly leaves the return value here to the
    // implementer's documented judgment call rather than specifying one (see
    // the file-level ambiguity note above) -- so this test enforces only
    // what must hold under ANY defensible choice: the function must not
    // silently hand back NaN, and if it declines to answer it must throw
    // with an explanatory message rather than doing so silently.
    const n = 12;
    const allTrue = new Array(n).fill(true);

    let threw = false;
    let result: KappaResult | undefined;
    try {
      result = cohensKappa(allTrue, allTrue);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message.length).toBeGreaterThan(0);
    }

    if (!threw) {
      expect(result).toBeDefined();
      expect(Number.isNaN(result!.cohensKappa)).toBe(false);
      expect(Number.isFinite(result!.cohensKappa)).toBe(true);
      expect(result!.agreementRate).toBe(1);
      expect(result!.labelCount).toBe(n);
      expect(result!.confusionMatrix).toEqual({
        bothPass: n,
        humanPassJudgeFail: 0,
        humanFailJudgePass: 0,
        bothFail: 0,
      });
    }
  });
});

describe('confusion-matrix-fields-sum-to-the-label-count', () => {
  it('confusion-matrix-fields-sum-to-the-label-count', () => {
    // Independent dataset from the textbook example above, to check the
    // structural invariant on its own: every input pair falls into exactly
    // one of the four confusion-matrix cells, so the four counts must sum to
    // n, and labelCount must equal the input array length.
    const { humanPassed, judgePassed } = buildPairs(14, 6, 9, 8); // n = 37

    const result = cohensKappa(humanPassed, judgePassed);
    const { bothPass, humanPassJudgeFail, humanFailJudgePass, bothFail } = result.confusionMatrix;

    expect(humanPassed.length).toBe(37);
    expect(result.labelCount).toBe(humanPassed.length);
    expect(bothPass + humanPassJudgeFail + humanFailJudgePass + bothFail).toBe(result.labelCount);
  });
});

describe('mismatched-length-inputs-throw-instead-of-computing-garbage', () => {
  it('mismatched-length-inputs-throw-instead-of-computing-garbage', () => {
    // humanPassed[i] and judgePassed[i] must describe the SAME output. If
    // the arrays are different lengths there is no valid pairing at all, and
    // silently truncating or zero-filling would produce a number that looks
    // like a kappa but measures nothing real.
    const humanPassed = [true, false, true];
    const judgePassed = [true, false];

    expect(() => cohensKappa(humanPassed, judgePassed)).toThrow();
  });
});

describe('an-empty-input-throws-instead-of-computing-garbage', () => {
  it('an-empty-input-throws-instead-of-computing-garbage', () => {
    // Zero labels means there is nothing to compute kappa over -- 0/0 at
    // best, a fabricated number at worst. Must throw, not return a fake
    // KappaResult (e.g. kappa = 0 or kappa = NaN) that looks plausible.
    expect(() => cohensKappa([], [])).toThrow();
  });
});
