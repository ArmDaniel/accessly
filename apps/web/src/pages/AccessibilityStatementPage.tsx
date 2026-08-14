import { Link } from 'react-router-dom';
import { Page } from '../components/Page.js';
import { Callout, ExternalLink, ScrollRegion } from '../components/primitives.js';

/**
 * Our own accessibility statement.
 *
 * Modelled on the structure the EU requires of public-sector bodies under
 * Directive (EU) 2016/2102: conformance status, known exceptions, feedback
 * route, and enforcement. A vendor that audits other people's sites and does
 * not publish this is asking for trust it has not earned.
 */
const KNOWN_ISSUES = [
  {
    area: 'Rule coverage table',
    issue:
      'The rule catalogue table scrolls horizontally on narrow viewports. It is keyboard-scrollable and labelled, but a table remains a poor pattern at 320px.',
    criteria: '1.4.10 Reflow',
    status: 'Planned — a stacked card view for narrow viewports.',
  },
  {
    area: 'Report snippets',
    issue:
      'Markup snippets in a report are shown in a monospace block that can exceed the viewport width and scrolls horizontally.',
    criteria: '1.4.10 Reflow',
    status: 'Accepted. Wrapping code changes its meaning; the region is keyboard-scrollable and labelled.',
  },
  {
    area: 'Third-party webfont',
    issue:
      'Atkinson Hyperlegible is loaded from Google Fonts. If that request is blocked the page falls back to a system stack, which is a different but still legible typeface.',
    criteria: 'None — degradation is graceful.',
    status: 'Planned — self-hosting the font to remove the third-party dependency.',
  },
] as const;

export function AccessibilityStatementPage(): React.JSX.Element {
  return (
    <Page
      title="Accessibility statement"
      heading="Accessibility statement for Accessly"
      eyebrow="Last reviewed 13 August 2026"
      lede="This statement covers accessly.eu, including the scanner and the reports it produces."
    >
      <div className="section section--tight">
        <div className="container container--narrow flow">
          <h2>Conformance status</h2>
          <p>
            We assess this site as <strong>partially conformant</strong> with WCAG 2.1 level AA.
            &ldquo;Partially conformant&rdquo; means most of the site meets the standard, and the
            places it does not are listed below.
          </p>

          <Callout tone="info" title="Why we do not claim full conformance">
            <p className="mb-0">
              A full conformance claim requires that every applicable success criterion is met on
              every page, verified by a person. We run automated checks on every commit and review
              manually before each release, but we have not commissioned an independent audit yet.
              Until we have, claiming full conformance would be exactly the kind of overstatement
              this product exists to argue against.
            </p>
          </Callout>

          <h2>How we test</h2>
          <ul>
            <li>
              Automated checks with the Accessly engine on every commit. The build fails if any
              page introduces a level A or AA failure.
            </li>
            <li>Keyboard-only walkthrough of every interactive flow before each release.</li>
            <li>Screen reader testing with NVDA on Firefox and VoiceOver on Safari.</li>
            <li>Verification at 200% and 400% zoom, and in Windows High Contrast mode.</li>
          </ul>

          <h2>Known issues</h2>
          <ScrollRegion label="Known accessibility issues">
            <table className="table">
              <caption>Accessibility issues we know about</caption>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Criterion</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {KNOWN_ISSUES.map((item) => (
                  <tr key={item.area}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      {item.area}
                    </th>
                    <td>{item.issue}</td>
                    <td>{item.criteria}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <h2>Feedback</h2>
          <p>
            If you find a barrier we have not listed, tell us at{' '}
            <a href="mailto:accessibility@accessly.eu">accessibility@accessly.eu</a>. We
            acknowledge within five working days and tell you what we intend to do, including if
            we disagree. See <Link to="/contact">our contact page</Link> for what happens next.
          </p>

          <h2>Enforcement</h2>
          <p>
            If you are not satisfied with our response, you can escalate to the national
            enforcement body in your EU member state under Directive (EU) 2019/882.
          </p>

          <h2>Technical specification</h2>
          <p>
            Accessibility of this site relies on HTML, WAI-ARIA, CSS and JavaScript. It is tested
            against{' '}
            <ExternalLink href="https://www.w3.org/TR/WCAG21/">WCAG 2.1 level AA</ExternalLink> and{' '}
            <ExternalLink href="https://www.etsi.org/deliver/etsi_en/301500_301599/301549/">
              EN 301 549
            </ExternalLink>
            .
          </p>
        </div>
      </div>
    </Page>
  );
}
