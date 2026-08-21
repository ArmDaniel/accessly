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
import type {
  AuditRepository,
  JourneyReportRepository,
  JourneyRepository,
  OrganisationRepository,
  Page,
  PageQuery,
  Repositories,
  SiteRepository,
  TraceRepository,
  WatchEventRepository,
  WatchRepository,
} from './types.js';

/**
 * In-memory adapters.
 *
 * This is the persistence layer for the skeleton phase. It implements the same
 * ports a real database will, including cursor pagination, so that the
 * services and their tests are already written against the shape Postgres will
 * expose — no service changes when storage lands.
 *
 * Everything is cloned on the way in and out. Handing out live references would
 * let a caller mutate stored state by accident, which is a class of bug that
 * simply does not exist once there is a real database, and one we would rather
 * not learn to live with in the meantime.
 */

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Cursor is the id of the last item returned — stable under insertion.
 *
 * An unknown cursor (from another filter, another tenant, or an item that has
 * since been deleted) terminates the page rather than restarting at the top.
 * Restarting would loop a client that follows `nextCursor` forever.
 */
function paginate<T extends { id: string }>(sorted: readonly T[], query: PageQuery): Page<T> {
  let start = 0;
  if (query.cursor) {
    const index = sorted.findIndex((item) => item.id === query.cursor);
    if (index === -1) return { items: [], nextCursor: null };
    start = index + 1;
  }
  const slice = sorted.slice(start, start + query.limit);
  const last = slice.at(-1);
  const hasMore = start + slice.length < sorted.length;
  return {
    items: slice.map(clone),
    nextCursor: hasMore && last ? last.id : null,
  };
}

export class InMemoryOrganisationRepository implements OrganisationRepository {
  readonly #store = new Map<string, Organisation>();

  async create(organisation: Organisation): Promise<Organisation> {
    this.#store.set(organisation.id, clone(organisation));
    return clone(organisation);
  }

  async findById(id: string): Promise<Organisation | null> {
    const found = this.#store.get(id);
    return found ? clone(found) : null;
  }

  async list(): Promise<readonly Organisation[]> {
    return [...this.#store.values()].map(clone);
  }
}

export class InMemorySiteRepository implements SiteRepository {
  readonly #store = new Map<string, Site>();

  async create(site: Site): Promise<Site> {
    this.#store.set(site.id, clone(site));
    return clone(site);
  }

  async update(id: string, patch: Partial<Site>): Promise<Site | null> {
    const existing = this.#store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id: existing.id };
    this.#store.set(id, updated);
    return clone(updated);
  }

  async findById(id: string): Promise<Site | null> {
    const found = this.#store.get(id);
    return found ? clone(found) : null;
  }

  async findByUrl(organisationId: string, url: string): Promise<Site | null> {
    for (const site of this.#store.values()) {
      if (site.organisationId === organisationId && site.url === url) return clone(site);
    }
    return null;
  }

  async listByOrganisation(organisationId: string): Promise<readonly Site[]> {
    return [...this.#store.values()]
      .filter((site) => site.organisationId === organisationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async delete(id: string): Promise<boolean> {
    return this.#store.delete(id);
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly #store = new Map<string, AuditReport>();

  async save(report: AuditReport): Promise<AuditReport> {
    this.#store.set(report.id, clone(report));
    return clone(report);
  }

  async findById(id: string): Promise<AuditReport | null> {
    const found = this.#store.get(id);
    return found ? clone(found) : null;
  }

  async list(
    query: PageQuery & { siteId?: string | undefined; organisationId?: string | undefined },
  ): Promise<Page<AuditReport>> {
    const sorted = [...this.#store.values()]
      .filter((report) => (query.siteId ? report.siteId === query.siteId : true))
      .filter((report) =>
        query.organisationId ? report.organisationId === query.organisationId : true,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    return paginate(sorted, query);
  }

  async findLatestForSite(siteId: string): Promise<AuditReport | null> {
    const candidates = [...this.#store.values()]
      .filter((report) => report.siteId === siteId && report.status === 'succeeded')
      // Same-millisecond ties are broken by id so "latest" is a total order —
      // the diff baseline must not depend on insertion luck.
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    const latest = candidates[0];
    return latest ? clone(latest) : null;
  }
}

export class InMemoryWatchRepository implements WatchRepository {
  readonly #store = new Map<string, Watch>();

  async create(watch: Watch): Promise<Watch> {
    this.#store.set(watch.id, clone(watch));
    return clone(watch);
  }

  async update(id: string, patch: Partial<Watch>): Promise<Watch | null> {
    const existing = this.#store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id: existing.id };
    this.#store.set(id, updated);
    return clone(updated);
  }

  async findById(id: string): Promise<Watch | null> {
    const found = this.#store.get(id);
    return found ? clone(found) : null;
  }

  async findBySiteId(siteId: string): Promise<Watch | null> {
    for (const watch of this.#store.values()) {
      if (watch.siteId === siteId) return clone(watch);
    }
    return null;
  }

  async list(): Promise<readonly Watch[]> {
    return [...this.#store.values()].map(clone);
  }

  async listByOrganisation(organisationId: string): Promise<readonly Watch[]> {
    return [...this.#store.values()]
      .filter((watch) => watch.organisationId === organisationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async findDue(now: Date, limit: number): Promise<readonly Watch[]> {
    return [...this.#store.values()]
      .filter((watch) => watch.status === 'active' && new Date(watch.nextPollAt) <= now)
      .sort((a, b) => a.nextPollAt.localeCompare(b.nextPollAt))
      .slice(0, limit)
      .map(clone);
  }

  async delete(id: string): Promise<boolean> {
    return this.#store.delete(id);
  }
}

export class InMemoryWatchEventRepository implements WatchEventRepository {
  /**
   * Events carry an insertion sequence alongside their timestamp.
   *
   * Several events can share a timestamp — a poll that finds a change records
   * `polled`, `changed` and `audited` within the same millisecond — and sorting
   * on the timestamp alone leaves those ties in whatever order the underlying
   * sort happened to produce. For an append-only trail that is presented as
   * evidence, "newest first" has to be a total order, so the sequence breaks
   * the tie. A real database gets this from a monotonic id.
   */
  readonly #store: Array<{ seq: number; event: WatchEvent }> = [];
  #sequence = 0;

  async append(event: WatchEvent): Promise<WatchEvent> {
    this.#sequence += 1;
    this.#store.push({ seq: this.#sequence, event: clone(event) });
    return clone(event);
  }

  async listByWatch(watchId: string, limit: number): Promise<readonly WatchEvent[]> {
    return this.#store
      .filter((entry) => entry.event.watchId === watchId)
      .sort((a, b) => b.event.at.localeCompare(a.event.at) || b.seq - a.seq)
      .slice(0, limit)
      .map((entry) => clone(entry.event));
  }
}

export class InMemoryJourneyRepository implements JourneyRepository {
  readonly #store = new Map<string, Journey>();

  async create(journey: Journey): Promise<Journey> {
    this.#store.set(journey.id, clone(journey));
    return clone(journey);
  }

  async update(id: string, patch: Partial<Journey>): Promise<Journey | null> {
    const existing = this.#store.get(id);
    if (!existing) return null;
    // `id` and `organisationId` are re-pinned from the stored record: a patch
    // must never be able to move a journey into another tenant.
    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      organisationId: existing.organisationId,
    };
    this.#store.set(id, updated);
    return clone(updated);
  }

  async findById(id: string): Promise<Journey | null> {
    const found = this.#store.get(id);
    return found ? clone(found) : null;
  }

  async listByOrganisation(organisationId: string): Promise<readonly Journey[]> {
    return [...this.#store.values()]
      .filter((journey) => journey.organisationId === organisationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async delete(id: string): Promise<boolean> {
    return this.#store.delete(id);
  }
}

export class InMemoryTraceRepository implements TraceRepository {
  readonly #store = new Map<string, JourneyTrace>();

  /*
   * Tenancy is part of the key, not a check after the fact.
   *
   * Trace ids are chosen by the customer's browser, so two organisations can
   * collide by accident or on purpose. Keying on the id alone would let the
   * second write destroy the first tenant's evidence while their report went on
   * pointing at it. The separator is a NUL because it cannot occur in either
   * component.
   */
  static #key(organisationId: string | null, id: string): string {
    return `${organisationId ?? ''}\u0000${id}`;
  }

  async save(trace: JourneyTrace): Promise<JourneyTrace> {
    this.#store.set(InMemoryTraceRepository.#key(trace.organisationId, trace.id), clone(trace));
    return clone(trace);
  }

  /**
   * Tenancy is a lookup parameter rather than a caller's check.
   *
   * Trace ids come from the customer's browser, so they are guessable in a way
   * server-issued uuids are not. Scoping the read here means a guessed id
   * reads as missing instead of as somebody else's session.
   */
  async findById(id: string, organisationId: string): Promise<JourneyTrace | null> {
    const found = this.#store.get(InMemoryTraceRepository.#key(organisationId, id));
    return found ? clone(found) : null;
  }
}

export class InMemoryJourneyReportRepository implements JourneyReportRepository {
  readonly #store = new Map<string, JourneyReport>();

  async save(report: JourneyReport): Promise<JourneyReport> {
    this.#store.set(report.id, clone(report));
    return clone(report);
  }

  async findById(id: string): Promise<JourneyReport | null> {
    const found = this.#store.get(id);
    return found ? clone(found) : null;
  }

  async list(
    query: PageQuery & { organisationId: string; journeyId?: string | undefined },
  ): Promise<Page<JourneyReport>> {
    const sorted = [...this.#store.values()]
      .filter((report) => report.organisationId === query.organisationId)
      .filter((report) => (query.journeyId ? report.journeyId === query.journeyId : true))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    return paginate(sorted, query);
  }
}

export function createInMemoryRepositories(): Repositories {
  return {
    organisations: new InMemoryOrganisationRepository(),
    sites: new InMemorySiteRepository(),
    audits: new InMemoryAuditRepository(),
    watches: new InMemoryWatchRepository(),
    watchEvents: new InMemoryWatchEventRepository(),
    journeys: new InMemoryJourneyRepository(),
    traces: new InMemoryTraceRepository(),
    journeyReports: new InMemoryJourneyReportRepository(),
  };
}
