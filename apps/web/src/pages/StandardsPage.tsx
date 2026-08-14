import { useMemo, useState } from 'react';
import {
  GUIDELINES,
  PRINCIPLES,
  SUCCESS_CRITERIA,
  type ConformanceLevel,
} from '@accessly/contracts';
import { Page } from '../components/Page.js';
import { Badge, ScrollRegion } from '../components/primitives.js';

/**
 * The WCAG 2.1 explorer.
 *
 * A searchable, filterable view of all 78 success criteria, rendered from the
 * same catalogue the rule engine validates against — so this page cannot drift
 * from what the product actually tests.
 */
export function StandardsPage(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<'all' | ConformanceLevel>('all');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return SUCCESS_CRITERIA.filter((criterion) => {
      if (level !== 'all' && criterion.level !== level) return false;
      if (needle.length === 0) return true;
      return (
        criterion.id.includes(needle) ||
        criterion.title.toLowerCase().includes(needle)
      );
    });
  }, [query, level]);

  return (
    <Page
      title="WCAG 2.1 explorer"
      heading="The WCAG 2.1 success criteria"
      eyebrow="Reference"
      lede="All 78 success criteria from the W3C Recommendation — 30 at level A, 20 at AA, and 28 at AAA. This is the same catalogue the Accessly engine validates every rule against."
    >
      <div className="section section--tight">
        <div className="container">
          <div className="grid grid--3" style={{ marginBottom: 'var(--a-space-6)' }}>
            {PRINCIPLES.map((principle) => {
              const owned = SUCCESS_CRITERIA.filter((c) => c.principle === principle.id);
              return (
                <div key={principle.id} className="card">
                  <h2 style={{ fontSize: 'var(--a-text-lg)' }}>
                    {principle.id}. {principle.title}
                  </h2>
                  <p className="muted mb-0" style={{ fontSize: 'var(--a-text-sm)' }}>
                    {GUIDELINES.filter((g) => g.principle === principle.id).length} guidelines,{' '}
                    {owned.length} success criteria
                  </p>
                </div>
              );
            })}
          </div>

          {/*
            search role plus a labelled input. The results count below is a live
            region, so filtering is announced rather than silently changing the
            page under a screen reader user.
          */}
          <search>
            <div className="grid grid--2" style={{ alignItems: 'end' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field__label" htmlFor="criterion-search">
                  Search criteria <span className="field__required">(optional)</span>
                </label>
                <input
                  id="criterion-search"
                  className="input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="contrast, 1.4.3, keyboard…"
                />
              </div>

              <fieldset className="fieldset" style={{ marginBottom: 0 }}>
                <legend>Conformance level</legend>
                <div className="radio-row">
                  {(['all', 'A', 'AA', 'AAA'] as const).map((option) => (
                    <label key={option} className="radio-option">
                      <input
                        type="radio"
                        name="level"
                        checked={level === option}
                        onChange={() => setLevel(option)}
                      />
                      {option === 'all' ? 'All' : option}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </search>

          <p role="status" aria-live="polite" style={{ marginTop: 'var(--a-space-4)' }}>
            <strong>{results.length}</strong> {results.length === 1 ? 'criterion' : 'criteria'}{' '}
            match.
          </p>

          <ScrollRegion label="WCAG 2.1 success criteria">
            <table className="table">
              <caption>WCAG 2.1 success criteria</caption>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col">Level</th>
                  <th scope="col">Guideline</th>
                  <th scope="col">New in 2.1</th>
                </tr>
              </thead>
              <tbody>
                {results.map((criterion) => (
                  <tr key={criterion.id}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <a href={criterion.url} target="_blank" rel="noreferrer noopener">
                        <strong>{criterion.id}</strong> {criterion.title}
                        <span className="visually-hidden"> (opens in a new window)</span>
                      </a>
                    </th>
                    <td>
                      <Badge
                        tone={criterion.level === 'A' ? 'danger' : criterion.level === 'AA' ? 'warning' : 'neutral'}
                        srPrefix="Conformance level "
                      >
                        {criterion.level}
                      </Badge>
                    </td>
                    <td>
                      {criterion.guideline}{' '}
                      {GUIDELINES.find((g) => g.id === criterion.guideline)?.title}
                    </td>
                    <td>{criterion.newInWcag21 ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          {results.length === 0 ? (
            <p role="status">
              No criteria match &ldquo;{query}&rdquo;. Try a criterion number such as 1.4.3, or a
              word such as &ldquo;keyboard&rdquo;.
            </p>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
