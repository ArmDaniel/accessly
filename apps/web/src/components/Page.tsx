import type { ReactNode } from 'react';
import { RouteAnnouncer } from '../a11y/RouteAnnouncer.js';
import { useRouteFocus } from '../a11y/hooks.js';

/**
 * Every route renders through this.
 *
 * It guarantees the three things a client-side navigation has to do by hand,
 * because the browser will not do them for you:
 *   1. update the document title,
 *   2. announce the new page in a live region,
 *   3. move focus to the new page's heading.
 *
 * `title` is the full document title; `heading` is the visible `h1`. They are
 * usually related but not identical — the title carries the site name, the
 * heading does not repeat it.
 */
export function Page({
  title,
  heading,
  lede,
  children,
  eyebrow,
  headless = false,
}: {
  title: string;
  heading: string;
  lede?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  /** Set when the page renders its own hero and heading (the home page). */
  headless?: boolean;
}): React.JSX.Element {
  const headingRef = useRouteFocus<HTMLHeadingElement>();

  return (
    <>
      <RouteAnnouncer title={`${title} — Accessly`} />

      {headless ? null : (
        <div className="section section--tight">
          <div className="container">
            {eyebrow ? (
              <p className="hero__eyebrow" style={{ marginBottom: 'var(--a-space-4)' }}>
                {eyebrow}
              </p>
            ) : null}
            <h1 ref={headingRef} tabIndex={-1}>
              {heading}
            </h1>
            {lede ? <p className="lede">{lede}</p> : null}
          </div>
        </div>
      )}

      {children}
    </>
  );
}
