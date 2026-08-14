import { Link, useParams } from 'react-router-dom';
import { Page } from '../components/Page.js';
import { Callout, Icon, icons } from '../components/primitives.js';
import { ReportView } from '../components/ReportView.js';
import { AsyncSection } from '../components/dashboard.js';
import { ApiError, api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

/**
 * A stored report, with its diff against the previous audit of the same page.
 *
 * The diff leads. For a monitoring customer the useful question is never "what
 * is the score" but "what changed since the last time", and burying that under
 * the full findings list makes them hunt for it.
 */
export function AuditDetailPage(): React.JSX.Element {
  const { id = '' } = useParams<{ id: string }>();

  /*
   * A 404 is an outcome, not a failure to load: the friendly "report not
   * found" empty state below depends on it resolving to null rather than
   * surfacing as the generic error callout.
   */
  const audit = useAsync(
    () =>
      api.getAudit(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    [id],
  );

  /*
   * A first audit has nothing to compare against; the API returns 204 and the
   * client turns that into null, and a 404 means the same for a foreign id.
   * Other failures are kept apart so a transient error is not mistaken for
   * "nothing changed".
   */
  const diff = useAsync(
    () =>
      api.getAuditDiff(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    [id],
  );

  const report = audit.state.data;
  const comparison = diff.state.status === 'ready' ? diff.state.data : null;
  const comparisonUnavailable = diff.state.status === 'error';

  return (
    <Page
      title={report ? `Report — ${report.subject.title ?? report.subject.url}` : 'Report'}
      heading={report ? `Report for ${report.subject.title ?? report.subject.url}` : 'Report'}
      eyebrow="Audit"
    >
      <div className="section section--tight">
        <div className="container">
          <AsyncSection
            status={audit.state.status}
            error={audit.state.error}
            label="the report"
            isEmpty={audit.state.status === 'ready' && !report}
            emptyTitle="Report not found"
            emptyBody={
              <p className="mb-0">
                That report does not exist, or it has been removed. Return to your{' '}
                <Link to="/dashboard">dashboard</Link>.
              </p>
            }
          >
            {report ? (
              <>
                <div className="cluster no-print" style={{ marginBottom: 'var(--a-space-5)' }}>
                  <button type="button" className="btn btn--secondary" onClick={() => window.print()}>
                    <Icon path={icons.document} size={18} />
                    Print or save as PDF
                  </button>
                  <Link to="/dashboard" className="btn btn--ghost">
                    Back to dashboard
                  </Link>
                </div>

                {comparisonUnavailable ? (
                  <div style={{ marginBottom: 'var(--a-space-5)' }}>
                    <Callout tone="warning" title="Comparison unavailable">
                      <p className="mb-0">
                        The comparison with the previous audit could not be loaded. The report
                        below is complete on its own.
                      </p>
                    </Callout>
                  </div>
                ) : null}

                {comparison ? (
                  <div style={{ marginBottom: 'var(--a-space-6)' }}>
                    <Callout
                      tone={comparison.scoreDelta < 0 ? 'danger' : comparison.scoreDelta > 0 ? 'success' : 'info'}
                      title={
                        comparison.scoreDelta < 0
                          ? `Regressed by ${Math.abs(comparison.scoreDelta)} points since the previous audit`
                          : comparison.scoreDelta > 0
                            ? `Improved by ${comparison.scoreDelta} points since the previous audit`
                            : 'No change in score since the previous audit'
                      }
                    >
                      <p>
                        <strong>{comparison.introduced.length}</strong>{' '}
                        {comparison.introduced.length === 1 ? 'issue was' : 'issues were'}{' '}
                        introduced and <strong>{comparison.resolved.length}</strong>{' '}
                        {comparison.resolved.length === 1 ? 'was' : 'were'} resolved.
                      </p>

                      {comparison.criteriaRegressed.length > 0 ? (
                        <p>
                          Criteria that started failing:{' '}
                          <strong>{comparison.criteriaRegressed.join(', ')}</strong>.
                        </p>
                      ) : null}

                      {comparison.introduced.length > 0 ? (
                        <>
                          <p className="mb-0">
                            <strong>New in this audit:</strong>
                          </p>
                          <ul className="mb-0">
                            {comparison.introduced.slice(0, 5).map((finding) => (
                              <li key={finding.id}>
                                {finding.ruleTitle} — <code>{finding.location.selector}</code>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </Callout>
                  </div>
                ) : null}

                <ReportView report={report} />
              </>
            ) : null}
          </AsyncSection>
        </div>
      </div>
    </Page>
  );
}
