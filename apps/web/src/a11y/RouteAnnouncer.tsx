import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useHasNavigated } from './NavigationContext.js';

/**
 * Announce route changes to assistive technology.
 *
 * In a single-page app the browser never fires a page load, so a screen reader
 * is given no signal that the content was replaced — the user activates a link
 * and hears nothing at all. The fix has two halves and both are required:
 *
 *   1. Set `document.title`, which is what a user hears when they ask "where am
 *      I?" and what appears in browser history.
 *   2. Write the new page name into a polite live region, so the change is
 *      announced at the moment it happens.
 *
 * Focus is handled separately by `useRouteFocus` — announcing and focusing are
 * different jobs and doing both from one place makes each harder to reason
 * about.
 */
export function RouteAnnouncer({ title }: { title: string }): React.JSX.Element {
  const location = useLocation();
  const [message, setMessage] = useState('');
  // Must come from above the routes: this component is remounted by every
  // navigation, so a local "first render" ref would suppress every
  // announcement rather than just the first.
  const hasNavigated = useHasNavigated();

  useEffect(() => {
    document.title = title;

    // The initial page load is announced by the browser itself. Announcing it
    // again would make the first thing a screen reader user hears a duplicate.
    if (!hasNavigated) return;

    // Clearing first guarantees the region's content actually changes, which is
    // what triggers the announcement when two routes share a title.
    setMessage('');
    const timer = window.setTimeout(() => setMessage(`${title}. Page loaded.`), 60);
    return () => window.clearTimeout(timer);
  }, [title, location.key, hasNavigated]);

  return (
    <div
      // role="status" is polite: it waits for the screen reader to finish the
      // current sentence rather than cutting the user off mid-word.
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="visually-hidden"
    >
      {message}
    </div>
  );
}
