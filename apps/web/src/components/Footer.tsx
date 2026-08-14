import { Link } from 'react-router-dom';
import { ExternalLink } from './primitives.js';

const COLUMNS = [
  {
    heading: 'Platform',
    links: [
      { to: '/platform', label: 'How it works' },
      { to: '/monitoring', label: 'Continuous monitoring' },
      { to: '/coverage', label: 'Rule coverage' },
      { to: '/scan', label: 'Scan a page' },
      { to: '/dashboard', label: 'Your dashboard' },
      { to: '/dashboard/monitoring', label: 'Monitoring dashboard' },
    ],
  },
  {
    heading: 'Standards',
    links: [
      { to: '/standards', label: 'WCAG 2.1 explorer' },
      { to: '/standards/eaa', label: 'European Accessibility Act' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { to: '/about', label: 'About Accessly' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/contact', label: 'Contact us' },
    ],
  },
] as const;

export function Footer(): React.JSX.Element {
  return (
    // A named landmark, distinct from the header's "Main" navigation.
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div>
            <h2>Accessly</h2>
            <p style={{ color: 'var(--a-on-inverse-muted)' }}>
              Accessibility auditing and continuous monitoring, measured against WCAG 2.1 and
              built to the same standard we hold you to.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              {/*
                Each footer column is its own labelled navigation landmark, so
                a screen reader user browsing landmarks sees "Platform",
                "Standards", "Company" rather than three identical entries.
              */}
              <h3>{column.heading}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="site-footer__bottom">
          <p style={{ margin: 0 }}>
            © {new Date().getFullYear()} Accessly. Built in the European Union.
          </p>
          <ul
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--a-space-4)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <li>
              {/*
                Our own accessibility statement is not decoration. If we ship a
                product that judges other people's sites, ours has to be
                auditable in public.
              */}
              <Link to="/accessibility">Accessibility statement</Link>
            </li>
            <li>
              <Link to="/contact">Report a barrier</Link>
            </li>
            <li>
              <ExternalLink href="https://www.w3.org/TR/WCAG21/">WCAG 2.1</ExternalLink>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
