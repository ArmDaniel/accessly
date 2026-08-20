import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuditReport, Site, Watch } from '@accessly/contracts';
import { Page } from '../components/Page.js';
import { Callout, Field, Icon, icons, ScrollRegion } from '../components/primitives.js';
import {
  ActionStatus,
  AsyncSection,
  ConfirmButton,
  ScoreValue,
  StatCard,
  bandFor,
  formatWhen,
} from '../components/dashboard.js';
import { ApiError, api } from '../lib/api.js';
import { useAction, useAsync } from '../lib/useAsync.js';

/**
 * The general dashboard.
 *
 * Everything a client gets without a monitoring subscription: the pages they
 * have registered, the latest score for each, and the controls to add, scan or
 * remove one.
 *
 * Accessibility notes specific to this page:
 *  - The site list is a table with a caption and row headers, because it is
 *    genuinely tabular. Rendering it as divs would leave a screen reader user
 *    with no way to know which score belongs to which page.
 *  - Every action announces its result in a live region. A button that acts
 *    silently is invisible to anyone not watching the screen.
 *  - Deleting is behind an inline confirmation with focus moved onto it.
 */
export function DashboardPage(): React.JSX.Element {
  const sites = useAsync(() => api.listSites(), []);
  const watches = useAsync(() => api.listWatches(), []);
  const action = useAction();

  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ url?: string; label?: string }>({});
  const errorRef = useRef<HTMLDivElement | null>(null);

  const siteList: readonly Site[] = sites.state.data?.items ?? [];
  const watchList: readonly Watch[] = watches.state.data?.items ?? [];
  const watchedSiteIds = new Set(watchList.map((watch) => watch.siteId));

  const scored = siteList.filter((site) => site.latestScore !== null);
  const averageScore =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((total, site) => total + (site.latestScore ?? 0), 0) / scored.length);

  const failing = scored.filter((site) => (site.latestScore ?? 100) < 70).length;

  const fail = (message: string, fields: { url?: string; label?: string } = {}): void => {
    setFormError(message);
    setFieldErrors(fields);
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  async function addSite(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    action.clear();

    if (url.trim().length === 0 || label.trim().length === 0) {
      fail('Fill in both fields to add a page.', {
        ...(url.trim().length === 0 ? { url: 'Enter the address of the page.' } : {}),
        ...(label.trim().length === 0 ? { label: 'Give the page a name you will recognise.' } : {}),
      });
      return;
    }

    try {
      const site = await api.createSite({ url: url.trim(), label: label.trim(), target: 'AA' });
      setUrl('');
      setLabel('');
      sites.reload();
      await action.run(async () => `Added ${site.label}. Run a scan to get its first score.`);
    } catch (error) {
      if (error instanceof ApiError) {
        fail([error.problem.title, error.detail].filter(Boolean).join(' '), {
          ...(error.fieldErrors('url')[0] ? { url: error.fieldErrors('url')[0] as string } : {}),
          ...(error.fieldErrors('label')[0]
            ? { label: error.fieldErrors('label')[0] as string }
            : {}),
        });
      } else {
        fail('That page could not be added.');
      }
    }
  }

  return (
    <Page
      title="Dashboard"
      heading="Your dashboard"
      eyebrow="Overview"
      lede="The pages you have registered, and how each one is doing against WCAG 2.1 level AA."
    >
      <div className="section section--tight">
        <div className="container">
          <ActionStatus message={action.message} error={action.error} />

          {/* ── Summary ────────────────────────────────────────────────── */}
          <section aria-labelledby="dash-summary">
            <h2 id="dash-summary" className="visually-hidden">
              Summary
            </h2>
            <ul className="stats">
              <StatCard value={siteList.length} label="Registered pages" />
              <StatCard
                value={averageScore === null ? '—' : averageScore}
                label="Average score"
                {...(averageScore !== null ? { tone: bandFor(averageScore) } : {})}
              />
              <StatCard value={failing} label="Pages below 70" />
              <StatCard value={watchList.length} label="Monitored pages" />
            </ul>

            <p className="cluster" style={{ marginTop: 'var(--a-space-4)' }}>
              <Link to="/dashboard/monitoring">Monitoring and regressions</Link>
              <Link to="/dashboard/journeys">Recorded sessions</Link>
              <Link to="/scan">Scan a document</Link>
            </p>
          </section>

          {/* ── Sites ──────────────────────────────────────────────────── */}
          <section aria-labelledby="dash-sites" style={{ marginTop: 'var(--a-space-7)' }}>
            <div className="cluster" style={{ justifyContent: 'space-between' }}>
              <h2 id="dash-sites">Registered pages</h2>
              <Link to="/scan" className="btn btn--sm btn--secondary">
                Run a one-off scan
              </Link>
            </div>

            <AsyncSection
              status={sites.state.status}
              error={sites.state.error}
              label="your pages"
              isEmpty={siteList.length === 0}
              emptyTitle="You have not registered any pages yet"
              emptyBody={
                <p className="mb-0">
                  Add one below to start tracking its score over time. If you just want a single
                  report without registering anything, use the{' '}
                  <Link to="/scan">one-off scanner</Link> instead.
                </p>
              }
            >
              <ScrollRegion label="Registered pages">
                <table className="table">
                  <caption>
                    Pages you have registered, with the score from their most recent audit
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col">Latest score</th>
                      <th scope="col">Monitoring</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteList.map((site) => (
                      <tr key={site.id}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          <strong>{site.label}</strong>
                          <br />
                          <span className="muted" style={{ fontSize: 'var(--a-text-xs)' }}>
                            {site.url}
                          </span>
                        </th>
                        <td>
                          <ScoreValue value={site.latestScore} />
                        </td>
                        <td>
                          {watchedSiteIds.has(site.id) ? (
                            <Link to="/dashboard/monitoring">On</Link>
                          ) : (
                            <span className="muted">Off</span>
                          )}
                        </td>
                        <td>
                          <div className="cluster">
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary"
                              disabled={action.isBusy}
                              onClick={() =>
                                void action.run(async () => {
                                  const report = await api.createAudit({
                                    source: 'url',
                                    url: site.url,
                                    target: site.target,
                                    siteId: site.id,
                                  });
                                  sites.reload();
                                  return `Scanned ${site.label}. Score ${report.score.value} out of 100, ${report.summary.total} issues found.`;
                                })
                              }
                            >
                              {/* The page name is in the label, so a screen
                                  reader user hearing a list of buttons is not
                                  given five identical "Scan" entries. */}
                              Scan
                              <span className="visually-hidden"> {site.label}</span>
                            </button>

                            {site.latestAuditId ? (
                              <Link
                                to={`/dashboard/audits/${site.latestAuditId}`}
                                className="btn btn--sm btn--ghost"
                              >
                                View report
                                <span className="visually-hidden"> for {site.label}</span>
                              </Link>
                            ) : null}

                            {!watchedSiteIds.has(site.id) ? (
                              <button
                                type="button"
                                className="btn btn--sm btn--ghost"
                                disabled={action.isBusy}
                                onClick={() =>
                                  void action.run(async () => {
                                    await api.createWatch({
                                      siteId: site.id,
                                      interval: 'daily',
                                      auditUnchanged: false,
                                    });
                                    watches.reload();
                                    return `Monitoring switched on for ${site.label}. It will be checked daily.`;
                                  })
                                }
                              >
                                Monitor
                                <span className="visually-hidden"> {site.label}</span>
                              </button>
                            ) : null}

                            <ConfirmButton
                              label={`Remove`}
                              confirmLabel="Yes, remove it"
                              question={`Remove ${site.label} and its monitoring?`}
                              disabled={action.isBusy}
                              onConfirm={() =>
                                void action.run(async () => {
                                  await api.deleteSite(site.id);
                                  sites.reload();
                                  watches.reload();
                                  return `${site.label} was removed.`;
                                })
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </AsyncSection>
          </section>

          {/* ── Add a page ─────────────────────────────────────────────── */}
          <section aria-labelledby="dash-add" style={{ marginTop: 'var(--a-space-7)' }}>
            <h2 id="dash-add">Add a page</h2>

            <form onSubmit={addSite} noValidate style={{ maxWidth: '38rem' }}>
              {formError ? (
                <div ref={errorRef} tabIndex={-1} role="alert" style={{ marginBottom: 'var(--a-space-5)' }}>
                  <Callout tone="danger" title="That page could not be added">
                    <p className="mb-0">{formError}</p>
                  </Callout>
                </div>
              ) : null}

              <Field
                label="Page address"
                hint="A full, publicly reachable URL. We fetch it as it is served."
                error={fieldErrors.url ?? null}
                required
              >
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    type="url"
                    name="url"
                    inputMode="url"
                    spellCheck={false}
                    placeholder="https://example.eu/checkout"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Name"
                hint="How this page appears in your dashboard."
                error={fieldErrors.label ?? null}
                required
              >
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    type="text"
                    name="label"
                    placeholder="Checkout"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                )}
              </Field>

              <button type="submit" className="btn btn--primary" aria-busy={action.isBusy}>
                Add page
                <Icon path={icons.arrowRight} size={18} />
              </button>
            </form>
          </section>

          {/* ── Recent activity ────────────────────────────────────────── */}
          {/*
            Remounting this section on every site change throws away its DOM
            and double-fetches; passing the fingerprint as a prop lets the
            section refetch in place when a scan produces new audits.
          */}
          <RecentAudits fingerprint={siteList.map((s) => s.latestAuditId).join('|')} />
        </div>
      </div>
    </Page>
  );
}

/** The most recent audits across every registered page, load-more on demand. */
function RecentAudits({ fingerprint }: { fingerprint: string }): React.JSX.Element {
  const audits = useAsync(() => api.listAudits({ limit: 10 }), [fingerprint]);

  const [older, setOlder] = useState<readonly AuditReport[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const base = audits.state.data ?? null;

  // A refetch of the first page resets anything accumulated behind it.
  useEffect(() => {
    setOlder([]);
    setNextCursor(base?.nextCursor ?? null);
    setMoreError(null);
  }, [base]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.listAudits({ limit: 10, cursor: nextCursor });
      setOlder((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMoreError('Older audits could not be loaded. Try again.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  const items = [...(base?.items ?? []), ...older];

  return (
    <section aria-labelledby="dash-recent" style={{ marginTop: 'var(--a-space-7)' }}>
      <h2 id="dash-recent">Recent audits</h2>

      <AsyncSection
        status={audits.state.status}
        error={audits.state.error}
        label="recent audits"
        isEmpty={items.length === 0}
        emptyTitle="No audits yet"
        emptyBody={<p className="mb-0">Scan one of your pages and its report will appear here.</p>}
      >
        <ScrollRegion label="Recent audits">
          <table className="table">
            <caption>Audits run across all your pages, most recent first</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Run</th>
                <th scope="col">Score</th>
                <th scope="col">Issues</th>
                <th scope="col">Report</th>
              </tr>
            </thead>
            <tbody>
              {items.map((report) => (
                <tr key={report.id}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    {report.subject.title ?? report.subject.url}
                  </th>
                  <td>{formatWhen(report.startedAt)}</td>
                  <td>
                    <ScoreValue value={report.score.value} />
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{report.summary.total}</td>
                  <td>
                    <Link to={`/dashboard/audits/${report.id}`}>
                      Open
                      <span className="visually-hidden">
                        {' '}
                        the report for {report.subject.title ?? report.subject.url}
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>

        {moreError ? (
          <p role="alert" className="mb-0" style={{ marginTop: 'var(--a-space-3)' }}>
            {moreError}
          </p>
        ) : null}

        {nextCursor ? (
          <button
            type="button"
            className="btn btn--secondary"
            aria-busy={isLoadingMore}
            disabled={isLoadingMore}
            onClick={() => void loadMore()}
            style={{ marginTop: 'var(--a-space-4)' }}
          >
            {isLoadingMore ? (
              <>
                <span className="spinner" aria-hidden="true" /> Loading older audits…
              </>
            ) : (
              'Show older audits'
            )}
          </button>
        ) : null}

        {items.length > 0 && !nextCursor ? (
          <p className="muted mb-0" style={{ marginTop: 'var(--a-space-3)' }}>
            Showing every audit.
          </p>
        ) : null}

        {/* Announced so a screen reader user knows the list grew. */}
        <p role="status" aria-live="polite" className="visually-hidden">
          {older.length > 0 ? `Showing ${items.length} audits.` : ''}
        </p>
      </AsyncSection>
    </section>
  );
}
