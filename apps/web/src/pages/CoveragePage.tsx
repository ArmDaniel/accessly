import { compareCriterionIds, findCriterion } from '@accessly/contracts';
import { Page } from '../components/Page.js';
import { Badge, Callout, ScrollRegion } from '../components/primitives.js';
import { AsyncSection } from '../components/dashboard.js';
import { api, type CriterionSummary } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

/**
 * Published rule coverage.
 *
 * This page exists because the honest answer to "does your tool find
 * everything" is no, and a customer deserves to know where the gaps are before
 * they build a compliance programme on top of a number.
 *
 * The data comes from the API rather than a hardcoded list, so it cannot go
 * stale relative to what the engine actually runs.
 */
export function CoveragePage(): React.JSX.Element {
  const rules = useAsync(() => api.rules(), []);
  const data = rules.state.data;

  return (
    <Page
      title="Rule coverage"
      heading="What we test, and what we cannot"
      eyebrow="Transparency"
      lede="Every rule in the Accessly engine, mapped to the WCAG 2.1 success criteria it enforces — and an honest account of the criteria no automated tool can settle."
    >
      <div className="section section--tight">
        <div className="container">
          <AsyncSection
            status={rules.state.status}
            error={rules.state.error}
            label="the rule catalogue"
            isEmpty={false}
          >
            {data ? (
              <>
                <ul className="stats">
                  <li className="stat">
                    <span className="stat__value">{data.rules.length}</span>
                    <span className="stat__label">Rules</span>
                  </li>
                  <li className="stat">
                    <span className="stat__value band-excellent">
                      {data.coverage.criteriaCovered}
                    </span>
                    <span className="stat__label">Criteria we can decide</span>
                  </li>
                  <li className="stat">
                    <span className="stat__value band-fair">
                      {data.coverage.criteriaReviewPrompted}
                    </span>
                    <span className="stat__label">Criteria we flag for review</span>
                  </li>
                  <li className="stat">
                    <span className="stat__value">{data.coverage.criteriaUncovered}</span>
                    <span className="stat__label">Criteria we do not touch</span>
                  </li>
                </ul>

                <Callout tone="warning" title="Why we report three numbers, not one">
                  <p>
                    Most tools quote a single &ldquo;criteria covered&rdquo; figure that quietly
                    includes checks which only ever say &ldquo;a human should look at this&rdquo;.
                    We could reach 78 out of 78 tomorrow that way, and it would mean nothing.
                  </p>
                  <p className="mb-0">
                    So <strong>decided</strong> means a failure can actually be detected from your
                    markup. <strong>Flagged for review</strong> means we raise the question but
                    cannot answer it — those criteria are excluded from your score entirely rather
                    than being awarded partial credit. <strong>Not touched</strong> means exactly
                    that.
                  </p>
                </Callout>

                <CriterionGroup
                  id="cov-decided"
                  heading={`Criteria we can decide (${data.coverage.covered.length})`}
                  description="A rule exists that can detect a real failure of these from your markup. Passing our check is necessary but still not sufficient for conformance — we can tell you an image has no alt text, not that the alt text you wrote is accurate."
                  items={data.coverage.covered}
                  tone="success"
                />

                <CriterionGroup
                  id="cov-review"
                  heading={`Criteria we flag for review (${data.coverage.reviewPrompted.length})`}
                  description="We detect the situations where these apply and tell you to check, but the answer depends on running the page, on media content, or on intent. They never count towards your score."
                  items={data.coverage.reviewPrompted}
                  tone="warning"
                />

                <CriterionGroup
                  id="cov-none"
                  heading={`Criteria we do not test (${data.coverage.uncovered.length})`}
                  description="Nothing in the engine looks at these. They are mostly about media production, reading level and timing — properties of your content and your process, not of your HTML."
                  items={data.coverage.uncovered}
                  tone="neutral"
                />

                <h2 style={{ marginTop: 'var(--a-space-7)' }}>Every rule</h2>
                <ScrollRegion label="Accessly rule catalogue">
                  <table className="table">
                    <caption>
                      Every rule the engine runs, the criteria it enforces, and whether it can
                      decide the outcome or only raise it for review
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Rule</th>
                        <th scope="col">Checks</th>
                        <th scope="col">Criteria</th>
                        <th scope="col">Can decide?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.rules]
                        .sort((a, b) =>
                          compareCriterionIds(a.criteria[0] ?? '9', b.criteria[0] ?? '9'),
                        )
                        .map((rule) => (
                          <tr key={rule.id}>
                            <th scope="row" style={{ fontWeight: 400 }}>
                              <strong>{rule.title}</strong>
                              <br />
                              <code style={{ fontSize: 'var(--a-text-xs)' }}>{rule.id}</code>
                            </th>
                            <td>{rule.help}</td>
                            <td>
                              {rule.criteria.map((id) => (
                                <div key={id}>
                                  {id} ({findCriterion(id)?.level})
                                </div>
                              ))}
                            </td>
                            <td>
                              <Badge tone={rule.detection === 'automated' ? 'success' : 'warning'}>
                                {rule.detection === 'automated' ? 'Decides' : 'Flags for review'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              </>
            ) : null}
          </AsyncSection>
        </div>
      </div>
    </Page>
  );
}

function CriterionGroup({
  id,
  heading,
  description,
  items,
  tone,
}: {
  id: string;
  heading: string;
  description: string;
  items: readonly CriterionSummary[];
  tone: 'success' | 'warning' | 'neutral';
}): React.JSX.Element {
  return (
    <section aria-labelledby={id} style={{ marginTop: 'var(--a-space-7)' }}>
      <h2 id={id}>{heading}</h2>
      <p className="muted">{description}</p>

      {items.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul className="grid grid--3" style={{ listStyle: 'none', padding: 0 }}>
          {[...items]
            .sort((a, b) => compareCriterionIds(a.id, b.id))
            .map((criterion) => (
              <li key={criterion.id} className="card">
                <div className="cluster" style={{ marginBottom: 'var(--a-space-2)' }}>
                  <strong>{criterion.id}</strong>
                  <Badge tone={tone} srPrefix="Conformance level ">
                    {criterion.level}
                  </Badge>
                </div>
                <p className="mb-0">{criterion.title}</p>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
