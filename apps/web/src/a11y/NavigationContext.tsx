import { createContext, useContext, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Tracks whether the user has navigated since the app mounted.
 *
 * This exists because of a subtle ordering problem. On a real page load the
 * browser announces the document and puts focus at the top by itself, so moving
 * focus again would be redundant and disorienting. On a client-side navigation
 * it does neither, so we must.
 *
 * Telling those apart with a "first render" ref *inside the page component*
 * does not work: React Router unmounts the old route and mounts a new one, so
 * every navigation looks like a first render to the page, and focus is never
 * moved at all. The flag has to live above the routes, in a component that
 * stays mounted across them.
 */
const NavigationContext = createContext<{ hasNavigated: boolean }>({ hasNavigated: false });

export function NavigationProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const location = useLocation();
  const initialKey = useRef(location.key);

  return (
    <NavigationContext.Provider value={{ hasNavigated: location.key !== initialKey.current }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useHasNavigated(): boolean {
  return useContext(NavigationContext).hasNavigated;
}
