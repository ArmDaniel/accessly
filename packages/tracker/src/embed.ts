import { Tracker, type TrackerOptions } from './index.js';

/**
 * The `<script>` tag entry point.
 *
 * `index.ts` is a library: you construct a Tracker, you start it, you flush it.
 * This is the other half — the thing a customer actually installs, which has to
 * configure itself from the page and decide on its own when the session is
 * over. Keeping the two apart means the library stays testable without a page
 * lifecycle, and the lifecycle stays reviewable without the recording logic.
 *
 * Installation is one tag:
 *
 * ```html
 * <script src="https://cdn.accessly.eu/accessly-tracker.js"
 *         data-endpoint="https://api.accessly.eu/v1/traces"
 *         data-organisation="00000000-0000-4000-8000-000000000001"
 *         data-journey="7f3c…"
 *         defer></script>
 * ```
 *
 * `data-endpoint` is the only required attribute. Without it the tracker still
 * records — so `window.Accessly.current.build()` works in a console — but sends
 * nothing, which is the right behaviour for someone trying it out.
 */

/** How many messages one session may record. See `flush` for why this number. */
const EMBED_MAX_MESSAGES = 1000;

export interface EmbedConfig {
  readonly endpoint: string | null;
  readonly organisationId: string | null;
  readonly journeyId: string | null;
  readonly maxMessages: number;
  /** Set `data-autostart="false"` to record only when you call `start()`. */
  readonly autoStart: boolean;
}

/**
 * Read configuration off the script element.
 *
 * Data attributes rather than a global config object: the tag is the whole
 * installation, and a config object has to be defined *before* the script runs,
 * which is exactly the ordering mistake that makes analytics snippets fragile.
 */
export function readConfig(script: Element | null): EmbedConfig {
  const attribute = (name: string): string | null => {
    const value = script?.getAttribute(`data-${name}`);
    return value !== null && value !== undefined && value.trim().length > 0
      ? value.trim()
      : null;
  };

  const declaredMax = Number.parseInt(attribute('max-messages') ?? '', 10);

  return {
    endpoint: attribute('endpoint'),
    organisationId: attribute('organisation'),
    journeyId: attribute('journey'),
    // A hostile or fat-fingered value must not be able to raise the ceiling:
    // the cap exists to keep the trace inside the browser's keepalive budget.
    maxMessages:
      Number.isFinite(declaredMax) && declaredMax > 0
        ? Math.min(declaredMax, EMBED_MAX_MESSAGES)
        : EMBED_MAX_MESSAGES,
    autoStart: attribute('autostart') !== 'false',
  };
}

/** The tag that loaded us, so configuration travels with the installation. */
function locateScript(document: Document): Element | null {
  if (document.currentScript) return document.currentScript;
  // `currentScript` is null inside a module or when the script was injected, so
  // fall back to whichever tag names us.
  return document.querySelector('script[data-accessly], script[data-endpoint]');
}

export interface EmbedHandle {
  readonly tracker: Tracker;
  readonly config: EmbedConfig;
  /** Deliver now. Safe to call repeatedly; only the first send goes out. */
  flush: () => Promise<void>;
  /** Stop recording and detach every listener, including the lifecycle ones. */
  stop: () => void;
}

/**
 * Start recording and arrange for the trace to be delivered.
 *
 * The delivery moment is the interesting part. `unload` and `beforeunload` are
 * unreliable — they never fire on mobile when the user switches apps, which is
 * most sessions — so the signal we use is `visibilitychange` to hidden, with
 * `pagehide` as the desktop backstop. Both can fire in one session, so delivery
 * is guarded: whichever arrives first sends, the rest are no-ops.
 */
export function install(
  target: Document = document,
  overrides: Partial<TrackerOptions> = {},
): EmbedHandle {
  const config = readConfig(locateScript(target));

  const tracker = new Tracker({
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    organisationId: config.organisationId,
    journeyId: config.journeyId,
    maxMessages: config.maxMessages,
    ...overrides,
  });

  let sent = false;
  const disposers: Array<() => void> = [];

  const flush = async (): Promise<void> => {
    if (sent) return;
    sent = true;
    await tracker.flush();
  };

  const view = target.defaultView;
  if (view) {
    const onHidden = (): void => {
      if (target.visibilityState === 'hidden') void flush();
    };
    const onPageHide = (): void => void flush();

    target.addEventListener('visibilitychange', onHidden);
    view.addEventListener('pagehide', onPageHide);
    disposers.push(() => target.removeEventListener('visibilitychange', onHidden));
    disposers.push(() => view.removeEventListener('pagehide', onPageHide));
  }

  if (config.autoStart) tracker.start(target);

  return {
    tracker,
    config,
    flush,
    stop: () => {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      tracker.stop();
    },
  };
}
