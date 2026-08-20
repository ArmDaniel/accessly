import type {
  AuditReport,
  Journey,
  JourneyReport,
  JourneyTrace,
  Organisation,
  Site,
  Watch,
  WatchEvent,
} from '@accessly/contracts';

/**
 * Repository ports.
 *
 * These are the seam between the domain and storage. The in-memory adapters in
 * `./memory` are the whole persistence layer for this phase; swapping in
 * Postgres means writing new adapters against these interfaces and changing one
 * line in the composition root. No service imports a concrete adapter.
 */

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface PageQuery {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface OrganisationRepository {
  create(organisation: Organisation): Promise<Organisation>;
  findById(id: string): Promise<Organisation | null>;
  list(): Promise<readonly Organisation[]>;
}

export interface SiteRepository {
  create(site: Site): Promise<Site>;
  update(id: string, patch: Partial<Site>): Promise<Site | null>;
  findById(id: string): Promise<Site | null>;
  findByUrl(organisationId: string, url: string): Promise<Site | null>;
  listByOrganisation(organisationId: string): Promise<readonly Site[]>;
  delete(id: string): Promise<boolean>;
}

export interface AuditRepository {
  save(report: AuditReport): Promise<AuditReport>;
  findById(id: string): Promise<AuditReport | null>;
  /** Newest first. */
  list(query: PageQuery & { siteId?: string | undefined; organisationId?: string | undefined }): Promise<Page<AuditReport>>;
  /** The most recent successful audit for a site, used as the diff baseline. */
  findLatestForSite(siteId: string): Promise<AuditReport | null>;
}

export interface WatchRepository {
  create(watch: Watch): Promise<Watch>;
  update(id: string, patch: Partial<Watch>): Promise<Watch | null>;
  findById(id: string): Promise<Watch | null>;
  findBySiteId(siteId: string): Promise<Watch | null>;
  list(): Promise<readonly Watch[]>;
  /** Scoped listing — what the dashboard reads. */
  listByOrganisation(organisationId: string): Promise<readonly Watch[]>;
  /**
   * Active watches whose `nextPollAt` has passed, oldest first.
   * This is the watcher's work queue.
   */
  findDue(now: Date, limit: number): Promise<readonly Watch[]>;
  delete(id: string): Promise<boolean>;
}

export interface WatchEventRepository {
  append(event: WatchEvent): Promise<WatchEvent>;
  /** Newest first. */
  listByWatch(watchId: string, limit: number): Promise<readonly WatchEvent[]>;
}

export interface JourneyRepository {
  create(journey: Journey): Promise<Journey>;
  update(id: string, patch: Partial<Journey>): Promise<Journey | null>;
  findById(id: string): Promise<Journey | null>;
  listByOrganisation(organisationId: string): Promise<readonly Journey[]>;
  delete(id: string): Promise<boolean>;
}

/**
 * Raw traces, kept alongside the reports derived from them.
 *
 * The trace is the evidence: a report can be regenerated when a rule improves,
 * but only if the messages that produced it are still there. They are small —
 * no pixels, no DOM — so keeping them is cheap.
 */
export interface TraceRepository {
  save(trace: JourneyTrace): Promise<JourneyTrace>;
  findById(id: string, organisationId: string): Promise<JourneyTrace | null>;
}

export interface JourneyReportRepository {
  save(report: JourneyReport): Promise<JourneyReport>;
  findById(id: string): Promise<JourneyReport | null>;
  /** Newest first. */
  list(
    query: PageQuery & { organisationId: string; journeyId?: string | undefined },
  ): Promise<Page<JourneyReport>>;
}

export interface Repositories {
  readonly organisations: OrganisationRepository;
  readonly sites: SiteRepository;
  readonly audits: AuditRepository;
  readonly watches: WatchRepository;
  readonly watchEvents: WatchEventRepository;
  readonly journeys: JourneyRepository;
  readonly traces: TraceRepository;
  readonly journeyReports: JourneyReportRepository;
}
