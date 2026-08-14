import type {
  CreateWatchInput,
  UpdateWatchInput,
  Watch,
  WatchEvent,
  WatchEventKind,
  WatchInterval,
} from '@accessly/contracts';
import type { Clock, IdGenerator } from '../domain/clock.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import type {
  SiteRepository,
  WatchEventRepository,
  WatchRepository,
} from '../repositories/types.js';

/** Poll spacing per interval. */
export const INTERVAL_MS: Readonly<Record<WatchInterval, number>> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export interface WatchServiceDeps {
  readonly watches: WatchRepository;
  readonly watchEvents: WatchEventRepository;
  readonly sites: SiteRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Watch lifecycle: subscribe a site to continuous monitoring, adjust the
 * schedule, and read the event history.
 *
 * The actual polling loop is `WatcherRunner` — this service owns the state a
 * watch has, the runner owns what happens when one comes due. Keeping them
 * apart means the schedule can be reasoned about (and tested) without running
 * an audit, and vice versa.
 */
export class WatchService {
  constructor(private readonly deps: WatchServiceDeps) {}

  async create(input: CreateWatchInput, organisationId: string): Promise<Watch> {
    const site = await this.deps.sites.findById(input.siteId);
    // A foreign site is reported as missing, not forbidden.
    if (!site || site.organisationId !== organisationId) {
      throw new NotFoundError('Site', input.siteId);
    }

    const existing = await this.deps.watches.findBySiteId(input.siteId);
    if (existing) {
      throw new ConflictError(
        'That site is already being monitored.',
        `Update watch ${existing.id} instead of creating a second one.`,
      );
    }

    const now = this.deps.clock.now();
    const watch: Watch = {
      id: this.deps.ids.next(),
      siteId: site.id,
      organisationId: site.organisationId,
      interval: input.interval,
      status: 'active',
      lastContentHash: null,
      lastPolledAt: null,
      // Poll immediately on creation so the customer gets a baseline report
      // rather than waiting a day to find out anything at all.
      nextPollAt: now.toISOString(),
      auditUnchanged: input.auditUnchanged,
      createdAt: now.toISOString(),
    };

    return this.deps.watches.create(watch);
  }

  async findById(id: string, organisationId?: string): Promise<Watch> {
    const watch = await this.deps.watches.findById(id);
    if (!watch || (organisationId !== undefined && watch.organisationId !== organisationId)) {
      throw new NotFoundError('Watch', id);
    }
    return watch;
  }

  async findBySiteId(siteId: string): Promise<Watch | null> {
    return this.deps.watches.findBySiteId(siteId);
  }

  /**
   * Watches belonging to one organisation.
   *
   * The dashboard must never see another tenant's monitoring, so this is
   * scoped rather than listing everything. The unscoped `list` on the
   * repository exists for the scheduler, which legitimately works across all
   * tenants.
   */
  async listByOrganisation(organisationId: string): Promise<readonly Watch[]> {
    return this.deps.watches.listByOrganisation(organisationId);
  }

  async update(id: string, patch: UpdateWatchInput, organisationId: string): Promise<Watch> {
    const watch = await this.findById(id, organisationId);

    const next: { -readonly [K in keyof Watch]?: Watch[K] } = { ...patch };

    // Shortening the interval should take effect now, not after the old, longer
    // interval finally elapses.
    if (patch.interval && patch.interval !== watch.interval) {
      next.nextPollAt = this.#nextPollFrom(
        watch.lastPolledAt ? new Date(watch.lastPolledAt) : this.deps.clock.now(),
        patch.interval,
      );
    }

    // Resuming a paused watch polls promptly — the customer just asked for it.
    if (patch.status === 'active' && watch.status === 'paused') {
      next.nextPollAt = this.deps.clock.now().toISOString();
    }

    const updated = await this.deps.watches.update(id, next);
    if (!updated) throw new NotFoundError('Watch', id);
    return updated;
  }

  async delete(id: string, organisationId: string): Promise<void> {
    await this.findById(id, organisationId);
    await this.deps.watches.delete(id);
  }

  async history(watchId: string, organisationId: string, limit = 50): Promise<readonly WatchEvent[]> {
    await this.findById(watchId, organisationId);
    return this.deps.watchEvents.listByWatch(watchId, limit);
  }

  async recordEvent(
    watchId: string,
    kind: WatchEventKind,
    message: string,
    auditId: string | null = null,
    scoreDelta: number | null = null,
  ): Promise<WatchEvent> {
    return this.deps.watchEvents.append({
      id: this.deps.ids.next(),
      watchId,
      kind,
      at: this.deps.clock.now().toISOString(),
      auditId,
      message,
      scoreDelta,
    });
  }

  #nextPollFrom(from: Date, interval: WatchInterval): string {
    return new Date(from.getTime() + INTERVAL_MS[interval]).toISOString();
  }

  /** Advance the schedule after a poll, successful or not. */
  nextPollAt(interval: WatchInterval): string {
    return this.#nextPollFrom(this.deps.clock.now(), interval);
  }
}
