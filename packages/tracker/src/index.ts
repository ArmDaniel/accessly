import {
  TRACE_PROTOCOL_VERSION,
  TraceMessageType,
  type FocusCause,
  type JourneyTrace,
  type TraceMessage,
} from '@accessly/contracts';

/**
 * The Accessly tracker.
 *
 * Embedded by a customer, it records what a user *experienced* rather than what
 * their screen looked like. Structurally it follows OpenReplay's tracker — a
 * mirror assigning numeric ids to nodes, a flat append-only message buffer,
 * batched delivery — because that design is proven for keeping recording cheap
 * on the page being recorded.
 *
 * The differences are deliberate and all point the same way:
 *
 *  - **No pixels.** We do not serialise the DOM, so there is no snapshot to
 *    rebuild and no stylesheet to capture. A trace is a few kilobytes.
 *  - **No values.** Input contents are never recorded. A session replay of a
 *    checkout is a data-protection liability; a transcript of focus and
 *    announcements is not, and it is what we actually need.
 *  - **Announcements are computed.** A screen reader is the only thing that
 *    truly knows what was announced, so we do the same job it does: watch live
 *    regions for mutations and record the text they would have spoken.
 *
 * It is written against the DOM only — no framework, no build step required —
 * so it can be dropped into any page, and it runs in jsdom, which is how it
 * gets real test coverage without a browser.
 */

export interface TrackerOptions {
  /** Where to POST the trace. */
  readonly endpoint?: string;
  readonly journeyId?: string | null;
  readonly organisationId?: string | null;
  /** Stop recording after this many messages, to bound memory. */
  readonly maxMessages?: number;
  /** Injected for tests. */
  readonly now?: () => number;
  /** Injected for tests; defaults to `fetch`. */
  readonly send?: (trace: JourneyTrace) => Promise<void>;
  readonly generateId?: () => string;
}

const DEFAULT_MAX_MESSAGES = 5000;

/**
 * What the mutation observers watch.
 *
 * `documentElement`, not `body` — the tracker is documented as something you
 * drop into a `<script>` tag, and the earliest useful place for that is
 * `<head>`, where `body` does not exist yet. Observing `body` there attached
 * nothing at all and silently produced a session with no announcements and no
 * dialogs, which then reads as a site that never announces anything. The
 * documentElement exists as soon as parsing starts and a subtree observer on it
 * sees the body arrive.
 */
function observationRoot(target: Document): Element | null {
  return target.documentElement ?? target.body ?? null;
}

function roleOf(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit.trim().toLowerCase().split(/\s+/)[0] ?? 'generic';

  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : 'generic';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'dialog') return 'dialog';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'search') return 'searchbox';
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    return 'textbox';
  }
  return 'generic';
}

/**
 * Accessible name, computed the cheap way.
 *
 * A full accname implementation belongs on the server, where we already have
 * one. On the page being recorded, cost matters more than completeness: this
 * covers aria-label, aria-labelledby, a wrapping or associated label, alt text
 * and text content, which is what names real controls in practice.
 */
function nameOf(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument?.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }

  const id = element.getAttribute('id');
  if (id) {
    const label = element.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  const wrapping = element.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

  const alt = element.getAttribute('alt');
  if (alt !== null) return alt.trim();

  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export class Tracker {
  readonly #messages: TraceMessage[] = [];
  readonly #ids = new WeakMap<Element, number>();
  readonly #options: Required<Pick<TrackerOptions, 'maxMessages'>> & TrackerOptions;

  #nextId = 1;
  #startedAt = 0;
  #recording = false;
  #observer: MutationObserver | null = null;
  #liveObserver: MutationObserver | null = null;
  #currentStep: string | null = null;
  /** Elements whose focus loss we are watching for, to classify the cause. */
  #lastInteraction: FocusCause = 'script';
  /** True between losing focus and regaining it, so one loss is recorded once. */
  #focusIsLost = false;
  #cleanup: Array<() => void> = [];

  constructor(options: TrackerOptions = {}) {
    this.#options = { maxMessages: options.maxMessages ?? DEFAULT_MAX_MESSAGES, ...options };
  }

  get messages(): readonly TraceMessage[] {
    return this.#messages;
  }

  get isRecording(): boolean {
    return this.#recording;
  }

  #now(): number {
    return this.#options.now ? this.#options.now() : Date.now();
  }

  #offset(): number {
    return this.#now() - this.#startedAt;
  }

  #push(message: Omit<TraceMessage, 'o'>): void {
    if (!this.#recording) return;
    if (this.#messages.length >= this.#options.maxMessages) return;
    this.#messages.push({ ...message, o: this.#offset() } as TraceMessage);
  }

  /** Assign (or recall) this element's mirror id, telling the server about it once. */
  #identify(element: Element): number {
    const existing = this.#ids.get(element);
    if (existing !== undefined) return existing;

    const id = this.#nextId;
    this.#nextId += 1;
    this.#ids.set(element, id);

    const parent = element.parentElement;
    this.#push({
      t: TraceMessageType.NodeAdded,
      id,
      ...(parent && this.#ids.has(parent) ? { p: this.#ids.get(parent) as number } : {}),
      i: parent ? Array.prototype.indexOf.call(parent.children, element) : 0,
      r: roleOf(element),
      v: nameOf(element),
    });

    return id;
  }

  start(target: Document = document): void {
    if (this.#recording) return;

    this.#recording = true;
    this.#startedAt = this.#now();
    this.#focusIsLost = false;

    this.#push({
      t: TraceMessageType.SessionStart,
      v: target.location?.href ?? '',
      n: target.defaultView?.innerWidth ?? 0,
      m: target.defaultView?.innerHeight ?? 0,
    });

    this.#watchFocus(target);
    this.#watchInteraction(target);
    this.#watchLiveRegions(target);
    this.#watchDialogs(target);
    this.#watchNavigation(target);
  }

  stop(): void {
    this.#recording = false;
    for (const dispose of this.#cleanup) dispose();
    this.#cleanup = [];
    this.#observer?.disconnect();
    this.#liveObserver?.disconnect();
  }

  #listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const wrapped = handler as EventListener;
    target.addEventListener(type, wrapped, options);
    this.#cleanup.push(() => target.removeEventListener(type, wrapped, options));
  }

  #watchFocus(target: Document): void {
    this.#listen(target, 'focusin', (event) => {
      const element = event.target as Element | null;
      if (!element || element.nodeType !== 1) return;

      this.#focusIsLost = false;
      this.#push({
        t: TraceMessageType.FocusMoved,
        id: this.#identify(element),
        s: this.#lastInteraction,
      });
      // Reset so the next focus move is attributed to whatever caused it.
      this.#lastInteraction = 'script';
    });

    this.#listen(target, 'focusout', () => {
      /*
       * Focus loss is detected on the next tick rather than in the handler:
       * during focusout the browser has not yet moved focus, so reading
       * activeElement here would always show the element being left. A frame
       * later, `body` means nothing caught it — which is the defect.
       */
      const view = target.defaultView;
      if (!view) return;
      view.setTimeout(() => {
        if (!this.#recording || this.#focusIsLost) return;
        const active = target.activeElement;
        if (active === null || active === target.body || active === target.documentElement) {
          /*
           * Once, not once per event. Moving focus fires a focusout for the
           * element being left *and* one for the document when focus was
           * previously on the body, so a single loss can arrive here twice.
           * Recording both would report one defect as two findings, which is
           * the kind of noise that makes a report untrustworthy.
           */
          this.#focusIsLost = true;
          this.#push({ t: TraceMessageType.FocusMoved, s: 'lost' });
        }
      }, 0);
    });
  }

  #watchInteraction(target: Document): void {
    this.#listen(target, 'keydown', (event) => {
      this.#lastInteraction = 'keyboard';
      const key = event.key;
      // Only navigation and activation keys matter; recording every character
      // would be both noisy and a privacy problem.
      if (!['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
        return;
      }
      this.#push({
        t: TraceMessageType.KeyPressed,
        v: key === ' ' ? 'Space' : key,
      });
    });

    this.#listen(target, 'pointerdown', () => {
      this.#lastInteraction = 'pointer';
    });

    this.#listen(target, 'click', (event) => {
      const element = event.target as Element | null;
      if (!element || element.nodeType !== 1) return;
      this.#push({ t: TraceMessageType.PointerActivated, id: this.#identify(element) });
    });

    this.#listen(target, 'input', (event) => {
      const element = event.target as Element | null;
      if (!element || element.nodeType !== 1) return;
      // The fact of editing, never the value.
      this.#push({ t: TraceMessageType.InputEdited, id: this.#identify(element) });
    });
  }

  /**
   * Watch live regions.
   *
   * This is the closest thing to "what did the screen reader say". A live
   * region announces when its contents change, so observing those mutations
   * and recording the resulting text reproduces the announcement stream
   * without needing a screen reader in the loop.
   */
  #watchLiveRegions(target: Document): void {
    const view = target.defaultView;
    if (!view || typeof view.MutationObserver !== 'function') return;

    const isLive = (element: Element): { live: boolean; politeness: string } => {
      const region = element.closest('[aria-live], [role="status"], [role="alert"], output');
      if (!region) return { live: false, politeness: 'polite' };

      const explicit = region.getAttribute('aria-live');
      const role = region.getAttribute('role');
      if (explicit === 'off') return { live: false, politeness: 'polite' };

      const politeness = explicit ?? (role === 'alert' ? 'assertive' : 'polite');
      return { live: true, politeness };
    };

    this.#liveObserver = new view.MutationObserver((records) => {
      for (const record of records) {
        const host =
          record.target.nodeType === 1
            ? (record.target as Element)
            : (record.target.parentElement ?? null);
        if (!host) continue;

        const { live, politeness } = isLive(host);
        if (!live) continue;

        const text = (host.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length === 0) continue;

        this.#push({ t: TraceMessageType.Announced, v: text.slice(0, 300), s: politeness });
      }
    });

    const root = observationRoot(target);
    if (root) {
      this.#liveObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
  }

  #watchDialogs(target: Document): void {
    const view = target.defaultView;
    if (!view || typeof view.MutationObserver !== 'function') return;

    const seen = new WeakSet<Element>();

    const scan = (): void => {
      const dialogs = target.querySelectorAll(
        'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
      );

      for (const dialog of Array.from(dialogs)) {
        if (seen.has(dialog)) continue;
        seen.add(dialog);
        this.#push({
          t: TraceMessageType.DialogOpened,
          id: this.#identify(dialog),
          b: dialog.getAttribute('aria-modal') === 'true' || dialog.hasAttribute('open'),
        });
      }
    };

    this.#observer = new view.MutationObserver(scan);
    const root = observationRoot(target);
    if (root) {
      this.#observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open', 'role', 'aria-modal', 'hidden'],
      });
    }
    scan();
  }

  #watchNavigation(target: Document): void {
    const view = target.defaultView;
    if (!view) return;

    let lastUrl = target.location?.href ?? '';

    const check = (): void => {
      const current = target.location?.href ?? '';
      if (current === lastUrl) return;
      lastUrl = current;
      this.#push({ t: TraceMessageType.Navigated, v: current });
    };

    const onPopState = (): void => check();
    view.addEventListener('popstate', onPopState);
    this.#cleanup.push(() => view.removeEventListener('popstate', onPopState));

    // A history push does not fire an event, so the SPA case needs polling.
    // Cheap at this interval, and it is the only way to catch pushState
    // without patching History, which we will not do on a customer's page.
    const timer = view.setInterval(check, 250);
    this.#cleanup.push(() => view.clearInterval(timer));
  }

  // ── Journey steps ──────────────────────────────────────────────────────────

  startStep(id: string, label: string): void {
    this.#currentStep = id;
    this.#push({ t: TraceMessageType.StepStarted, v: id, s: label });
  }

  endStep(ok = true): void {
    if (this.#currentStep === null) return;
    this.#push({ t: TraceMessageType.StepEnded, v: this.#currentStep, b: ok });
    this.#currentStep = null;
  }

  /** Record an audit run at this moment in the session. */
  recordAudit(score: number, failures: number): void {
    this.#push({ t: TraceMessageType.AuditSnapshot, n: score, m: failures });
  }

  // ── Delivery ───────────────────────────────────────────────────────────────

  build(): JourneyTrace {
    const view = typeof window === 'undefined' ? undefined : window;
    return {
      id: this.#options.generateId?.() ?? cryptoId(),
      journeyId: this.#options.journeyId ?? null,
      organisationId: this.#options.organisationId ?? null,
      version: TRACE_PROTOCOL_VERSION,
      startedAt: new Date(this.#startedAt).toISOString(),
      durationMs: this.#offset(),
      url: this.#messages.find((message) => message.t === TraceMessageType.SessionStart)?.v ?? '',
      messages: [...this.#messages],
      client: {
        viewportWidth: view?.innerWidth ?? 0,
        viewportHeight: view?.innerHeight ?? 0,
        prefersReducedMotion: view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        forcedColors: view?.matchMedia?.('(forced-colors: active)').matches ?? false,
      },
    };
  }

  async flush(): Promise<JourneyTrace> {
    const trace = this.build();

    if (this.#options.send) {
      await this.#options.send(trace);
      return trace;
    }

    if (this.#options.endpoint && typeof fetch === 'function') {
      await fetch(this.#options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trace),
        keepalive: true,
      });
    }

    return trace;
  }
}

function cryptoId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && 'randomUUID' in globalCrypto) return globalCrypto.randomUUID();
  return `trace-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/** Convenience entry point for a `<script>` tag. */
export function record(options: TrackerOptions = {}): Tracker {
  const tracker = new Tracker(options);
  tracker.start();
  return tracker;
}
