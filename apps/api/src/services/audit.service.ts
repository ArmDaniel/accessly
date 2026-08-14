import { auditHtml, defaultRegistry, type RuleRegistry } from '@accessly/core';
import type {
  AuditDiff,
  AuditReport,
  ConformanceLevel,
  CreateAuditInput,
} from '@accessly/contracts';
import { diffAudits } from '@accessly/core';
import type { Clock, IdGenerator } from '../domain/clock.js';
import { NotFoundError } from '../domain/errors.js';
import type { AuditRepository, Page, SiteRepository } from '../repositories/types.js';
import type { HtmlFetcher } from './fetcher.js';

export interface AuditServiceDeps {
  readonly audits: AuditRepository;
  readonly sites: SiteRepository;
  readonly fetcher: HtmlFetcher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly registry?: RuleRegistry;
}

/**
 * Orchestrates a single audit: obtain the document, run the engine, persist the
 * report, and keep the owning site's summary current.
 *
 * The engine itself is pure and lives in @accessly/core. Everything stateful —
 * fetching, storing, cross-referencing a site — is here, so the engine stays
 * runnable anywhere.
 *
 * Tenancy: every method that reads or writes takes the calling organisation.
 * A resource belonging to another organisation is reported as *not found*
 * rather than *forbidden* — the distinction would confirm the id exists, which
 * is exactly what an enumeration probe wants to learn.
 */
export class AuditService {
  constructor(private readonly deps: AuditServiceDeps) {}

  async create(input: CreateAuditInput, organisationId: string): Promise<AuditReport> {
    const siteId = input.siteId ?? null;
    if (siteId) {
      const site = await this.deps.sites.findById(siteId);
      if (!site || site.organisationId !== organisationId) throw new NotFoundError('Site', siteId);
    }

    const { html, url } =
      input.source === 'url'
        ? await this.#fetch(input.url)
        : {
            html: input.html,
            // Inline scans still want a stable subject identifier so that two
            // scans of the same pasted page can be compared.
            url: input.url ?? `inline:${this.deps.ids.next()}`,
          };

    const report = this.#run(html, url, input.target, siteId, organisationId);
    await this.deps.audits.save(report);

    if (siteId) {
      await this.deps.sites.update(siteId, {
        latestAuditId: report.id,
        latestScore: report.score.value,
      });
    }

    return report;
  }

  /** Audit a document we already hold. Used by the watcher, which fetches itself. */
  async recordAudit(
    html: string,
    url: string,
    target: ConformanceLevel,
    siteId: string | null,
    organisationId: string | null,
  ): Promise<AuditReport> {
    const report = this.#run(html, url, target, siteId, organisationId);
    await this.deps.audits.save(report);
    if (siteId) {
      await this.deps.sites.update(siteId, {
        latestAuditId: report.id,
        latestScore: report.score.value,
      });
    }
    return report;
  }

  async findById(id: string, organisationId?: string): Promise<AuditReport> {
    const report = await this.deps.audits.findById(id);
    if (!report) throw new NotFoundError('Audit', id);
    if (organisationId !== undefined && report.organisationId !== organisationId) {
      throw new NotFoundError('Audit', id);
    }
    return report;
  }

  async list(
    query: {
      limit: number;
      cursor?: string | undefined;
      siteId?: string | undefined;
    },
    organisationId: string,
  ): Promise<Page<AuditReport>> {
    return this.deps.audits.list({ ...query, organisationId });
  }

  /** Compare an audit with the previous one for the same site. */
  async diffWithPrevious(auditId: string, organisationId: string): Promise<AuditDiff | null> {
    const current = await this.findById(auditId, organisationId);
    if (!current.siteId) return null;

    const { items } = await this.deps.audits.list({
      limit: 50,
      siteId: current.siteId,
      organisationId,
    });
    const previous = items.find(
      (report) =>
        report.status === 'succeeded' &&
        current.status === 'succeeded' &&
        report.startedAt < current.startedAt,
    );
    if (!previous) return null;

    return diffAudits(previous, current);
  }

  async #fetch(url: string): Promise<{ html: string; url: string }> {
    const fetched = await this.deps.fetcher.fetch(url);
    return { html: fetched.html, url: fetched.url };
  }

  #run(
    html: string,
    url: string,
    target: ConformanceLevel,
    siteId: string | null,
    organisationId: string | null,
  ): AuditReport {
    return auditHtml({
      html,
      url,
      target,
      siteId,
      organisationId,
      registry: this.deps.registry ?? defaultRegistry,
      now: () => this.deps.clock.now(),
      generateId: () => this.deps.ids.next(),
    });
  }
}
