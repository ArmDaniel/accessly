import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Error boundary around the routed pages.
 *
 * Without this, one render error white-screens the entire app — layout,
 * navigation and all. With it, the failure is contained to the page region
 * and the user gets an explanation they can act on.
 *
 * Accessibility notes, because an error boundary is exactly where a11y is
 * usually abandoned:
 *  - The fallback content is a `role="alert"` region, so a screen reader
 *    announces the failure instead of the user sitting in silence.
 *  - The heading is focusable and focused on mount, moving the user to the
 *    explanation rather than leaving them on a now-meaningless control.
 *  - Recovery is a real link and a real button, both keyboard-operable, and
 *    the page keeps its landmarks (`<main>`) so navigation still works.
 */

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in devtools; a production build would forward this to the
    // error reporting service.
    console.error('[accessly] render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="section section--tight">
        <div className="container container--narrow">
          <div role="alert">
            <div className="card">
              <h1
                tabIndex={-1}
                ref={(heading) => heading?.focus()}
                style={{ marginTop: 0 }}
              >
                This page could not be shown
              </h1>
              <p>
                Something went wrong while rendering it. The rest of the site is still working —
                your data is not affected, and nothing was lost.
              </p>
              <div className="cluster">
                <a className="btn btn--primary" href="/">
                  Back to the home page
                </a>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => window.location.reload()}
                >
                  Reload the page
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
