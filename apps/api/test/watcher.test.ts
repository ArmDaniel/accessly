import { describe, expect, it } from 'vitest';
import type { WatchEventKind } from '@accessly/contracts';
import { INTERVAL_MS } from '../src/services/watch.service.js';
import { createTestContainer, GOOD_PAGE, REGRESSED_PAGE } from './helpers.js';

const URL = 'https://example.test/';

async function setupWatch(
  pages: Record<string, string> = { [URL]: GOOD_PAGE },
  interval: 'hourly' | 'daily' | 'weekly' = 'daily',
) {
  const { container, clock, fetcher } = createTestContainer(pages);

  const site = await container.services.sites.create('org-1', {
    url: URL,
    label: 'Home',
    target: 'AA',
  });
  const watch = await container.services.watches.create(
    {
      siteId: site.id,
      interval,
      auditUnchanged: false,
    },
    'org-1',
  );

  return { container, clock, fetcher, site, watch };
}

const kinds = async (
  container: Awaited<ReturnType<typeof setupWatch>>['container'],
  watchId: string,
): Promise<WatchEventKind[]> =>
  (await container.services.watches.history(watchId, 'org-1')).map((event) => event.kind).reverse();

describe('watch scheduling', () => {
  it('polls immediately on creation so the customer gets a baseline', async () => {
    const { container, clock, watch } = await setupWatch();
    expect(new Date(watch.nextPollAt).getTime()).toBeLessThanOrEqual(clock.now().getTime());

    const due = await container.repositories.watches.findDue(clock.now(), 10);
    expect(due.map((w) => w.id)).toEqual([watch.id]);
  });

  it('schedules the next poll one interval ahead', async () => {
    const { container, clock, watch } = await setupWatch();
    await container.watcher.tick();

    const updated = await container.services.watches.findById(watch.id);
    expect(new Date(updated.nextPollAt).getTime()).toBe(clock.now().getTime() + INTERVAL_MS.daily);
  });

  it('does not run a watch before it is due', async () => {
    const { container, clock } = await setupWatch();
    await container.watcher.tick();

    clock.advance(INTERVAL_MS.daily / 2);
    const outcomes = await container.watcher.tick();
    expect(outcomes).toEqual([]);
  });

  it('skips paused watches', async () => {
    const { container, watch } = await setupWatch();
    await container.services.watches.update(watch.id, { status: 'paused' }, 'org-1');

    expect(await container.watcher.tick()).toEqual([]);
  });

  it('polls promptly when a paused watch is resumed', async () => {
    const { container, clock, watch } = await setupWatch();
    await container.watcher.tick();
    await container.services.watches.update(watch.id, { status: 'paused' }, 'org-1');

    clock.advance(60_000);
    await container.services.watches.update(watch.id, { status: 'active' }, 'org-1');

    const outcomes = await container.watcher.tick();
    expect(outcomes).toHaveLength(1);
  });

  it('brings the next poll forward when the interval is shortened', async () => {
    const { container, clock, watch } = await setupWatch({ [URL]: GOOD_PAGE }, 'weekly');
    await container.watcher.tick();

    const updated = await container.services.watches.update(watch.id, { interval: 'hourly' }, 'org-1');
    // Rescheduled from the last poll, not left a week out.
    expect(new Date(updated.nextPollAt).getTime()).toBe(clock.now().getTime() + INTERVAL_MS.hourly);
  });

  it('processes at most the configured batch size per tick', async () => {
    const { container, clock } = await setupWatch();

    for (let i = 0; i < 15; i += 1) {
      const site = await container.services.sites.create('org-1', {
        url: `https://example.test/page-${i}`,
        label: `Page ${i}`,
        target: 'AA',
      });
      await container.services.watches.create(
        {
          siteId: site.id,
          interval: 'daily',
          auditUnchanged: false,
        },
        'org-1',
      );
    }

    const due = await container.repositories.watches.findDue(clock.now(), 100);
    expect(due.length).toBe(16);

    // Default batch size is 10, so one tenant cannot starve the rest.
    const outcomes = await container.watcher.tick();
    expect(outcomes).toHaveLength(10);
  });
});

describe('change detection', () => {
  it('audits on the first poll, since there is no baseline yet', async () => {
    const { container, watch } = await setupWatch();
    const [outcome] = await container.watcher.tick();

    expect(outcome?.kind).toBe('audited');
    expect(await kinds(container, watch.id)).toEqual(['polled', 'audited']);
  });

  it('does not spend an audit when the content has not changed', async () => {
    const { container, clock, watch } = await setupWatch();
    await container.watcher.tick();

    clock.advance(INTERVAL_MS.daily);
    const [outcome] = await container.watcher.tick();

    expect(outcome?.kind).toBe('unchanged');
    expect(await kinds(container, watch.id)).toContain('unchanged');

    // Exactly one audit exists, not two.
    const audits = await container.services.audits.list({ limit: 50, siteId: watch.siteId }, 'org-1');
    expect(audits.items).toHaveLength(1);
  });

  it('ignores whitespace-only changes', async () => {
    const { container, clock, fetcher } = await setupWatch();
    await container.watcher.tick();

    // A build that only reflows indentation must not read as a deploy.
    fetcher.set(URL, GOOD_PAGE.replace(/\n/g, '\n   ').replace(/> </g, '>  <'));
    clock.advance(INTERVAL_MS.daily);

    const [outcome] = await container.watcher.tick();
    expect(outcome?.kind).toBe('unchanged');
  });

  it('re-audits when the content actually changes', async () => {
    const { container, clock, fetcher, watch } = await setupWatch();
    await container.watcher.tick();

    fetcher.set(URL, REGRESSED_PAGE);
    clock.advance(INTERVAL_MS.daily);

    const [outcome] = await container.watcher.tick();
    expect(outcome?.kind).toBe('audited');
    expect(outcome?.changed).toBe(true);
    expect(await kinds(container, watch.id)).toContain('changed');
  });

  it('audits unchanged content when the watch asks for it', async () => {
    const { container, clock } = await setupWatch();
    const site = await container.services.sites.create('org-1', {
      url: 'https://example.test/always',
      label: 'Always',
      target: 'AA',
    });
    container.repositories.sites.update(site.id, {});

    const { container: c2, clock: clock2, fetcher: f2 } = createTestContainer({
      'https://example.test/x': GOOD_PAGE,
    });
    const s2 = await c2.services.sites.create('org-1', {
      url: 'https://example.test/x',
      label: 'X',
      target: 'AA',
    });
    await c2.services.watches.create({ siteId: s2.id, interval: 'daily', auditUnchanged: true }, 'org-1');

    await c2.watcher.tick();
    clock2.advance(INTERVAL_MS.daily);
    const [outcome] = await c2.watcher.tick();

    expect(outcome?.kind).toBe('audited');
    expect(f2.calls).toHaveLength(2);
    void container;
    void clock;
  });
});

describe('regression reporting', () => {
  it('records a regression event naming the issues introduced', async () => {
    const { container, clock, fetcher, watch } = await setupWatch();
    await container.watcher.tick();

    fetcher.set(URL, REGRESSED_PAGE);
    clock.advance(INTERVAL_MS.daily);
    const [outcome] = await container.watcher.tick();

    expect(outcome?.scoreDelta).toBeLessThan(0);

    const history = await container.services.watches.history(watch.id, 'org-1');
    const regression = history.find((event) => event.kind === 'regressed');
    expect(regression).toBeDefined();
    expect(regression?.message).toMatch(/new issue/i);
    expect(regression?.scoreDelta).toBeLessThan(0);
    expect(regression?.auditId).toBeTruthy();
  });

  it('records an improvement when issues are resolved', async () => {
    const { container, clock, fetcher, watch } = await setupWatch({ [URL]: REGRESSED_PAGE });
    await container.watcher.tick();

    fetcher.set(URL, GOOD_PAGE);
    clock.advance(INTERVAL_MS.daily);
    await container.watcher.tick();

    const history = await container.services.watches.history(watch.id, 'org-1');
    const improvement = history.find((event) => event.kind === 'improved');
    expect(improvement).toBeDefined();
    expect(improvement?.scoreDelta).toBeGreaterThan(0);
    expect(improvement?.message).toMatch(/resolved/i);
  });

  it('produces a diff a developer can act on', async () => {
    const { container, clock, fetcher } = await setupWatch();
    await container.watcher.tick();

    fetcher.set(URL, REGRESSED_PAGE);
    clock.advance(INTERVAL_MS.daily);
    const [outcome] = await container.watcher.tick();

    const diff = await container.services.audits.diffWithPrevious(outcome!.auditId!, 'org-1');
    expect(diff).not.toBeNull();
    expect(diff!.introduced.length).toBeGreaterThan(0);
    expect(diff!.introduced.some((f) => f.ruleId === 'image-alt')).toBe(true);
    expect(diff!.criteriaRegressed).toContain('1.1.1');
  });
});

describe('failure handling', () => {
  it('records a failed poll without stopping the watch', async () => {
    const { container, watch } = await setupWatch({});
    const [outcome] = await container.watcher.tick();

    expect(outcome?.kind).toBe('failed');

    const history = await container.services.watches.history(watch.id, 'org-1');
    expect(history[0]?.kind).toBe('poll_failed');
    expect(history[0]?.message).toMatch(/could not/i);

    const updated = await container.services.watches.findById(watch.id);
    expect(updated.status).toBe('active');
  });

  it('advances the schedule after a failure, so no backlog builds up', async () => {
    const { container, clock, watch } = await setupWatch({});
    await container.watcher.tick();

    const updated = await container.services.watches.findById(watch.id);
    expect(new Date(updated.nextPollAt).getTime()).toBe(clock.now().getTime() + INTERVAL_MS.daily);
  });

  it('does not replay a week of missed polls when a site comes back', async () => {
    const { container, clock } = await setupWatch({}, 'hourly');
    await container.watcher.tick();

    // The site was unreachable for a week.
    clock.advance(7 * 24 * 60 * 60 * 1000);

    // Exactly one poll fires, not 168.
    expect(await container.watcher.tick()).toHaveLength(1);
    expect(await container.watcher.tick()).toHaveLength(0);
  });

  it('pauses a watch whose site has been deleted', async () => {
    const { container, site, watch } = await setupWatch();
    await container.repositories.sites.delete(site.id);

    const [outcome] = await container.watcher.tick();
    expect(outcome?.kind).toBe('skipped');

    const updated = await container.services.watches.findById(watch.id);
    expect(updated.status).toBe('paused');
  });

  it('does not overlap ticks', async () => {
    const { container } = await setupWatch();
    const [first, second] = await Promise.all([container.watcher.tick(), container.watcher.tick()]);
    // One tick does the work; the other returns immediately rather than
    // double-polling the same due watch.
    expect(first.length + second.length).toBe(1);
  });
});

describe('watch lifecycle', () => {
  it('refuses a second watch on the same site', async () => {
    const { container, site } = await setupWatch();
    await expect(
      container.services.watches.create(
        {
          siteId: site.id,
          interval: 'daily',
          auditUnchanged: false,
        },
        'org-1',
      ),
    ).rejects.toThrow(/already being monitored/i);
  });

  it('rejects a watch on a site that does not exist', async () => {
    const { container } = await setupWatch();
    await expect(
      container.services.watches.create(
        {
          siteId: '00000000-0000-4000-8000-000000009999',
          interval: 'daily',
          auditUnchanged: false,
        },
        'org-1',
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('removes the watch when its site is deleted', async () => {
    const { container, site, watch } = await setupWatch();
    await container.services.sites.delete(site.id, 'org-1');

    await expect(container.services.watches.findById(watch.id)).rejects.toThrow(/not found/i);
  });

  it('keeps an append-only history', async () => {
    const { container, clock, fetcher, watch } = await setupWatch();
    await container.watcher.tick();
    fetcher.set(URL, REGRESSED_PAGE);
    clock.advance(INTERVAL_MS.daily);
    await container.watcher.tick();

    const history = await container.services.watches.history(watch.id, 'org-1');
    expect(history.length).toBeGreaterThan(3);
    // Newest first, and every event is timestamped.
    for (const event of history) {
      expect(() => new Date(event.at).toISOString()).not.toThrow();
    }
    const timestamps = history.map((e) => e.at);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
  });
});
