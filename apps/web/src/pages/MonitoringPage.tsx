import { Page } from '../components/Page.js';
import { Callout, ScrollRegion } from '../components/primitives.js';

const EVENTS = [
  ['polled', 'We requested the page.', 'Every check, successful or not.'],
  ['unchanged', 'The page is byte-for-byte identical.', 'No audit was spent.'],
  ['changed', 'The content hash moved.', 'Something was deployed. An audit follows.'],
  ['audited', 'A fresh report was produced.', 'Linked to the full report.'],
  ['regressed', 'The score fell.', 'Names the issues that were introduced.'],
  ['improved', 'The score rose.', 'Names the issues that were resolved.'],
  ['poll_failed', 'We could not reach the page.', 'The schedule advances anyway — no backlog.'],
] as const;

export function MonitoringPage(): React.JSX.Element {
  return (
    <Page
      title="Continuous monitoring"
      heading="Watch every page you ship"
      eyebrow="Monitoring"
      lede="Accessibility work decays. A team remediates, ships for six months, and the same defects are back — because nothing was checking. The watcher is the part that makes remediation stick."
    >
      <div className="section section--tight">
        <div className="container container--narrow flow">
          <h2>Content-addressed, not calendar-driven</h2>
          <p>
            Every poll fetches your page and hashes the normalised markup. If the hash has not
            moved, nothing has changed, and no audit is run. That keeps the cost proportional to
            how often you actually ship rather than to how often we happen to look.
          </p>
          <p>
            It also makes the event stream mean something. A <code>changed</code> event
            corresponds to a real deploy, so when a regression appears you know which release to
            look at.
          </p>

          <Callout tone="info" title="Whitespace does not count as a change">
            <p className="mb-0">
              The hash is taken over normalised markup, so a build that reflows indentation does
              not read as a content change and does not burn an audit.
            </p>
          </Callout>

          <h2>What you get told</h2>
          <p>
            Not &ldquo;your score is 82&rdquo;. The watcher reports differences: which findings
            are new since the last audit, which are resolved, and which success criteria moved
            from passing to failing. Findings are matched by a deterministic identifier derived
            from the rule, the element and the problem, so an unmoved, unfixed issue is
            recognised as the same issue across runs rather than reported as new every time.
          </p>

          <h2>The event trail</h2>
          <p>
            Every watch keeps an append-only history. That history is the evidence you hand to an
            auditor when they ask what you have been doing about accessibility since your last
            report.
          </p>

          <ScrollRegion label="Watch event types">
            <table className="table">
              <caption>Events recorded against a watch</caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Meaning</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {EVENTS.map(([kind, meaning, notes]) => (
                  <tr key={kind}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <code>{kind}</code>
                    </th>
                    <td>{meaning}</td>
                    <td className="muted">{notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <h2>Failure handling</h2>
          <p>
            When a page cannot be reached, the failure is recorded and the schedule advances from
            the current time rather than from the missed slot. A site that was down for a week
            does not come back to seven queued audits firing at once.
          </p>
        </div>
      </div>
    </Page>
  );
}
