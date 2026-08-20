import { auditHtml, auditTree, defaultRegistry, type RuleRegistry } from '@accessly/core';
import type {
  AuditDiff,
  AuditReport,
  ConformanceLevel,
  CreateAuditInput,
} from '@accessly/contracts';
import { diffAudits } from '@accessly/core';
import { UnsupportedMediaError, parseMedia } from '@accessly/media';
import type { Clock, IdGenerator } from '../domain/clock.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import type { AuditRepository, Page, SiteRepository } from '../repositories/types.js';
import type { HtmlFetcher } from './fetcher.js';

export interface AuditServiceDeps {
  readonly audits: AuditRepository;
  readonly sites: SiteRepository;
  readonly fetcher: HtmlFetcher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly registry?: RuleRegistry;
  /** Ceiling on a decoded upload, mirroring the fetched-document limit. */
  readonly maxDocumentBytes?: number;
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

    if (input.source === 'media') {
      const report = this.#runMedia(input, siteId, organisationId);
      await this.deps.audits.save(report);
      if (siteId) {
        await this.deps.sites.update(siteId, {
          latestAuditId: report.id,
          latestScore: report.score.value,
        });
      }
      return report;
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

  /**
   * Audit an uploaded document.
   *
   * Nothing is fetched, so there is no SSRF surface here — but there is a
   * decompression one, which is why the archive readers in `@accessly/media`
   * cap what they expand rather than trusting a zip's own headers.
   */
  #runMedia(
    input: Extract<CreateAuditInput, { source: 'media' }>,
    siteId: string | null,
    organisationId: string,
  ): AuditReport {
    const bytes = new Uint8Array(Buffer.from(input.data, 'base64'));
    const ceiling = this.deps.maxDocumentBytes ?? 5_000_000;

    if (bytes.byteLength === 0) {
      throw new ValidationError('That file appears to be empty.', {
        data: ['Nothing could be decoded from the upload.'],
      });
    }
    if (bytes.byteLength > ceiling) {
      throw new ValidationError('That file is too large to scan.', {
        data: [`The limit is ${Math.round(ceiling / 1_000_000)} MB.`],
      });
    }

    let parsed;
    try {
      parsed = parseMedia(bytes, {
        filename: input.filename,
        ...(input.kind ? { kind: input.kind } : {}),
      });
    } catch (error) {
      if (error instanceof UnsupportedMediaError) {
        // The detector's reason is the useful part: "this looks like a ZIP
        // but none of its entries name an Office part" tells the customer
        // something they can act on.
        throw new ValidationError('Accessly cannot read that file type.', {
          filename: [error.detection.reason],
        });
      }
      throw error;
    }

    return auditTree({
      tree: parsed.tree,
      // The subject is the file itself, named so two scans of the same
      // document compare as the same subject.
      url: `file:${input.filename}`,
      filename: input.filename,
      byteLength: parsed.byteLength,
      contentHash: parsed.contentHash,
      target: input.target,
      siteId,
      organisationId,
      registry: this.deps.registry ?? defaultRegistry,
      now: () => this.deps.clock.now(),
      generateId: () => this.deps.ids.next(),
    });
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
