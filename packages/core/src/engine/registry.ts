import { getCriterion, isInScope, type ConformanceLevel, type CriterionId } from '@accessly/contracts';
import type { Rule } from './types.js';

/**
 * The rule registry.
 *
 * Registration validates each rule against the WCAG catalogue at module load
 * time, so a typo in a criterion citation or a duplicate rule id fails fast at
 * startup instead of quietly producing a mis-attributed compliance report.
 */
export class RuleRegistry {
  readonly #rules = new Map<string, Rule>();

  register(rule: Rule): this {
    if (this.#rules.has(rule.id)) {
      throw new Error(`Duplicate rule id "${rule.id}".`);
    }
    if (rule.criteria.length === 0) {
      throw new Error(`Rule "${rule.id}" cites no success criteria. Every rule must map to WCAG 2.1.`);
    }
    // Throws if any criterion is not in the published Recommendation.
    for (const criterion of rule.criteria) getCriterion(criterion);

    this.#rules.set(rule.id, rule);
    return this;
  }

  registerAll(rules: Iterable<Rule>): this {
    for (const rule of rules) this.register(rule);
    return this;
  }

  get(id: string): Rule | undefined {
    return this.#rules.get(id);
  }

  all(): readonly Rule[] {
    return [...this.#rules.values()];
  }

  get size(): number {
    return this.#rules.size;
  }

  /** Rules with at least one criterion that is obligatory at `target`. */
  forLevel(target: ConformanceLevel): readonly Rule[] {
    return this.all().filter((rule) =>
      rule.criteria.some((id) => isInScope(getCriterion(id).level, target)),
    );
  }

  /**
   * Criteria that at least one rule can genuinely decide.
   *
   * Advisory rules are excluded on purpose — see `RuleDetection`. A criterion
   * only counts as covered when a failure of it can actually be detected.
   */
  coveredCriteria(): ReadonlySet<CriterionId> {
    const covered = new Set<CriterionId>();
    for (const rule of this.all()) {
      if ((rule.detection ?? 'automated') !== 'automated') continue;
      for (const criterion of rule.criteria) covered.add(criterion);
    }
    return covered;
  }

  /**
   * Criteria we prompt a human to review but cannot decide ourselves.
   * Reported separately from coverage, never merged into it.
   */
  reviewPromptedCriteria(): ReadonlySet<CriterionId> {
    const automated = this.coveredCriteria();
    const prompted = new Set<CriterionId>();
    for (const rule of this.all()) {
      if ((rule.detection ?? 'automated') === 'automated') continue;
      for (const criterion of rule.criteria) {
        if (!automated.has(criterion)) prompted.add(criterion);
      }
    }
    return prompted;
  }

  /** Rules citing a given criterion. */
  rulesForCriterion(criterion: CriterionId): readonly Rule[] {
    return this.all().filter((rule) => rule.criteria.includes(criterion));
  }

  /** Rules citing a criterion that can actually decide it. */
  automatedRulesForCriterion(criterion: CriterionId): readonly Rule[] {
    return this.rulesForCriterion(criterion).filter(
      (rule) => (rule.detection ?? 'automated') === 'automated',
    );
  }
}
