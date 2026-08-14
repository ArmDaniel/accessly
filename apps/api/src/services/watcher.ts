import { hashContent } from '@accessly/core';
import type { Watch } from '@accessly/contracts';
import type { Clock } from '../domain/clock.js';
import type { AuditRepository, SiteRepository, WatchRepository } from '../repositories/types.js';
import type { AuditService } from './audit.service.js';
import type { HtmlFetcher } from './fetcher.js';
import { INTERVAL_MS, type WatchService } from './watch.service.js';

export interface WatcherDeps {
  readonly watches: WatchRepository;
  readonly sites: SiteRepository;
  readonly audits: AuditRepository;
  readonly watchService: WatchService;
  readonly auditService: AuditService;
  readonly fetcher: HtmlFetcher;
  readonly clock: Clock;
  readonly logger: { info(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface WatcherOptions {
  readonly tickMs: number;
  readonly batchSize: number;
}

/** What happened to one watch during one poll. */
export interface PollOutcome {
  readonly watchId: string;
  readonly kind: 'unchanged' | 'audited' | 'failed' | 'skipped';
  readonly auditId?: string;
  readonly scoreDelta?: number;
  readonly changed?: boolean;
}

/**
 * The continuous-monitoring loop.
 *
 * The design constraint that shapes everything here: an audit costs real
 * compute, and most polls find nothing new. So the loop is content-addressed —
 * it fetches, hashes, and only spends an audit when the hash moved. That is
 * also what makes the customer-facing event stream meaningful: every `changed`
 * event corresponds to something they actually shipped.
 *
 * Failure policy: a poll that cannot fetch is recorded and the schedule
 * advances anyway. A site that is down for a week must not accumulate a week of
 * backlogged polls that all fire the moment it returns.
 */
export class WatcherRunner {
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(
    private readonly deps: WatcherDeps,
    private readonly options: WatcherOptions,
  ) {}

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      // `.catch` because an unhandled rejection terminates the process by
      // default — one poisoned page must not take the whole API down.
      void this.tick().catch((error: unknown) => {
        this.deps.logger.error({ err: String(error) }, 'watcher tick crashed');
      });
    }, this.options.tickMs);
    // Do not hold the process open just for the watcher.
    this.#timer.unref?.();
    this.deps.logger.info({ tickMs: this.options.tickMs }, 'watcher started');
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
    this.deps.logger.info({}, 'watcher stopped');
  }

  /**
   * Process one batch of due watches.
   *
   * Guarded against overlap: if a tick is still working when the next one
   * fires, the new tick returns immediately rather than double-polling.
   */
  async tick(): Promise<readonly PollOutcome[]> {
    if (this.#running) return [];
    this.#running = true;

    try {
      const due = await this.deps.watches.findDue(this.deps.clock.now(), this.options.batchSize);
      const outcomes: PollOutcome[] = [];
      for (const watch of due) {
        // One failing poll must not starve the rest of the batch: isolate,
        // record, and keep going. `poll` already handles its fetch failures;
        // this catches the failures it cannot (storage, engine).
        try {
          outcomes.push(await this.poll(watch));
        } catch (error) {
          this.deps.logger.error(
            { watchId: watch.id, err: String(error) },
            'watch poll crashed',
          );
          outcomes.push({ watchId: watch.id, kind: 'failed' });
        }
      }
      return outcomes;
    } finally {
      this.#running = false;
    }
  }

  /** Poll a single watch. Exposed so a customer can force a check on demand. */
  async poll(watch: Watch): Promise<PollOutcome> {
    const site = await this.deps.sites.findById(watch.siteId);
    if (!site) {
      // The site was deleted between scheduling and polling. Retire the watch.
      await this.deps.watchService.recordEvent(
        watch.id,
        'poll_failed',
        'The monitored site no longer exists, so monitoring has been stopped.',
      );
      await this.deps.watches.update(watch.id, { status: 'paused' });
      return { watchId: watch.id, kind: 'skipped' };
    }

    const polledAt = this.deps.clock.now();

    let html: string;
    let resolvedUrl: string;
    try {
      const fetched = await this.deps.fetcher.fetch(site.url);
      html = fetched.html;
      resolvedUrl = fetched.url;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error.';
      await this.deps.watchService.recordEvent(
        watch.id,
        'poll_failed',
        `Could not retrieve ${site.url}: ${reason}`,
      );
      await this.#reschedule(watch, polledAt, watch.lastContentHash);
      this.deps.logger.error({ watchId: watch.id, url: site.url, reason }, 'watch poll failed');
      return { watchId: watch.id, kind: 'failed' };
    }

    const contentHash = hashContent(html);
    const changed = watch.lastContentHash !== null && watch.lastContentHash !== contentHash;
    const isFirstPoll = watch.lastContentHash === null;

    await this.deps.watchService.recordEvent(
      watch.id,
      'polled',
      `Checked ${site.url}.`,
    );

    if (!isFirstPoll && !changed && !watch.auditUnchanged) {
      await this.deps.watchService.recordEvent(
        watch.id,
        'unchanged',
        'The page is byte-for-byte identical to the last check, so no new audit was run.',
      );
      await this.#reschedule(watch, polledAt, contentHash);
      return { watchId: watch.id, kind: 'unchanged', changed: false };
    }

    if (changed) {
      await this.deps.watchService.recordEvent(
        watch.id,
        'changed',
        'The page changed since the last check. Re-running the accessibility audit.',
      );
    }

    const previous = await this.deps.audits.findLatestForSite(site.id);
    const report = await this.deps.auditService.recordAudit(
      html,
      resolvedUrl,
      site.target,
      site.id,
      watch.organisationId,
    );

    const scoreDelta = previous ? report.score.value - previous.score.value : null;

    await this.deps.watchService.recordEvent(
      watch.id,
      'audited',
      isFirstPoll
        ? `Baseline audit complete. Score ${report.score.value}/100 against WCAG 2.1 level ${report.target}.`
        : `Audit complete. Score ${report.score.value}/100.`,
      report.id,
      scoreDelta,
    );

    // A regression is the whole point of the product, so it gets its own event
    // kind rather than being buried in the audit message.
    if (previous && scoreDelta !== null && scoreDelta !== 0) {
      const introduced = report.findings.filter(
        (finding) => !previous.findings.some((old) => old.id === finding.id),
      );
      const resolvedCount = previous.findings.filter(
        (old) => !report.findings.some((finding) => finding.id === old.id),
      ).length;

      if (scoreDelta < 0) {
        await this.deps.watchService.recordEvent(
          watch.id,
          'regressed',
          `Accessibility regressed by ${Math.abs(scoreDelta)} points. ${introduced.length} new issue(s) were introduced.`,
          report.id,
          scoreDelta,
        );
      } else {
        await this.deps.watchService.recordEvent(
          watch.id,
          'improved',
          `Accessibility improved by ${scoreDelta} points. ${resolvedCount} issue(s) were resolved.`,
          report.id,
          scoreDelta,
        );
      }
    }

    await this.#reschedule(watch, polledAt, contentHash);

    this.deps.logger.info(
      { watchId: watch.id, siteId: site.id, score: report.score.value, changed },
      'watch audited',
    );

    return {
      watchId: watch.id,
      kind: 'audited',
      auditId: report.id,
      ...(scoreDelta !== null ? { scoreDelta } : {}),
      changed,
    };
  }

  /**
   * Advance `nextPollAt` from *now*, never from the previous due time.
   *
   * Scheduling from the due time would let a backlog build up: a watch that was
   * missed for six hours would then fire six times in a row trying to catch up,
   * which is neither useful to the customer nor kind to their server.
   */
  async #reschedule(watch: Watch, polledAt: Date, contentHash: string | null): Promise<void> {
    await this.deps.watches.update(watch.id, {
      lastPolledAt: polledAt.toISOString(),
      lastContentHash: contentHash,
      nextPollAt: new Date(
        this.deps.clock.now().getTime() + INTERVAL_MS[watch.interval],
      ).toISOString(),
    });
  }
}
