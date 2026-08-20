import { createHash, randomUUID } from 'node:crypto';
import type { AuditReport, ConformanceLevel } from '@accessly/contracts';
import { runTreeRules } from './engine/runner.js';
import { RuleRegistry } from './engine/registry.js';
import { defaultRegistry } from './rules/index.js';
import { calculateScore } from './scoring/score.js';
import { textContent, type AccessibleTree } from './tree/node.js';
import { ENGINE_VERSION } from './audit.js';

export interface MediaAuditOptions {
  readonly tree: AccessibleTree;
  /** `file:` URI or the URL the file was fetched from. */
  readonly url: string;
  readonly filename?: string | null;
  readonly byteLength: number;
  /** Hash of the original bytes, so the watcher can detect a re-upload. */
  readonly contentHash: string;
  readonly target?: ConformanceLevel;
  readonly siteId?: string | null;
  readonly organisationId?: string | null;
  readonly registry?: RuleRegistry;
  readonly only?: readonly string[];
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

/**
 * Audit any non-HTML document, given its accessibility tree.
 *
 * Symmetric with `auditHtml` on purpose: same report shape, same scoring, same
 * conformance semantics. A customer comparing their web page and their PDF is
 * comparing like with like, and the watcher can diff either without caring
 * which it is.
 *
 * Parsing lives in `@accessly/media`, not here, so the engine keeps its
 * no-dependency, no-I/O guarantee — it takes a tree in and returns a report.
 */
export function auditTree(options: MediaAuditOptions): AuditReport {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? randomUUID;
  const registry = options.registry ?? defaultRegistry;
  const target = options.target ?? 'AA';

  const startedAt = now();

  const { rules, findings, rulesRun } = runTreeRules(options.tree, registry, {
    target,
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
      mediaKind: options.tree.mediaKind,
      filename: options.filename ?? null,
      title: options.tree.title,
      lang: options.tree.lang,
      contentHash: options.contentHash,
      byteLength: options.byteLength,
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

/** SHA-256 of raw bytes, for the watcher's change detection. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Plain-text extraction, used for reading-level and word-count reporting. */
export function treeText(tree: AccessibleTree): string {
  return textContent(tree.root);
}
