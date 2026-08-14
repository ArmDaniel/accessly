import { useMemo, useState } from 'react';
import {
  compareCriterionIds,
  findCriterion,
  type AuditReport,
  type ConformanceLevel,
  type CriterionScore,
  type Finding,
  type Impact,
  type Outcome,
} from '@accessly/contracts';
import { Badge, Callout, Disclosure, ScrollRegion } from './primitives.js';
import { ScoreDial } from './ScoreDial.js';

const IMPACT_LABEL: Record<Impact, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  cantTell: 'Needs review',
  inapplicable: 'Not applicable',
};

const OUTCOME_TONE: Record<Outcome, 'success' | 'danger' | 'warning' | 'neutral'> = {
  passed: 'success',
  failed: 'danger',
  cantTell: 'warning',
  inapplicable: 'neutral',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

/** One finding, with everything needed to reproduce and fix it. */
function FindingCard({ finding, index }: { finding: Finding; index: number }): React.JSX.Element {
  return (
    <li className={`finding finding--${finding.impact}`}>
      <div className="finding__head">
        <h4 className="finding__title">
          <span className="visually-hidden">Issue {index + 1}: </span>
          {finding.ruleTitle}
        </h4>
        {/*
          Impact and level are rendered as text inside badges, not as coloured
          dots. In greyscale, in forced-colors mode, and on a fax of a printout,
          the words still say what the colours said.
        */}
        <Badge tone={finding.impact === 'critical' || finding.impact === 'serious' ? 'danger' : 'warning'} srPrefix="Impact: ">
          {IMPACT_LABEL[finding.impact]}
        </Badge>
        <Badge tone="neutral" srPrefix="Conformance level: ">
          Level {finding.level}
        </Badge>
        {finding.outcome === 'cantTell' ? (
          <Badge tone="warning">Needs human review</Badge>
        ) : null}
      </div>

      <p>{finding.message}</p>

      <dl style={{ margin: 0 }}>
        <dt className="visually-hidden">Success criteria</dt>
        <dd style={{ margin: 0 }}>
          <span className="muted" style={{ fontSize: 'var(--a-text-sm)' }}>
            {/*
              An undecidable finding is not a failure, and labelling it one
              would misrepresent the result in a document people file as
              evidence.
            */}
            {finding.outcome === 'failed' ? 'Fails: ' : 'Relates to: '}
            {finding.criteria.map((id, i) => {
              const criterion = findCriterion(id);
              return (
                <span key={id}>
                  {i > 0 ? ', ' : ''}
                  <a href={criterion?.url ?? '#'} target="_blank" rel="noreferrer noopener">
                    {id} {criterion?.title}
                    <span className="visually-hidden"> (opens in a new window)</span>
                  </a>
                </span>
              );
            })}
          </span>
        </dd>
      </dl>

      <div className="finding__remedy">
        <p style={{ margin: 0 }}>
          <strong>How to fix it: </strong>
          {finding.remediation}
        </p>
      </div>

      <p className="muted" style={{ fontSize: 'var(--a-text-sm)', marginTop: 'var(--a-space-3)', marginBottom: 0 }}>
        <strong>Element: </strong>
        <code>{finding.location.selector}</code>
      </p>

      {finding.location.snippet ? (
        <code className="finding__snippet">{finding.location.snippet}</code>
      ) : null}
    </li>
  );
}

function CriteriaTable({ criteria }: { criteria: readonly CriterionScore[] }): React.JSX.Element {
  return (
    <ScrollRegion label="Success criteria results">
      <table className="table">
        <caption>
          Every WCAG 2.1 success criterion in scope, and what Accessly found. Criteria marked
          &ldquo;needs review&rdquo; cannot be judged by automation and require a human.
        </caption>
        <thead>
          <tr>
            {/*
              scope="col" is what tells a screen reader which header belongs to
              which cell when the user navigates the table by cell.
            */}
            <th scope="col">Criterion</th>
            <th scope="col">Level</th>
            <th scope="col">Result</th>
            <th scope="col">Issues</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map((criterion) => (
            <tr key={criterion.criterion}>
              <th scope="row" style={{ fontWeight: 400 }}>
                <strong>{criterion.criterion}</strong> {criterion.title}
              </th>
              <td>{criterion.level}</td>
              <td>
                <Badge tone={OUTCOME_TONE[criterion.outcome]}>
                  {criterion.requiresManualReview
                    ? 'Not automated'
                    : OUTCOME_LABEL[criterion.outcome]}
                </Badge>
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                {criterion.findingCount > 0 ? criterion.findingCount : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function ReportView({ report }: { report: AuditReport }): React.JSX.Element {
  const [levelFilter, setLevelFilter] = useState<'all' | ConformanceLevel>('all');

  const findings = useMemo(
    () =>
      levelFilter === 'all'
        ? report.findings
        : report.findings.filter((finding) => finding.level === levelFilter),
    [report.findings, levelFilter],
  );

  const sortedCriteria = useMemo(
    () => [...report.criteria].sort((a, b) => compareCriterionIds(a.criterion, b.criterion)),
    [report.criteria],
  );

  const confirmed = findings.filter((f) => f.outcome === 'failed');
  const needsReview = findings.filter((f) => f.outcome === 'cantTell');

  return (
    <article className="report">
      {/* ── Summary ──────────────────────────────────────────────────────── */}
      <section className="report__section" aria-labelledby="report-summary">
        <h2 id="report-summary">Result</h2>

        <div className="card" style={{ marginBottom: 'var(--a-space-5)' }}>
          <ScoreDial score={report.score} />
        </div>

        {/*
          The conformance verdict is stated separately from the score and in
          plainer terms, because a number invites "82 is nearly there" and
          conformance does not work that way — one unmet level A criterion means
          the page does not conform, full stop.
        */}
        <Callout
          tone={report.score.conformsTo === null ? 'danger' : 'success'}
          title={
            report.score.conformsTo === null
              ? 'This page does not conform to WCAG 2.1 level A'
              : `No automated failures at level ${report.score.conformsTo}`
          }
        >
          <p>
            {report.score.conformsTo === null
              ? `Accessly found ${report.score.criteriaFailed} failing success criteria. WCAG conformance is all-or-nothing: a single unmet level A criterion means the page does not conform, regardless of the score.`
              : `Accessly found no failures among the criteria it can test automatically. That is a necessary condition for conformance, not a claim of it.`}
          </p>
          <p className="mb-0">
            <strong>{report.score.criteriaRequiringManualReview}</strong> of the{' '}
            {report.score.criteriaEvaluated + report.score.criteriaRequiringManualReview} criteria
            in scope cannot be evaluated by any automated tool and still need a human reviewer. A
            full conformance claim requires that manual review.
          </p>
        </Callout>

        <ul className="stats" style={{ marginTop: 'var(--a-space-5)' }}>
          <li className="stat">
            <span className="stat__value">{report.summary.total}</span>
            <span className="stat__label">Issues found</span>
          </li>
          <li className="stat">
            <span className="stat__value">{report.summary.byImpact.critical}</span>
            <span className="stat__label">Critical</span>
          </li>
          <li className="stat">
            <span className="stat__value">{report.score.criteriaFailed}</span>
            <span className="stat__label">Criteria failed</span>
          </li>
          <li className="stat">
            <span className="stat__value">{report.score.criteriaPassed}</span>
            <span className="stat__label">Criteria passed</span>
          </li>
        </ul>

        <ScrollRegion label="Scores by WCAG principle">
          <table className="table">
            <caption>Score by WCAG principle</caption>
            <thead>
              <tr>
                <th scope="col">Principle</th>
                <th scope="col">Score</th>
                <th scope="col">Passed</th>
                <th scope="col">Failed</th>
              </tr>
            </thead>
            <tbody>
              {report.score.byPrinciple.map((principle) => (
                <tr key={principle.principle}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    {principle.principle}. {principle.title}
                  </th>
                  <td>
                    <div className="cluster">
                      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '3ch' }}>
                        {principle.score}
                      </span>
                      {/*
                        The bar is decorative — the number beside it carries the
                        value, so the bar is hidden from assistive technology
                        rather than given a redundant label.
                      */}
                      <span
                        className="meter"
                        style={{ width: '6rem' }}
                        aria-hidden="true"
                      >
                        <span className="meter__fill" style={{ width: `${principle.score}%` }} />
                      </span>
                    </div>
                  </td>
                  <td>{principle.criteriaPassed}</td>
                  <td>{principle.criteriaFailed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      {/* ── Issues ───────────────────────────────────────────────────────── */}
      <section className="report__section" aria-labelledby="report-issues">
        <h2 id="report-issues">Issues</h2>

        <fieldset className="fieldset no-print">
          <legend>Filter by conformance level</legend>
          <div className="radio-row">
            {(['all', 'A', 'AA', 'AAA'] as const).map((level) => (
              <label key={level} className="radio-option">
                <input
                  type="radio"
                  name="level-filter"
                  value={level}
                  checked={levelFilter === level}
                  onChange={() => setLevelFilter(level)}
                />
                {level === 'all' ? 'All levels' : `Level ${level}`}
              </label>
            ))}
          </div>
        </fieldset>

        {/*
          The count changes when the filter changes, and a sighted user sees
          that instantly. role="status" is how everyone else is told.
        */}
        <p role="status" aria-live="polite">
          Showing <strong>{findings.length}</strong>{' '}
          {findings.length === 1 ? 'issue' : 'issues'}
          {levelFilter === 'all' ? '' : ` at level ${levelFilter}`}.
        </p>

        {confirmed.length > 0 ? (
          <>
            <h3>Confirmed failures ({confirmed.length})</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {confirmed.map((finding, index) => (
                <FindingCard key={finding.id} finding={finding} index={index} />
              ))}
            </ul>
          </>
        ) : (
          <Callout tone="success" title="No confirmed failures at this level">
            <p className="mb-0">
              Nothing in this filter failed a check outright. Review the items below before
              treating that as a pass.
            </p>
          </Callout>
        )}

        {needsReview.length > 0 ? (
          <>
            <h3>Needs human review ({needsReview.length})</h3>
            <p className="muted">
              Accessly could not decide these from the markup alone — usually because the answer
              depends on rendered styling, on video content, or on intent. They are not failures,
              and they are not passes.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {needsReview.map((finding, index) => (
                <FindingCard key={finding.id} finding={finding} index={index} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* ── Criteria ─────────────────────────────────────────────────────── */}
      <section className="report__section" aria-labelledby="report-criteria">
        <h2 id="report-criteria">Success criteria</h2>
        <CriteriaTable criteria={sortedCriteria} />
      </section>

      {/* ── Methodology ──────────────────────────────────────────────────── */}
      <section className="report__section" aria-labelledby="report-method">
        <h2 id="report-method">Methodology and limitations</h2>

        <Disclosure summary="What was tested" defaultOpen>
          <dl>
            <dt>
              <strong>Page</strong>
            </dt>
            <dd>
              <code>{report.subject.url}</code>
            </dd>
            <dt>
              <strong>Title</strong>
            </dt>
            <dd>{report.subject.title ?? 'No page title was found.'}</dd>
            <dt>
              <strong>Declared language</strong>
            </dt>
            <dd>{report.subject.lang ?? 'None declared.'}</dd>
            <dt>
              <strong>Tested</strong>
            </dt>
            <dd>{formatDate(report.startedAt)}</dd>
            <dt>
              <strong>Engine</strong>
            </dt>
            <dd>
              {report.engine.name} {report.engine.version}, {report.engine.rulesRun} rules, WCAG{' '}
              {report.engine.wcagVersion}
            </dd>
          </dl>
        </Disclosure>

        <Disclosure summary="How the score is calculated">
          <p>
            The score is 75% <strong>criterion coverage</strong> — the weighted share of
            automatable criteria that pass, with level A weighted three times, AA twice and AAA
            once — and 25% <strong>instance density</strong>, which reflects how much of the page
            is affected, weighted by impact.
          </p>
          <p>
            Criteria that no automated rule covers are excluded from both terms and reported
            separately. Counting them as passes would inflate every score; counting them as
            failures would make a perfect page unreachable.
          </p>
          <p className="mb-0">
            The score exists to show progress over time. It is not a conformance claim and cannot
            be used as one.
          </p>
        </Disclosure>

        <Disclosure summary="What automated testing cannot tell you">
          <p>
            No automated tool can evaluate all 78 WCAG 2.1 success criteria, and any vendor
            claiming otherwise is selling you a number rather than an outcome. Automation reliably
            catches missing names, broken relationships, invalid ARIA and declared contrast — the
            defects that are cheap to find and cheap to fix.
          </p>
          <p className="mb-0">
            It cannot tell you whether your alt text is <em>accurate</em>, whether your focus order
            matches your visual order, whether your error messages are <em>helpful</em>, or whether
            your page makes sense when read aloud end to end. Those need a person, ideally one who
            uses assistive technology daily.
          </p>
        </Disclosure>
      </section>
    </article>
  );
}
