import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Site, Watch, WatchInterval } from '@accessly/contracts';
import { Page } from '../components/Page.js';
import { Badge, Disclosure, ScrollRegion } from '../components/primitives.js';
import {
  ActionStatus,
  AsyncSection,
  ConfirmButton,
  EventBadge,
  ScoreDelta,
  ScoreValue,
  StatCard,
  formatRelative,
  formatWhen,
} from '../components/dashboard.js';
import { api } from '../lib/api.js';
import { useAction, useAsync } from '../lib/useAsync.js';

const INTERVAL_LABEL: Record<WatchInterval, string> = {
  hourly: 'Every hour',
  daily: 'Every day',
  weekly: 'Every week',
};

/**
 * The monitoring dashboard.
 *
 * This is the subscribed-client view: what is being watched, when it was last
 * checked, and — the part that actually matters — what changed since last time.
 *
 * The design principle here is that a monitoring product's job is not to report
 * a score, it is to report a *difference*. So the timeline and the regression
 * events lead, and the absolute score is secondary.
 */
export function MonitoringDashboardPage(): React.JSX.Element {
  const watches = useAsync(() => api.listWatches(), []);
  const sites = useAsync(() => api.listSites(), []);
  const action = useAction();

  const watchList: readonly Watch[] = watches.state.data?.items ?? [];
  const siteList: readonly Site[] = sites.state.data?.items ?? [];
  const siteById = new Map(siteList.map((site) => [site.id, site]));

  const active = watchList.filter((watch) => watch.status === 'active').length;
  const dueSoon = watchList.filter(
    (watch) => watch.status === 'active' && new Date(watch.nextPollAt).getTime() - Date.now() < 3600_000,
  ).length;

  return (
    <Page
      title="Monitoring"
      heading="Monitoring"
      eyebrow="Continuous checks"
      lede="Every page you have subscribed to monitoring, when it was last checked, and what changed."
    >
      <div className="section section--tight">
        <div className="container">
          <ActionStatus message={action.message} error={action.error} />

          <section aria-labelledby="mon-summary">
            <h2 id="mon-summary" className="visually-hidden">
              Monitoring summary
            </h2>
            <ul className="stats">
              <StatCard value={watchList.length} label="Monitored pages" />
              <StatCard value={active} label="Active" />
              <StatCard value={watchList.length - active} label="Paused" />
              <StatCard value={dueSoon} label="Due within the hour" />
            </ul>
          </section>

          <section aria-labelledby="mon-watches" style={{ marginTop: 'var(--a-space-6)' }}>
            <h2 id="mon-watches">Monitored pages</h2>

            <AsyncSection
              status={watches.state.status}
              error={watches.state.error}
              label="your monitored pages"
              isEmpty={watchList.length === 0}
              emptyTitle="Nothing is being monitored yet"
              emptyBody={
                <>
                  <p>
                    Monitoring re-checks a page on a schedule and tells you when a deploy breaks
                    something. Turn it on for a page from your{' '}
                    <Link to="/dashboard">dashboard</Link>.
                  </p>
                  <p className="mb-0">
                    <Link to="/monitoring">Read how monitoring works</Link> before you rely on it —
                    particularly what it does when a page is unreachable.
                  </p>
                </>
              }
            >
              <div className="stack">
                {watchList.map((watch) => (
                  <WatchCard
                    key={watch.id}
                    watch={watch}
                    site={siteById.get(watch.siteId) ?? null}
                    isBusy={action.isBusy}
                    onAction={(run) => void action.run(run)}
                    onChanged={() => {
                      watches.reload();
                      sites.reload();
                    }}
                  />
                ))}
              </div>
            </AsyncSection>
          </section>
        </div>
      </div>
    </Page>
  );
}

function WatchCard({
  watch,
  site,
  isBusy,
  onAction,
  onChanged,
}: {
  watch: Watch;
  site: Site | null;
  isBusy: boolean;
  onAction: (run: () => Promise<string>) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const name = site?.label ?? 'Unknown page';

  return (
    <article className="card" aria-labelledby={`watch-${watch.id}`}>
      <div className="cluster" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 id={`watch-${watch.id}`} style={{ marginBottom: 'var(--a-space-1)' }}>
            {name}
          </h3>
          <p className="muted" style={{ fontSize: 'var(--a-text-sm)', margin: 0 }}>
            {site?.url}
          </p>
        </div>
        <div className="cluster">
          {/* Status as a word, not a coloured dot. */}
          <Badge tone={watch.status === 'active' ? 'success' : 'neutral'} srPrefix="Status: ">
            {watch.status === 'active' ? 'Active' : 'Paused'}
          </Badge>
          <Badge tone="info" srPrefix="Frequency: ">
            {INTERVAL_LABEL[watch.interval]}
          </Badge>
        </div>
      </div>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
          gap: 'var(--a-space-4)',
          margin: 'var(--a-space-5) 0',
        }}
      >
        <div>
          <dt className="muted" style={{ fontSize: 'var(--a-text-sm)' }}>
            Latest score
          </dt>
          <dd style={{ margin: 0 }}>
            <ScoreValue value={site?.latestScore ?? null} />
          </dd>
        </div>
        <div>
          <dt className="muted" style={{ fontSize: 'var(--a-text-sm)' }}>
            Last checked
          </dt>
          <dd style={{ margin: 0 }}>
            {watch.lastPolledAt ? (
              <>
                <time dateTime={watch.lastPolledAt}>{formatWhen(watch.lastPolledAt)}</time>{' '}
                <span className="muted">({formatRelative(watch.lastPolledAt)})</span>
              </>
            ) : (
              <span className="muted">Not yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="muted" style={{ fontSize: 'var(--a-text-sm)' }}>
            Next check
          </dt>
          <dd style={{ margin: 0 }}>
            {watch.status === 'active' ? (
              <time dateTime={watch.nextPollAt}>{formatRelative(watch.nextPollAt)}</time>
            ) : (
              <span className="muted">Paused</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="cluster">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={isBusy}
          onClick={() =>
            onAction(async () => {
              const result = await api.pollWatch(watch.id);
              onChanged();
              if (result.kind === 'unchanged') {
                return `${name} is unchanged since the last check, so no new audit was run.`;
              }
              if (result.kind === 'failed') {
                return `${name} could not be reached. The failure is recorded in the timeline.`;
              }
              if (result.scoreDelta !== undefined && result.scoreDelta !== 0) {
                return `${name} was re-audited. The score ${result.scoreDelta > 0 ? 'improved' : 'regressed'} by ${Math.abs(result.scoreDelta)} points.`;
              }
              return `${name} was re-audited with no change in score.`;
            })
          }
        >
          Check now
          <span className="visually-hidden"> — {name}</span>
        </button>

        <button
          type="button"
          className="btn btn--sm btn--secondary"
          disabled={isBusy}
          onClick={() =>
            onAction(async () => {
              const next = watch.status === 'active' ? 'paused' : 'active';
              await api.updateWatch(watch.id, { status: next });
              onChanged();
              return next === 'paused'
                ? `Monitoring paused for ${name}.`
                : `Monitoring resumed for ${name}. It will be checked shortly.`;
            })
          }
        >
          {watch.status === 'active' ? 'Pause' : 'Resume'}
          <span className="visually-hidden"> monitoring for {name}</span>
        </button>

        <IntervalPicker
          watch={watch}
          name={name}
          isBusy={isBusy}
          onAction={onAction}
          onChanged={onChanged}
        />

        <ConfirmButton
          label="Stop monitoring"
          confirmLabel="Yes, stop"
          question={`Stop monitoring ${name}?`}
          disabled={isBusy}
          onConfirm={() =>
            onAction(async () => {
              await api.deleteWatch(watch.id);
              onChanged();
              return `Monitoring stopped for ${name}. The page is still registered.`;
            })
          }
        />
      </div>

      <div style={{ marginTop: 'var(--a-space-5)' }}>
        <Disclosure summary={`Timeline for ${name}`}>
          <WatchTimeline watchId={watch.id} />
        </Disclosure>
      </div>
    </article>
  );
}

/**
 * Frequency control.
 *
 * A labelled `<select>` rather than a custom listbox: the native control is
 * already keyboard accessible, announces its value, and works with every
 * assistive technology without us reimplementing anything.
 *
 * It does not change context on selection — 3.2.2 On Input. The change is
 * applied by the adjacent button.
 */
function IntervalPicker({
  watch,
  name,
  isBusy,
  onAction,
  onChanged,
}: {
  watch: Watch;
  name: string;
  isBusy: boolean;
  onAction: (run: () => Promise<string>) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [interval, setInterval] = useState<WatchInterval>(watch.interval);
  const selectId = `interval-${watch.id}`;

  return (
    <span className="cluster">
      <label htmlFor={selectId} className="visually-hidden">
        Check frequency for {name}
      </label>
      <select
        id={selectId}
        className="select"
        style={{ width: 'auto' }}
        value={interval}
        disabled={isBusy}
        onChange={(event) => setInterval(event.target.value as WatchInterval)}
      >
        {(['hourly', 'daily', 'weekly'] as const).map((option) => (
          <option key={option} value={option}>
            {INTERVAL_LABEL[option]}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="btn btn--sm btn--ghost"
        disabled={isBusy || interval === watch.interval}
        onClick={() =>
          onAction(async () => {
            await api.updateWatch(watch.id, { interval });
            onChanged();
            return `${name} will now be checked ${INTERVAL_LABEL[interval].toLowerCase()}.`;
          })
        }
      >
        Apply
        <span className="visually-hidden"> new frequency for {name}</span>
      </button>
    </span>
  );
}

/** The append-only event history for one watch. */
function WatchTimeline({ watchId }: { watchId: string }): React.JSX.Element {
  const events = useAsync(() => api.listWatchEvents(watchId), [watchId]);
  const items = events.state.data?.items ?? [];

  return (
    <AsyncSection
      status={events.state.status}
      error={events.state.error}
      label="the timeline"
      isEmpty={items.length === 0}
      emptyTitle="Nothing recorded yet"
      emptyBody={
        <p className="mb-0">
          Events appear here after the first check. Use <strong>Check now</strong> if you do not
          want to wait for the schedule.
        </p>
      }
    >
      <ScrollRegion label="Monitoring timeline">
        <table className="table">
          <caption>
            Every check, change and audit recorded for this page, most recent first. This is the
            evidence trail an auditor will ask for.
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Event</th>
              <th scope="col">Detail</th>
              <th scope="col">Score change</th>
              <th scope="col">Report</th>
            </tr>
          </thead>
          <tbody>
            {items.map((event) => (
              <tr key={event.id}>
                <th scope="row" style={{ fontWeight: 400, whiteSpace: 'nowrap' }}>
                  <time dateTime={event.at}>{formatWhen(event.at)}</time>
                </th>
                <td>
                  <EventBadge kind={event.kind} />
                </td>
                <td>{event.message}</td>
                <td>
                  <ScoreDelta delta={event.scoreDelta} />
                </td>
                <td>
                  {event.auditId ? (
                    <Link to={`/dashboard/audits/${event.auditId}`}>
                      Open
                      <span className="visually-hidden"> the report from {formatWhen(event.at)}</span>
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </AsyncSection>
  );
}
