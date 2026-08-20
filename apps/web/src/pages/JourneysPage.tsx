import { useRef, useState } from 'react';
import type { JourneyReport } from '@accessly/contracts';
import { Page } from '../components/Page.js';
import { Badge, Callout, ScrollRegion } from '../components/primitives.js';
import { AsyncSection, StatCard, formatWhen } from '../components/dashboard.js';
import { JourneyPlayer, formatOffset } from '../components/JourneyPlayer.js';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

/**
 * Recorded sessions.
 *
 * The dashboard for journeys. It answers one question a page audit never can:
 * what actually happened to somebody using this site — where their focus went,
 * what they were told, and where it broke.
 *
 * Selecting a session loads its full report and hands it to the player. Focus
 * moves to the player heading, because that is where the new information is.
 */
export function JourneysPage(): React.JSX.Element {
  const reports = useAsync(() => api.listJourneyReports({ limit: 50 }), []);
  const journeys = useAsync(() => api.listJourneys(), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useAsync(
    async () => (selectedId ? api.getJourneyReport(selectedId) : null),
    [selectedId],
  );

  const playerRef = useRef<HTMLHeadingElement | null>(null);

  const items: readonly JourneyReport[] = reports.state.data?.items ?? [];
  const failures = items.reduce(
    (total, report) => total + report.findings.filter((f) => f.outcome === 'failed').length,
    0,
  );
  const focusLosses = items.reduce((total, report) => total + report.summary.focusLosses, 0);

  return (
    <Page
      title="Recorded sessions"
      heading="Recorded sessions"
      eyebrow="From the user’s perspective"
      lede="A page audit checks markup. These recordings check the experience — where focus went, what was announced, and what a keyboard or screen-reader user was left with."
    >
      <div className="section section--tight">
        <div className="container">
          <section aria-labelledby="journey-summary">
            <h2 id="journey-summary" className="visually-hidden">
              Session summary
            </h2>
            <ul className="stats">
              <StatCard value={items.length} label="Recorded sessions" />
              <StatCard value={journeys.state.data?.items.length ?? 0} label="Defined journeys" />
              <StatCard value={failures} label="Confirmed failures" />
              <StatCard value={focusLosses} label="Times focus was lost" />
            </ul>
          </section>

          <Callout tone="info" title="What these recordings contain">
            <p className="mb-0">
              Focus movement, live-region announcements, dialogs and navigation — never the
              contents of a form field. A recording of a checkout is a transcript of what was
              announced, not of what was typed.
            </p>
          </Callout>

          <section aria-labelledby="journey-list" style={{ marginTop: 'var(--a-space-6)' }}>
            <h2 id="journey-list">Sessions</h2>

            <AsyncSection
              status={reports.state.status}
              error={reports.state.error}
              label="recorded sessions"
              isEmpty={items.length === 0}
              emptyTitle="No sessions recorded yet"
              emptyBody={
                <>
                  <p>
                    Add the Accessly tracker to your site and it will post a trace of each session
                    it records. Define a journey first if you want specific expectations checked —
                    “after the dialog closes, focus must return to the button that opened it”.
                  </p>
                  <p className="mb-0 muted">
                    Nothing is recorded until you embed the tracker, and the tracker never captures
                    page contents or input values.
                  </p>
                </>
              }
            >
              <ScrollRegion label="Recorded sessions">
                <table className="table">
                  <caption className="visually-hidden">
                    Recorded sessions, newest first, with what each one found.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col">Recorded</th>
                      <th scope="col">Length</th>
                      <th scope="col">Findings</th>
                      <th scope="col">Input</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((report) => {
                      const failed = report.findings.filter((f) => f.outcome === 'failed').length;
                      const review = report.findings.length - failed;
                      return (
                        <tr key={report.id}>
                          <th scope="row">{report.name}</th>
                          <td>{formatWhen(report.startedAt)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatOffset(report.summary.durationMs)}
                          </td>
                          <td>
                            {failed > 0 ? (
                              <Badge tone="danger">
                                {failed} failing
                              </Badge>
                            ) : (
                              <Badge tone="success">No failures</Badge>
                            )}{' '}
                            {review > 0 ? <Badge tone="warning">{review} to review</Badge> : null}
                          </td>
                          <td>
                            {report.summary.keyboardOnly ? 'Keyboard only' : 'Used a pointer'}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary"
                              onClick={() => {
                                setSelectedId(report.id);
                                window.setTimeout(() => playerRef.current?.focus(), 0);
                              }}
                            >
                              Replay
                              <span className="visually-hidden"> {report.name}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollRegion>
            </AsyncSection>
          </section>

          {selectedId ? (
            <section aria-labelledby="journey-player" style={{ marginTop: 'var(--a-space-7)' }}>
              <h2 id="journey-player" ref={playerRef} tabIndex={-1}>
                {detail.state.data?.name ?? 'Session replay'}
              </h2>

              <AsyncSection
                status={detail.state.status}
                error={detail.state.error}
                label="this session"
              >
                {detail.state.data ? (
                  <>
                    {detail.state.data.steps.length > 0 ? (
                      <div style={{ marginBottom: 'var(--a-space-5)' }}>
                        <h3>Declared expectations</h3>
                        <ul className="expectations">
                          {detail.state.data.steps.map((step) => (
                            <li key={step.stepId}>
                              <Badge tone={step.satisfied ? 'success' : 'danger'} srPrefix="Result: ">
                                {step.satisfied ? 'Met' : 'Not met'}
                              </Badge>{' '}
                              <strong>{step.label}</strong> — {step.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <JourneyPlayer report={detail.state.data} />
                  </>
                ) : null}
              </AsyncSection>
            </section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
