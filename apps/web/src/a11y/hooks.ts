import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { useHasNavigated } from './NavigationContext.js';

/**
 * Move focus to the page heading after a client-side navigation.
 *
 * Without this, focus stays on the link the user just activated — which is now
 * detached from the DOM — and the next Tab press drops them back at the top of
 * the document. Focusing the new page's `h1` puts them exactly where a real
 * page load would have.
 *
 * The heading takes `tabindex="-1"` so it is programmatically focusable without
 * joining the tab sequence, and the base stylesheet suppresses the focus ring
 * for `[tabindex="-1"]` since the user did not tab there themselves.
 */
export function useRouteFocus<T extends HTMLElement>(): RefObject<T> {
  const ref = useRef<T>(null);
  const location = useLocation();
  const hasNavigated = useHasNavigated();

  useEffect(() => {
    // On the initial load the browser has already done this. Only a
    // client-side navigation needs us to step in.
    if (!hasNavigated) return;

    ref.current?.focus();
    // Scroll to the top too: focusing alone does not reset the viewport when
    // the previous page was scrolled further than this one is long.
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.key, hasNavigated]);

  return ref;
}

/**
 * Close a popup on Escape and on a click outside it, then return focus to the
 * control that opened it.
 *
 * Returning focus is the part that is usually missed. Without it, dismissing a
 * menu leaves focus on `<body>` and the keyboard user has to tab from the top
 * of the page again.
 */
export function useDismissable(
  isOpen: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    };

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };

    // Focus leaving the popup entirely (via Tab) should close it too, but must
    // not steal focus back — the user is deliberately moving on.
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [isOpen, close, containerRef, triggerRef]);
}

/** Stable, unique DOM ids for label/description wiring. */
let idCounter = 0;
export function useId(prefix: string): string {
  const ref = useRef<string>('');
  if (ref.current === '') {
    idCounter += 1;
    ref.current = `${prefix}-${idCounter}`;
  }
  return ref.current;
}
