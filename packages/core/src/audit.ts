import { randomUUID } from 'node:crypto';
import type {
  AuditDiff,
  AuditReport,
  ConformanceLevel,
  CriterionId,
  Finding,
} from '@accessly/contracts';
import { parseDocument } from './dom/parse.js';
import { runRules } from './engine/runner.js';
import { RuleRegistry } from './engine/registry.js';
import { defaultRegistry } from './rules/index.js';
import { calculateScore } from './scoring/score.js';

export const ENGINE_VERSION = '0.1.0';

export interface AuditOptions {
  readonly html: string;
  /** Canonical URL, or an `inline:` URI when the markup was supplied directly. */
  readonly url: string;
  readonly target?: ConformanceLevel;
  readonly siteId?: string | null;
  /** Owning organisation, persisted on the report for tenancy-scoped reads. */
  readonly organisationId?: string | null;
  readonly registry?: RuleRegistry;
  /** Restrict the run to specific rule ids. */
  readonly only?: readonly string[];
  /** Injected for deterministic tests. */
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

/**
 * Audit a document.
 *
 * Deliberately synchronous and dependency-free: it takes markup in and returns
 * a report. Fetching, storage, scheduling and auth all live in the API layer,
 * which is what lets the same engine run server-side, in CI, and (compiled to
 * a browser bundle) inside a customer's own page.
 */
export function auditHtml(options: AuditOptions): AuditReport {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? randomUUID;
  const registry = options.registry ?? defaultRegistry;
  const target = options.target ?? 'AA';

  const startedAt = now();
  const parsed = parseDocument(options.html);

  const { rules, findings, rulesRun } = runRules(parsed, registry, {
    target,
    baseUrl: options.url.startsWith('inline:') ? null : options.url,
    ...(options.only ? { only: options.only } : {}),
  });

  const { score, criteria, summary } = calculateScore({ target, rules, findings, registry });

  const finishedAt = now();

  return {
    id: generateId(),
    siteId: options.siteId ?? null,
    organisationId: options.organisationId ?? null,
    status: 'succeeded',
    target,
    subject: {
      url: options.url,
      title: parsed.title,
      lang: parsed.lang,
      contentHash: parsed.contentHash,
      byteLength: parsed.byteLength,
      fetchedAt: startedAt.toISOString(),
    },
    score,
    summary,
    criteria,
    rules,
    findings,
    engine: {
      name: 'accessly-core',
      version: ENGINE_VERSION,
      wcagVersion: '2.1',
      rulesRun,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

/**
 * Compare two audits of the same page.
 *
 * This is what the watcher actually delivers to a customer: not "your score is
 * 82" but "this deploy introduced four new failures, here they are". Findings
 * are matched by their deterministic id, so an unmoved, unchanged problem is
 * recognised as the same problem across runs.
 */
export function diffAudits(previous: AuditReport, current: AuditReport): AuditDiff {
  const previousIds = new Set(previous.findings.map((f) => f.id));
  const currentIds = new Set(current.findings.map((f) => f.id));

  const introduced: Finding[] = current.findings.filter((f) => !previousIds.has(f.id));
  const resolved: Finding[] = previous.findings.filter((f) => !currentIds.has(f.id));

  const outcomeByCriterion = (report: AuditReport): Map<CriterionId, string> =>
    new Map(report.criteria.map((c) => [c.criterion, c.outcome]));

  const before = outcomeByCriterion(previous);
  const after = outcomeByCriterion(current);

  const criteriaRegressed: CriterionId[] = [];
  const criteriaFixed: CriterionId[] = [];

  for (const [criterion, nowOutcome] of after) {
    const thenOutcome = before.get(criterion);
    if (thenOutcome === undefined) continue;
    if (thenOutcome !== 'failed' && nowOutcome === 'failed') criteriaRegressed.push(criterion);
    if (thenOutcome === 'failed' && nowOutcome !== 'failed') criteriaFixed.push(criterion);
  }

  return {
    previousAuditId: previous.id,
    currentAuditId: current.id,
    scoreDelta: current.score.value - previous.score.value,
    introduced,
    resolved,
    unchangedCount: current.findings.length - introduced.length,
    criteriaRegressed,
    criteriaFixed,
  };
}
