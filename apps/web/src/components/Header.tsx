import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useDismissable, useId } from '../a11y/hooks.js';
import { Icon, icons } from './primitives.js';

interface NavChild {
  readonly to: string;
  readonly label: string;
  readonly description: string;
}

interface NavItem {
  readonly label: string;
  readonly to?: string;
  readonly children?: readonly NavChild[];
}

const NAV: readonly NavItem[] = [
  {
    label: 'Platform',
    children: [
      {
        to: '/platform',
        label: 'How Accessly works',
        description: 'Audit, score, remediate, and prove it stayed fixed.',
      },
      {
        to: '/monitoring',
        label: 'Continuous monitoring',
        description: 'We re-check every page you ship and flag regressions.',
      },
      {
        to: '/coverage',
        label: 'Rule coverage',
        description: 'Exactly which WCAG criteria we test, and which need a human.',
      },
    ],
  },
  {
    label: 'Standards',
    children: [
      {
        to: '/standards',
        label: 'WCAG 2.1 explorer',
        description: 'All 78 success criteria, in plain language.',
      },
      {
        to: '/standards/eaa',
        label: 'European Accessibility Act',
        description: 'What the June 2025 deadline means for your organisation.',
      },
    ],
  },
  { label: 'Pricing', to: '/pricing' },
  { label: 'About', to: '/about' },
  { label: 'Dashboard', to: '/dashboard' },
];

/**
 * A navigation dropdown.
 *
 * This is a *disclosure* pattern, not an ARIA menu. `role="menu"` carries a
 * contract — arrow-key roving focus, Home/End, type-ahead, no tabbing between
 * items — that site navigation almost never implements, and half-implementing
 * it is worse than not claiming it. A button with `aria-expanded` controlling a
 * list of links behaves exactly as users expect and is correct as written.
 */
function NavDisclosure({ item }: { item: NavItem & { children: readonly NavChild[] } }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId('nav-panel');
  const location = useLocation();

  const close = useCallback(() => setIsOpen(false), []);
  useDismissable(isOpen, close, panelRef, triggerRef);

  // Close whenever the route changes. The link's own onClick covers a click,
  // but not the browser back and forward buttons, which navigate without any
  // click happening in this panel at all.
  useEffect(() => {
    setIsOpen(false);
  }, [location.key]);

  return (
    <li className="primary-nav__item">
      <button
        type="button"
        ref={triggerRef}
        className="primary-nav__trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        {item.label}
        <span className="primary-nav__chevron">
          <Icon path={icons.chevronDown} size={16} />
        </span>
      </button>

      <div
        id={panelId}
        ref={panelRef}
        className="primary-nav__panel"
        hidden={!isOpen}
        // Naming the panel after its trigger means a screen reader user who
        // lands inside it is told which menu they are in.
        aria-label={`${item.label} pages`}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {item.children.map((child) => (
            <li key={child.to}>
              <Link to={child.to} onClick={close}>
                <strong>{child.label}</strong>
                <span className="desc">{child.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function Header(): React.JSX.Element {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const location = useLocation();
  const navId = useId('primary-nav');
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  const closeMobile = useCallback(() => setIsMobileOpen(false), []);

  /*
   * Close the drawer whenever the route changes, or it stays open on top of the
   * page the user just navigated to.
   *
   * This has to be an effect. Doing it during render — comparing the location
   * key against a ref and calling setState inline — looks equivalent but is
   * not: React invokes the render function twice in development, the first
   * pass mutates the ref, and by the second pass the comparison no longer
   * detects a change, so the drawer never closes.
   */
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.key]);

  // Escape and outside clicks dismiss it too, and focus returns to the toggle.
  useDismissable(isMobileOpen, closeMobile, navRef, toggleRef);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Icon path={icons.check} size={18} />
          </span>
          {/* The wordmark is real text, not an image — 1.4.5 Images of Text. */}
          Accessly
        </Link>

        <button
          type="button"
          ref={toggleRef}
          className="btn btn--ghost nav-toggle"
          aria-expanded={isMobileOpen}
          aria-controls={navId}
          onClick={() => setIsMobileOpen((open) => !open)}
        >
          <Icon path={icons.keyboard} size={18} />
          Menu
        </button>

        {/*
          Named landmark: this page has a second navigation in the footer, and
          two unlabelled "navigation" entries in a landmarks list are useless.
        */}
        <nav
          id={navId}
          ref={navRef}
          className="primary-nav"
          aria-label="Main"
          data-open={isMobileOpen ? 'true' : 'false'}
        >
          <ul className="primary-nav__list">
            {NAV.map((item) =>
              item.children ? (
                <NavDisclosure key={item.label} item={item as NavItem & { children: readonly NavChild[] }} />
              ) : (
                <li key={item.label} className="primary-nav__item">
                  <NavLink
                    to={item.to as string}
                    className="primary-nav__link"
                    // NavLink sets aria-current="page" on the active route,
                    // which is what tells a screen reader "you are here". The
                    // underline in the stylesheet is the matching non-colour
                    // cue for sighted users (1.4.1).
                  >
                    {item.label}
                  </NavLink>
                </li>
              ),
            )}
          </ul>
        </nav>

        <div className="header-actions">
          <Link to="/scan" className="btn btn--primary">
            Scan a page
          </Link>
        </div>
      </div>
    </header>
  );
}
