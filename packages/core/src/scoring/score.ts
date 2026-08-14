import {
  PRINCIPLES,
  criteriaForLevel,
  getCriterion,
  type AuditSummary,
  type ConformanceLevel,
  type CriterionId,
  type CriterionScore,
  type Finding,
  type Impact,
  type Outcome,
  type PrincipleScore,
  type RuleResult,
  type Score,
  type ScoreBand,
} from '@accessly/contracts';
import type { RuleRegistry } from '../engine/registry.js';

/**
 * How the Accessly score is calculated.
 *
 * WCAG conformance is binary: one unmet level A criterion means the page does
 * not conform at level A, no matter how good the rest of it is. A single
 * number can never replace that verdict, and `Score.conformsTo` carries it
 * separately and unambiguously.
 *
 * The number exists for a different job — showing a team whether they are
 * getting better week over week. It is built from two parts:
 *
 *   1. **Criterion coverage (75%)** — the weighted share of automatable,
 *      in-scope criteria that pass. Level A criteria weigh 3, AA weighs 2,
 *      AAA weighs 1, because failing a level A criterion excludes more people.
 *
 *   2. **Instance density (25%)** — how much of the page is affected. A page
 *      with one missing `alt` and a page with two hundred both fail 1.1.1
 *      identically, but they are not the same amount of work or the same
 *      amount of harm, and a progress metric that cannot tell them apart is
 *      useless for tracking progress.
 *
 * Criteria that no automated rule covers are excluded from both parts and
 * surfaced as `criteriaRequiringManualReview`. Counting them as passes would
 * inflate every score; counting them as failures would make a perfect page
 * unreachable. Neither is honest, so they are reported as what they are.
 */

/** Weight by conformance obligation. */
const LEVEL_WEIGHT: Readonly<Record<ConformanceLevel, number>> = { A: 3, AA: 2, AAA: 1 };

/** Weight by user impact, used only for the instance-density term. */
const IMPACT_WEIGHT: Readonly<Record<Impact, number>> = {
  critical: 1,
  serious: 0.7,
  moderate: 0.4,
  minor: 0.2,
};

const CRITERION_WEIGHT_SHARE = 0.75;
const INSTANCE_WEIGHT_SHARE = 0.25;

export interface ScoreInput {
  readonly target: ConformanceLevel;
  readonly rules: readonly RuleResult[];
  readonly findings: readonly Finding[];
  readonly registry: RuleRegistry;
}

export interface ScoreOutput {
  readonly score: Score;
  readonly criteria: readonly CriterionScore[];
  readonly summary: AuditSummary;
}

function bandFor(value: number): ScoreBand {
  if (value >= 95) return 'excellent';
  if (value >= 85) return 'good';
  if (value >= 70) return 'fair';
  if (value >= 50) return 'poor';
  return 'critical';
}

/**
 * Roll the outcomes of every rule citing a criterion into one outcome for that
 * criterion. Failure is absorbing — one failing rule fails the criterion.
 */
function criterionOutcome(results: readonly RuleResult[]): Outcome {
  if (results.length === 0) return 'cantTell';
  if (results.some((r) => r.outcome === 'failed')) return 'failed';
  if (results.some((r) => r.outcome === 'cantTell')) return 'cantTell';
  if (results.some((r) => r.outcome === 'passed')) return 'passed';
  return 'inapplicable';
}

function buildCriterionScores(input: ScoreInput): CriterionScore[] {
  const resultsByRuleId = new Map(input.rules.map((r) => [r.ruleId, r]));

  return criteriaForLevel(input.target).map((criterion) => {
    const results = input.registry
      .rulesForCriterion(criterion.id)
      .map((rule) => resultsByRuleId.get(rule.id))
      .filter((r): r is RuleResult => r !== undefined);

    const findingCount = results.reduce(
      (total, result) =>
        total + result.findings.filter((f) => f.criteria.includes(criterion.id)).length,
      0,
    );

    /*
     * A criterion needs manual review unless a rule that could actually decide
     * it was run.
     *
     * Both halves matter. Advisory rules raise the question but can never
     * answer it, so a criterion covered only by those still needs a human —
     * treating an advisory prompt as coverage is how a tool ends up claiming
     * 100% of WCAG. And a rule that exists but did not run (a filtered
     * single-rule check, say) has decided nothing either, so it cannot earn the
     * criterion partial credit.
     */
    const decidable = input.registry
      .automatedRulesForCriterion(criterion.id)
      .some((rule) => resultsByRuleId.has(rule.id));

    return {
      criterion: criterion.id,
      title: criterion.title,
      level: criterion.level,
      outcome: criterionOutcome(results),
      findingCount,
      requiresManualReview: !decidable,
    };
  });
}

/** Weighted share of automatable criteria that pass. */
function criterionTerm(criteria: readonly CriterionScore[]): number {
  const scored = criteria.filter((c) => !c.requiresManualReview);
  if (scored.length === 0) return 100;

  let earned = 0;
  let possible = 0;

  for (const criterion of scored) {
    const weight = LEVEL_WEIGHT[criterion.level];
    possible += weight;
    // `inapplicable` means the page contains nothing the criterion governs,
    // which is not a defect — it earns full marks.
    if (criterion.outcome === 'passed' || criterion.outcome === 'inapplicable') {
      earned += weight;
    } else if (criterion.outcome === 'cantTell') {
      // Undecidable: half marks. The report says plainly which ones these are
      // so the team can resolve them by hand rather than argue with the number.
      earned += weight * 0.5;
    }
  }

  return possible === 0 ? 100 : (earned / possible) * 100;
}

/** How much of what we looked at is affected, weighted by impact. */
function instanceTerm(rules: readonly RuleResult[], findings: readonly Finding[]): number {
  const tested = rules.reduce((total, rule) => total + rule.elementsTested, 0);
  if (tested === 0) return 100;

  const weighted = findings.reduce((total, finding) => {
    const base = IMPACT_WEIGHT[finding.impact];
    // An undecidable finding is a smaller signal than a confirmed failure.
    return total + (finding.outcome === 'cantTell' ? base * 0.5 : base);
  }, 0);

  const density = Math.min(1, weighted / tested);
  return (1 - density) * 100;
}

function buildPrincipleScores(criteria: readonly CriterionScore[]): PrincipleScore[] {
  return PRINCIPLES.map((principle) => {
    const owned = criteria.filter((c) => getCriterion(c.criterion).principle === principle.id);
    const scorable = owned.filter((c) => !c.requiresManualReview);

    const passed = scorable.filter((c) => c.outcome === 'passed').length;
    const failed = scorable.filter((c) => c.outcome === 'failed').length;
    const notApplicable = scorable.filter((c) => c.outcome === 'inapplicable').length;

    return {
      principle: principle.id,
      title: principle.title,
      score: Math.round(criterionTerm(owned)),
      criteriaPassed: passed,
      criteriaFailed: failed,
      criteriaNotApplicable: notApplicable,
    };
  });
}

/**
 * Highest level with no automated failures.
 *
 * This is *not* a conformance claim — automated testing cannot produce one.
 * It says "nothing we can check automatically fails at this level", which is a
 * necessary but not sufficient condition for conformance. The report wording
 * must reflect that, and the frontend is required to show the manual-review
 * count alongside it.
 */
function highestCleanLevel(criteria: readonly CriterionScore[]): ConformanceLevel | null {
  const failsAt = (level: ConformanceLevel): boolean =>
    criteria.some((c) => c.level === level && c.outcome === 'failed');

  if (failsAt('A')) return null;
  if (failsAt('AA')) return 'A';
  if (failsAt('AAA')) return 'AA';
  return 'AAA';
}

function summarise(findings: readonly Finding[]): AuditSummary {
  const byImpact: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byLevel: Record<ConformanceLevel, number> = { A: 0, AA: 0, AAA: 0 };

  for (const finding of findings) {
    byImpact[finding.impact] += 1;
    byLevel[finding.level] += 1;
  }

  return { total: findings.length, byImpact, byLevel };
}

export function calculateScore(input: ScoreInput): ScoreOutput {
  const criteria = buildCriterionScores(input);

  const value = Math.round(
    CRITERION_WEIGHT_SHARE * criterionTerm(criteria) +
      INSTANCE_WEIGHT_SHARE * instanceTerm(input.rules, input.findings),
  );

  const scorable = criteria.filter((c) => !c.requiresManualReview);

  const score: Score = {
    value: Math.max(0, Math.min(100, value)),
    band: bandFor(value),
    conformsTo: highestCleanLevel(criteria),
    target: input.target,
    byPrinciple: buildPrincipleScores(criteria),
    criteriaEvaluated: scorable.length,
    criteriaPassed: scorable.filter((c) => c.outcome === 'passed' || c.outcome === 'inapplicable')
      .length,
    criteriaFailed: scorable.filter((c) => c.outcome === 'failed').length,
    criteriaRequiringManualReview: criteria.filter((c) => c.requiresManualReview).length,
  };

  return { score, criteria, summary: summarise(input.findings) };
}

/** Exported for tests and for the report's methodology section. */
export const SCORING_WEIGHTS = {
  level: LEVEL_WEIGHT,
  impact: IMPACT_WEIGHT,
  criterionShare: CRITERION_WEIGHT_SHARE,
  instanceShare: INSTANCE_WEIGHT_SHARE,
} as const;

export type { CriterionId };
