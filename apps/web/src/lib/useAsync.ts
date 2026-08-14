import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.js';

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string };

/**
 * Load data once, with a state machine the UI can announce.
 *
 * Three explicit states rather than a bare `data | null`, because "still
 * loading" and "loaded, and there is nothing" need completely different things
 * said about them. Collapsing them is how a dashboard ends up announcing "no
 * sites" to a screen reader while the request is still in flight.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[] = []): {
  state: AsyncState<T>;
  reload: () => void;
} {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });

    loadRef
      .current()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ApiError
            ? [error.problem.title, error.detail].filter(Boolean).join(' ')
            : 'Something went wrong loading this data.';
        setState({ status: 'error', data: null, error: message });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { state, reload };
}

/**
 * Run a one-off action (delete, pause, check now) and expose a message for a
 * live region.
 *
 * The message is the point. A button that silently does something is invisible
 * to a screen reader user — they press it and nothing is announced, so they
 * cannot tell whether it worked.
 */
export function useAction(): {
  isBusy: boolean;
  message: string;
  error: string;
  run: (action: () => Promise<string>) => Promise<void>;
  clear: () => void;
} {
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = useCallback(async (action: () => Promise<string>) => {
    setIsBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      setMessage(result);
    } catch (caught: unknown) {
      setError(
        caught instanceof ApiError
          ? [caught.problem.title, caught.detail].filter(Boolean).join(' ')
          : 'That action could not be completed.',
      );
    } finally {
      setIsBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setMessage('');
    setError('');
  }, []);

  return { isBusy, message, error, run, clear };
}
