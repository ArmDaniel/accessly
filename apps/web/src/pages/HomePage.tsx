import { Link } from 'react-router-dom';
import { RouteAnnouncer } from '../a11y/RouteAnnouncer.js';
import { useRouteFocus } from '../a11y/hooks.js';
import { Callout, Icon, icons } from '../components/primitives.js';

const PILLARS = [
  {
    icon: icons.eye,
    title: 'Audit',
    body: 'Every page is checked against the WCAG 2.1 success criteria automation can reach. Each finding cites the criterion it fails, quotes the element, and tells you how to fix it.',
    to: '/platform',
    linkLabel: 'How auditing works',
  },
  {
    icon: icons.radar,
    title: 'Watch',
    body: 'We re-check your pages on a schedule and hash the content, so an audit is only spent when something actually changed. When a deploy breaks something, you hear about that deploy.',
    to: '/monitoring',
    linkLabel: 'How monitoring works',
  },
  {
    icon: icons.document,
    title: 'Prove',
    body: 'A printable report that names what was tested, what passed, what failed, and — the part other tools leave out — exactly which criteria a machine cannot judge at all.',
    to: '/coverage',
    linkLabel: 'See our rule coverage',
  },
] as const;

export function HomePage(): React.JSX.Element {
  const headingRef = useRouteFocus<HTMLHeadingElement>();

  return (
    <>
      <RouteAnnouncer title="Accessly — prove your website is accessible" />

      <section className="hero" aria-labelledby="hero-heading">
        <div className="container hero__inner">
          <div>
            <p className="hero__eyebrow">
              <Icon path={icons.shield} size={16} />
              Built for the European Accessibility Act
            </p>

            <h1 id="hero-heading" ref={headingRef} tabIndex={-1}>
              Accessibility you can actually prove
            </h1>

            <p className="hero__lede">
              Accessly audits your website against WCAG 2.1, scores it in a way you can defend,
              and watches it for regressions every time you ship. No plugin, no overlay, no
              pretending a machine can do the whole job.
            </p>

            <div className="hero__actions">
              <Link to="/scan" className="btn btn--primary">
                Scan a page free
                <Icon path={icons.arrowRight} size={18} />
              </Link>
              <Link to="/platform" className="btn btn--secondary">
                See how it works
              </Link>
            </div>

            <p className="muted" style={{ marginTop: 'var(--a-space-5)', fontSize: 'var(--a-text-sm)' }}>
              No account. No card. The scan runs and the report is yours.
            </p>
          </div>

          <div className="hero__media">
            {/*
              A summary panel rendered as real text rather than a screenshot.
              A screenshot of a dashboard would need alt text describing every
              number in it, and would be unreadable at 200% zoom — 1.4.5.
            */}
            <div className="card" aria-labelledby="sample-report-heading">
              <h2 id="sample-report-heading" style={{ fontSize: 'var(--a-text-lg)' }}>
                Sample result
              </h2>
              <p className="muted" style={{ fontSize: 'var(--a-text-sm)' }}>
                shop.example.eu/checkout — WCAG 2.1 level AA
              </p>

              <dl style={{ display: 'grid', gap: 'var(--a-space-3)', margin: 0 }}>
                {[
                  ['Score', '68 / 100 — Poor'],
                  ['Criteria failed', '7 of 50 tested'],
                  ['Critical issues', '3'],
                  ['Needs human review', '11 criteria'],
                ].map(([term, value]) => (
                  <div
                    key={term}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--a-space-4)' }}
                  >
                    <dt className="muted">{term}</dt>
                    <dd style={{ margin: 0, fontWeight: 700 }}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="pillars-heading">
        <div className="container">
          <div className="section-head">
            <h2 id="pillars-heading">Find it, fix it, keep it fixed</h2>
            <p>
              Most accessibility work fails at the third step. A team remediates, ships, and six
              months later the same defects are back because nothing was watching.
            </p>
          </div>

          <ul className="grid grid--3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="card card--interactive">
                <span className="card__icon">
                  <Icon path={pillar.icon} size={22} />
                </span>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
                {/*
                  Link text names its destination. "Learn more" repeated three
                  times is useless to anyone navigating by link list — 2.4.4.
                */}
                <Link to={pillar.to}>{pillar.linkLabel}</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section--sunken" aria-labelledby="honesty-heading">
        <div className="container">
          <div className="section-head">
            <h2 id="honesty-heading">What we will not tell you</h2>
            <p>
              Every accessibility vendor has a number on their homepage. Here is ours, and here is
              what it does not mean.
            </p>
          </div>

          <div className="grid grid--2">
            <Callout tone="warning" title="No tool finds every issue">
              <p className="mb-0">
                Automated testing reliably catches roughly a third of WCAG failures — missing
                names, broken relationships, invalid ARIA, declared contrast. It cannot judge
                whether your alt text is accurate, whether your focus order makes sense, or
                whether your error messages actually help. Accessly names every criterion it
                cannot test, in every report.
              </p>
            </Callout>

            <Callout tone="danger" title="Overlays do not make you compliant">
              <p className="mb-0">
                Widgets that promise one-line compliance do not fix the underlying markup, and
                courts across the EU and US have said so. Accessly changes nothing on your site.
                It tells you what is wrong so your developers can fix it properly.
              </p>
            </Callout>
          </div>
        </div>
      </section>

      <section className="section section--inverse" aria-labelledby="cta-heading">
        <div className="container text-center">
          <h2 id="cta-heading">Start with one page</h2>
          <p className="lede" style={{ color: 'var(--a-on-inverse-muted)', marginInline: 'auto' }}>
            Scan your most important page and see what comes back. It takes about ten seconds and
            you keep the report either way.
          </p>
          <Link to="/scan" className="btn btn--primary" // Amber on ink, fixed in both themes: 9.1:1 either way.
            style={{ background: '#f0b429', borderColor: '#f0b429', color: '#0b1f24' }}>
            Scan a page free
            <Icon path={icons.arrowRight} size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}
