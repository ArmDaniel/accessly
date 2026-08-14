import { Link } from 'react-router-dom';
import { Page } from '../components/Page.js';
import { Callout, Disclosure, ExternalLink, Icon, icons } from '../components/primitives.js';

/**
 * Editorial pages.
 *
 * Grouped in one module because they are all prose with no behaviour — keeping
 * them together makes the copy easy to review as a whole, which matters more
 * here than file-per-route symmetry.
 */

export function EaaPage(): React.JSX.Element {
  return (
    <Page
      title="European Accessibility Act"
      heading="The European Accessibility Act"
      eyebrow="Standards"
      lede="Directive (EU) 2019/882 applies to products and services placed on the EU market from 28 June 2025. If you sell to consumers in the EU, it probably applies to you."
    >
      <div className="section section--tight">
        <div className="container container--narrow flow">
          <h2>Who it covers</h2>
          <p>
            E-commerce, consumer banking, e-books, transport services, telecoms, and access to
            audiovisual media services. Microenterprises — fewer than ten staff and under €2m
            turnover — are exempt for services, but not for products.
          </p>

          <h2>What conformance means in practice</h2>
          <p>
            The Directive does not name WCAG directly. It sets functional requirements, and the
            harmonised European standard <strong>EN 301 549</strong> is what translates those into
            testable criteria. EN 301 549 incorporates WCAG 2.1 level AA for web content. In
            practice, that is the bar.
          </p>

          <Callout tone="info" title="Level AA, not AAA">
            <p className="mb-0">
              AAA is not the target and was never intended to be applied wholesale — the W3C says
              so explicitly. Testing against AAA is useful for finding where you could do better.
              It is not what you are measured on.
            </p>
          </Callout>

          <h2>What you will be asked for</h2>
          <ul>
            <li>An accessibility statement, kept current.</li>
            <li>Evidence of evaluation against EN 301 549 — not a vendor badge.</li>
            <li>A route for users to report barriers, and a record of what you did about them.</li>
            <li>Ongoing monitoring, because a one-off audit expires the moment you deploy.</li>
          </ul>

          <p>
            Accessly is built around the last two. See{' '}
            <Link to="/monitoring">how continuous monitoring works</Link>.
          </p>

          <h2>Read the sources yourself</h2>
          <ul>
            <li>
              <ExternalLink href="https://eur-lex.europa.eu/eli/dir/2019/882/oj">
                Directive (EU) 2019/882 on EUR-Lex
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href="https://www.w3.org/TR/WCAG21/">
                WCAG 2.1, W3C Recommendation
              </ExternalLink>
            </li>
          </ul>

          <Callout tone="warning" title="This is not legal advice">
            <p className="mb-0">
              We build testing tools, not legal opinions. Talk to counsel about how the Directive
              applies to your specific business.
            </p>
          </Callout>
        </div>
      </div>
    </Page>
  );
}

export function PricingPage(): React.JSX.Element {
  const plans = [
    {
      name: 'Free',
      price: '€0',
      cadence: 'forever',
      summary: 'Scan any page, as often as you like. Full report, no account.',
      features: ['Unlimited manual scans', 'Complete findings and remediation guidance', 'Printable report', 'WCAG 2.1 A, AA and AAA'],
      cta: { to: '/scan', label: 'Scan a page' },
      featured: false,
    },
    {
      name: 'Team',
      price: '€149',
      cadence: 'per month',
      summary: 'Continuous monitoring for the pages that matter, with regression alerts.',
      features: ['Up to 50 monitored pages', 'Hourly, daily or weekly checks', 'Regression diffs per deploy', 'API access for CI', 'Full event history'],
      cta: { to: '/contact', label: 'Talk to us about Team' },
      featured: true,
    },
    {
      name: 'Enterprise',
      price: 'Bespoke',
      cadence: '',
      summary: 'For organisations with a formal accessibility programme and auditors to satisfy.',
      features: ['Unlimited pages and users', 'Manual audit by our reviewers', 'EN 301 549 evidence packs', 'SSO and data residency in the EU', 'Named accessibility specialist'],
      cta: { to: '/contact', label: 'Talk to us about Enterprise' },
      featured: false,
    },
  ] as const;

  return (
    <Page
      title="Pricing"
      heading="Pricing"
      eyebrow="Plans"
      lede="Scanning is free and always will be. You pay when you want us to keep watching."
    >
      <div className="section section--tight">
        <div className="container">
          <ul className="grid grid--3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {plans.map((plan) => (
              <li
                key={plan.name}
                className="card"
                style={
                  plan.featured
                    ? { borderColor: 'var(--a-brand)', borderWidth: 2, boxShadow: 'var(--a-shadow)' }
                    : undefined
                }
              >
                <div className="cluster" style={{ marginBottom: 'var(--a-space-2)' }}>
                  <h2 style={{ fontSize: 'var(--a-text-xl)', margin: 0 }}>{plan.name}</h2>
                  {/*
                    "Most popular" is spelled out rather than shown as a coloured
                    border alone — the border is the redundant cue, not the
                    primary one.
                  */}
                  {plan.featured ? <span className="badge badge--info">Most popular</span> : null}
                </div>

                <p style={{ marginBottom: 'var(--a-space-2)' }}>
                  <span style={{ fontSize: 'var(--a-text-2xl)', fontWeight: 700 }}>{plan.price}</span>{' '}
                  {plan.cadence ? <span className="muted">{plan.cadence}</span> : null}
                </p>

                <p>{plan.summary}</p>

                <ul style={{ paddingInlineStart: '1.1em' }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                <Link
                  to={plan.cta.to}
                  className={plan.featured ? 'btn btn--primary' : 'btn btn--secondary'}
                >
                  {plan.cta.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Page>
  );
}

export function AboutPage(): React.JSX.Element {
  return (
    <Page
      title="About"
      heading="About Accessly"
      eyebrow="Company"
      lede="We build accessibility tooling in the European Union, for organisations that have to prove their work rather than assert it."
    >
      <div className="section section--tight">
        <div className="container container--narrow flow">
          <h2>Why another accessibility tool</h2>
          <p>
            Because most of them optimise for a reassuring number. A score that goes up when you
            fix nothing is worse than no score, and a report that quietly counts untestable
            criteria as passes is not a report — it is a marketing document with a table in it.
          </p>
          <p>
            Accessly reports what it found, what it could not decide, and what it never looked at.
            That makes our numbers lower than our competitors&rsquo;. We think that is the point.
          </p>

          <h2>How we hold ourselves to it</h2>
          <p>
            This site is audited by the engine that powers the product, on every commit. The test
            suite fails the build if any page introduces a WCAG 2.1 level A or AA failure. Our{' '}
            <Link to="/accessibility">accessibility statement</Link> lists the exceptions we know
            about, and we would rather hear about the ones we have missed.
          </p>

          <Callout tone="info" title="Found a barrier on this site?">
            <p className="mb-0">
              Tell us at <a href="mailto:accessibility@accessly.eu">accessibility@accessly.eu</a>.
              We aim to reply within five working days, and we publish what we fixed.
            </p>
          </Callout>
        </div>
      </div>
    </Page>
  );
}

export function ContactPage(): React.JSX.Element {
  return (
    <Page
      title="Contact"
      heading="Contact us"
      eyebrow="Company"
      lede="Questions about the platform, a plan, or an accessibility barrier on this site."
    >
      <div className="section section--tight">
        <div className="container container--narrow flow">
          <h2>Email</h2>
          <dl>
            <dt>
              <strong>Sales and plans</strong>
            </dt>
            <dd>
              <a href="mailto:hello@accessly.eu">hello@accessly.eu</a>
            </dd>
            <dt>
              <strong>Accessibility of this site</strong>
            </dt>
            <dd>
              <a href="mailto:accessibility@accessly.eu">accessibility@accessly.eu</a> — we reply
              within five working days.
            </dd>
            <dt>
              <strong>Security</strong>
            </dt>
            <dd>
              <a href="mailto:security@accessly.eu">security@accessly.eu</a>
            </dd>
          </dl>

          <h2>Reporting a barrier</h2>
          <p>
            If something on this site stopped you from doing what you came to do, we want the
            details — what you were trying to do, what happened, and what you were using. You do
            not need to know the WCAG criterion. That is our job.
          </p>

          <Disclosure summary="What happens after you report something">
            <ol style={{ paddingInlineStart: '1.2em' }}>
              <li>We acknowledge within five working days.</li>
              <li>We reproduce it and tell you what we found, including if we disagree.</li>
              <li>We fix it, or give you a date and a workaround.</li>
              <li>It goes into our accessibility statement either way.</li>
            </ol>
          </Disclosure>
        </div>
      </div>
    </Page>
  );
}

export function NotFoundPage(): React.JSX.Element {
  return (
    <Page
      title="Page not found"
      heading="We could not find that page"
      lede="The address may be mistyped, or the page may have moved."
    >
      <div className="section section--tight">
        <div className="container container--narrow">
          <p>Here are the places people usually want:</p>
          <ul>
            <li>
              <Link to="/scan">Scan a page for accessibility issues</Link>
            </li>
            <li>
              <Link to="/standards">The WCAG 2.1 explorer</Link>
            </li>
            <li>
              <Link to="/coverage">What Accessly can and cannot test</Link>
            </li>
            <li>
              <Link to="/contact">Contact us</Link>
            </li>
          </ul>
          <Link to="/" className="btn btn--secondary">
            <Icon path={icons.arrowRight} size={18} />
            Back to the home page
          </Link>
        </div>
      </div>
    </Page>
  );
}
