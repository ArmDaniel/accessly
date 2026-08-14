/**
 * Global test setup.
 *
 * Runs for every project. Only the web tests have a DOM, and importing the DOM
 * matchers under the Node environment would fail, so everything here is guarded
 * on `document` actually existing.
 */
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  const { cleanup } = await import('@testing-library/react');
  const { afterEach, vi } = await import('vitest');

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // jsdom implements none of these. Components that call them would otherwise
  // fail for reasons unrelated to what is being tested.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  window.scrollTo = (() => {}) as typeof window.scrollTo;
  window.print = (() => {}) as typeof window.print;
}

export {};
