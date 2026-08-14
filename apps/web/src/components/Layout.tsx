import type { ReactNode } from 'react';
import { Header } from './Header.js';
import { Footer } from './Footer.js';

export const MAIN_CONTENT_ID = 'main-content';

/**
 * The page shell.
 *
 * Order matters here and it is not arbitrary: the skip link is the first
 * element in the DOM so that one Tab from the address bar reaches it, which is
 * the entire point of WCAG 2.4.1 Bypass Blocks. Putting it after the logo — a
 * very common mistake — means the user must already have tabbed past something
 * before they can skip.
 */
export function Layout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="app-shell">
      <a className="skip-link visually-hidden-focusable" href={`#${MAIN_CONTENT_ID}`}>
        Skip to main content
      </a>

      <Header />

      {/*
        tabIndex={-1} makes <main> a valid focus target for the skip link. Without
        it, following the link moves the *scroll* position but leaves focus at the
        top of the document, so the next Tab press goes back to the navigation —
        which defeats the link entirely.
      */}
      <main id={MAIN_CONTENT_ID} className="app-main" tabIndex={-1}>
        {children}
      </main>

      <Footer />
    </div>
  );
}
