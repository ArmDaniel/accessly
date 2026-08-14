import { defaultRegistry, type RuleRegistry } from '@accessly/core';
import type { Config } from './config.js';
import { systemClock, uuidGenerator, type Clock, type IdGenerator } from './domain/clock.js';
import { createInMemoryRepositories } from './repositories/memory.js';
import type { Repositories } from './repositories/types.js';
import { AuditService } from './services/audit.service.js';
import { HttpHtmlFetcher, type HtmlFetcher } from './services/fetcher.js';
import { SiteService } from './services/site.service.js';
import { WatchService } from './services/watch.service.js';
import { WatcherRunner } from './services/watcher.js';

/**
 * Composition root.
 *
 * The only place in the application that knows which concrete adapter backs
 * which port. Services receive their dependencies; nothing constructs its own.
 * Swapping the in-memory repositories for Postgres, or the HTTP fetcher for a
 * headless browser, is a change to this file alone.
 */

export interface ContainerOverrides {
  readonly repositories?: Repositories;
  readonly fetcher?: HtmlFetcher;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly registry?: RuleRegistry;
  readonly logger?: { info(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface Container {
  readonly config: Config;
  readonly repositories: Repositories;
  readonly registry: RuleRegistry;
  readonly clock: Clock;
  readonly watcher: WatcherRunner;
  readonly services: {
    readonly audits: AuditService;
    readonly sites: SiteService;
    readonly watches: WatchService;
  };
}

const noopLogger = { info: () => {}, error: () => {} };

export function createContainer(config: Config, overrides: ContainerOverrides = {}): Container {
  const repositories = overrides.repositories ?? createInMemoryRepositories();
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? uuidGenerator;
  const registry = overrides.registry ?? defaultRegistry;
  const logger = overrides.logger ?? noopLogger;

  const fetcher =
    overrides.fetcher ??
    new HttpHtmlFetcher({
      maxBytes: config.maxDocumentBytes,
      timeoutMs: config.fetchTimeoutMs,
      blockPrivateHosts: config.blockPrivateHosts,
    });

  const audits = new AuditService({
    audits: repositories.audits,
    sites: repositories.sites,
    fetcher,
    clock,
    ids,
    registry,
  });

  const sites = new SiteService({
    sites: repositories.sites,
    watches: repositories.watches,
    clock,
    ids,
  });

  const watches = new WatchService({
    watches: repositories.watches,
    watchEvents: repositories.watchEvents,
    sites: repositories.sites,
    clock,
    ids,
  });

  const watcher = new WatcherRunner(
    {
      watches: repositories.watches,
      sites: repositories.sites,
      audits: repositories.audits,
      watchService: watches,
      auditService: audits,
      fetcher,
      clock,
      logger,
    },
    { tickMs: config.watcherTickMs, batchSize: config.watcherBatchSize },
  );

  return {
    config,
    repositories,
    registry,
    clock,
    watcher,
    services: { audits, sites, watches },
  };
}
