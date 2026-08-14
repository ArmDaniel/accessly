import type { FastifyInstance } from 'fastify';
import { GUIDELINES, PRINCIPLES, SUCCESS_CRITERIA } from '@accessly/contracts';
import { ENGINE_VERSION } from '@accessly/core';
import type { Container } from '../container.js';

/**
 * Read-only reference data.
 *
 * The frontend renders the WCAG catalogue and the rule coverage matrix from
 * these endpoints rather than shipping its own copy, so the two can never
 * disagree about what the engine actually checks.
 */
export function registerMetaRoutes(app: FastifyInstance, container: Container): void {
  // Health checks are exempt from the rate limit: monitoring must never be
  // blinded by it, and a 429 on /health means "healthy but busy", which is a
  // lie worth avoiding.
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    engine: { name: 'accessly-core', version: ENGINE_VERSION, wcagVersion: '2.1' },
    rules: container.registry.size,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/v1/wcag/criteria', async () => ({
    version: '2.1',
    principles: PRINCIPLES,
    guidelines: GUIDELINES,
    criteria: SUCCESS_CRITERIA,
  }));

  /**
   * Which criteria automation covers, and which need a human.
   *
   * Publishing this is a deliberate honesty measure: no automated tool covers
   * all 78 criteria, and a customer deserves to know where the gaps are before
   * they rely on a score.
   */
  app.get('/v1/rules', async () => {
    const covered = container.registry.coveredCriteria();
    const prompted = container.registry.reviewPromptedCriteria();

    const summarise = (predicate: (id: string) => boolean) =>
      SUCCESS_CRITERIA.filter((criterion) => predicate(criterion.id)).map((criterion) => ({
        id: criterion.id,
        title: criterion.title,
        level: criterion.level,
      }));

    return {
      engineVersion: ENGINE_VERSION,
      rules: container.registry.all().map((rule) => ({
        id: rule.id,
        title: rule.title,
        help: rule.help,
        criteria: rule.criteria,
        impact: rule.impact,
        detection: rule.detection ?? 'automated',
        techniques: rule.techniques ?? [],
        scope: rule.kind,
      })),
      /*
       * Three buckets, never two.
       *
       * `covered` means a failure can actually be detected. `reviewPrompted`
       * means we raise the question but a human has to answer it. Merging those
       * two would let us claim near-total WCAG coverage while proving nothing,
       * which is precisely the marketing number this product exists to argue
       * against.
       */
      coverage: {
        criteriaTotal: SUCCESS_CRITERIA.length,
        criteriaCovered: covered.size,
        criteriaReviewPrompted: prompted.size,
        criteriaUncovered: SUCCESS_CRITERIA.length - covered.size - prompted.size,
        covered: summarise((id) => covered.has(id)),
        reviewPrompted: summarise((id) => prompted.has(id)),
        uncovered: summarise((id) => !covered.has(id) && !prompted.has(id)),
      },
    };
  });
}
