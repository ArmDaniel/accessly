import type { CreateSiteInput, Site, UpdateSiteInput } from '@accessly/contracts';
import type { Clock, IdGenerator } from '../domain/clock.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import type { SiteRepository, WatchRepository } from '../repositories/types.js';

export interface SiteServiceDeps {
  readonly sites: SiteRepository;
  readonly watches: WatchRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class SiteService {
  constructor(private readonly deps: SiteServiceDeps) {}

  async create(organisationId: string, input: CreateSiteInput): Promise<Site> {
    const url = canonicalUrl(input.url);
    const existing = await this.deps.sites.findByUrl(organisationId, url);
    if (existing) {
      throw new ConflictError(
        'That URL is already registered.',
        `It is registered as "${existing.label}".`,
      );
    }

    const site: Site = {
      id: this.deps.ids.next(),
      organisationId,
      url,
      label: input.label,
      target: input.target,
      createdAt: this.deps.clock.now().toISOString(),
      latestAuditId: null,
      latestScore: null,
    };

    return this.deps.sites.create(site);
  }

  async findById(id: string, organisationId?: string): Promise<Site> {
    const site = await this.deps.sites.findById(id);
    // A foreign site is reported as missing, not forbidden — confirming it
    // exists is itself information an enumeration should not get.
    if (!site || (organisationId !== undefined && site.organisationId !== organisationId)) {
      throw new NotFoundError('Site', id);
    }
    return site;
  }

  async listByOrganisation(organisationId: string): Promise<readonly Site[]> {
    return this.deps.sites.listByOrganisation(organisationId);
  }

  async update(id: string, patch: UpdateSiteInput, organisationId: string): Promise<Site> {
    await this.findById(id, organisationId);
    const normalised = patch.url ? { ...patch, url: canonicalUrl(patch.url) } : patch;
    const updated = await this.deps.sites.update(id, normalised);
    if (!updated) throw new NotFoundError('Site', id);
    return updated;
  }

  /**
   * Deleting a site removes its watch too — leaving an orphaned watch behind
   * would have the scheduler polling a URL nobody is subscribed to.
   */
  async delete(id: string, organisationId: string): Promise<void> {
    await this.findById(id, organisationId);
    const watch = await this.deps.watches.findBySiteId(id);
    if (watch) await this.deps.watches.delete(watch.id);
    await this.deps.sites.delete(id);
  }
}

/**
 * `https://example.com`, `https://example.com/` and `https://example.com/?`
 * are the same page. The duplicate-URL check has to compare them as such or a
 * trivial variant registers a second site — and a second polling schedule.
 */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // The URL constructor already folds `example.com` and `example.com/`;
    // the fragment is the only part it preserves that never affects fetching.
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}
