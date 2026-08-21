import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACE_PROTOCOL_VERSION, TraceMessageType, type JourneyTrace } from '@accessly/contracts';
import { analyseJourney, reconstruct } from '@accessly/core';
import { Tracker, record } from '../src/index.js';

/**
 * The tracker, exercised in jsdom.
 *
 * jsdom is the right environment here for the same reason the engine tests use
 * plain Node: it is the real thing minus the pixels. Focus, focusin/focusout,
 * MutationObserver and history all behave as they do in a browser, so a test
 * that passes here is testing the tracker rather than a mock of the DOM.
 *
 * Two properties matter more than any individual assertion and are asserted
 * repeatedly below: the tracker never records what a user typed, and what it
 * does record must round-trip through the core reconstructor.
 */

let active: Tracker | null = null;

afterEach(() => {
  active?.stop();
  active = null;
  document.body.innerHTML = '';
});

function track(options: Parameters<typeof record>[0] = {}): Tracker {
  const tracker = new Tracker(options);
  tracker.start(document);
  active = tracker;
  return tracker;
}

/** MutationObserver callbacks are queued; a microtask turn lets them run. */
const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const typesOf = (tracker: Tracker): number[] => tracker.messages.map((message) => message.t);

describe('tracker — session framing', () => {
  it('opens with a session-start carrying the URL and viewport', () => {
    const tracker = track();

    const first = tracker.messages[0];
    expect(first?.t).toBe(TraceMessageType.SessionStart);
    expect(first?.v).toBe(document.location.href);
    expect(first?.n).toBe(window.innerWidth);
  });

  it('records nothing before start or after stop', () => {
    const tracker = new Tracker();
    const button = document.createElement('button');
    button.textContent = 'Save';
    document.body.append(button);

    button.click();
    expect(tracker.messages).toHaveLength(0);

    tracker.start(document);
    button.click();
    const during = tracker.messages.length;
    expect(during).toBeGreaterThan(1);

    tracker.stop();
    button.click();
    expect(tracker.messages).toHaveLength(during);
    expect(tracker.isRecording).toBe(false);
  });

  it('bounds memory at maxMessages rather than growing without limit', () => {
    const tracker = track({ maxMessages: 3 });
    const button = document.createElement('button');
    document.body.append(button);

    for (let i = 0; i < 20; i += 1) button.click();

    expect(tracker.messages.length).toBe(3);
  });

  it('stamps every message with an offset from the session start', () => {
    let clock = 1_000;
    const tracker = track({ now: () => clock });
    clock = 1_250;

    const button = document.createElement('button');
    document.body.append(button);
    button.click();

    expect(tracker.messages.at(-1)?.o).toBe(250);
  });
});

describe('tracker — the mirror', () => {
  it('describes a node once and refers to it by id afterwards', () => {
    const tracker = track();
    const button = document.createElement('button');
    button.textContent = 'Open settings';
    document.body.append(button);

    button.click();
    button.click();

    const added = tracker.messages.filter((message) => message.t === TraceMessageType.NodeAdded);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ r: 'button', v: 'Open settings' });

    const activations = tracker.messages.filter(
      (message) => message.t === TraceMessageType.PointerActivated,
    );
    expect(activations).toHaveLength(2);
    expect(activations[0]?.id).toBe(added[0]?.id);
    // The second activation carries the id alone — that is what keeps a trace small.
    expect(activations[1]?.id).toBe(added[0]?.id);
  });

  it('names a control from its label rather than its content', () => {
    const tracker = track();
    document.body.innerHTML = '<label for="email">Email address</label><input id="email">';
    const input = document.querySelector('input') as HTMLInputElement;

    input.dispatchEvent(new Event('input', { bubbles: true }));

    const added = tracker.messages.find((message) => message.t === TraceMessageType.NodeAdded);
    expect(added).toMatchObject({ r: 'textbox', v: 'Email address' });
  });

  it('prefers aria-label and derives a role from the element', () => {
    const tracker = track();
    document.body.innerHTML = '<a href="/pricing" aria-label="See our pricing">Here</a>';
    (document.querySelector('a') as HTMLElement).click();

    expect(tracker.messages.find((message) => message.t === TraceMessageType.NodeAdded)).toMatchObject({
      r: 'link',
      v: 'See our pricing',
    });
  });
});

describe('tracker — focus', () => {
  it('attributes focus to the keyboard when a key preceded it', async () => {
    const tracker = track();
    const button = document.createElement('button');
    button.textContent = 'Continue';
    document.body.append(button);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    button.focus();
    await settle();

    const move = tracker.messages.find((message) => message.t === TraceMessageType.FocusMoved);
    expect(move?.s).toBe('keyboard');
  });

  it('attributes focus to the pointer when a pointerdown preceded it', async () => {
    const tracker = track();
    const button = document.createElement('button');
    document.body.append(button);

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.focus();
    await settle();

    expect(tracker.messages.find((message) => message.t === TraceMessageType.FocusMoved)?.s).toBe(
      'pointer',
    );
  });

  it('records focus loss when nothing catches focus', async () => {
    const tracker = track();
    const button = document.createElement('button');
    document.body.append(button);

    button.focus();
    button.blur();
    // Deliberately checked a tick later: during focusout the browser has not yet
    // moved focus, so the check has to happen after it settles.
    await settle(5);

    const lost = tracker.messages.filter(
      (message) => message.t === TraceMessageType.FocusMoved && message.s === 'lost',
    );
    expect(lost).toHaveLength(1);
    expect(lost[0]?.id).toBeUndefined();
  });

  it('records one loss per loss, not one per focusout event', async () => {
    // Moving focus fires a focusout for the element being left and, when focus
    // was on the body, one for the document too. One defect, one message.
    const tracker = track();
    document.body.innerHTML = '<button id="a">A</button>';
    const a = document.getElementById('a') as HTMLElement;

    a.focus();
    a.blur();
    await settle(5);
    a.focus();
    a.blur();
    await settle(5);

    const lost = tracker.messages.filter(
      (message) => message.t === TraceMessageType.FocusMoved && message.s === 'lost',
    );
    // Two genuine losses, because focus was regained in between.
    expect(lost).toHaveLength(2);
  });

  it('does not report loss when focus moves on to another control', async () => {
    const tracker = track();
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const a = document.getElementById('a') as HTMLElement;
    const b = document.getElementById('b') as HTMLElement;

    a.focus();
    b.focus();
    await settle(5);

    expect(
      tracker.messages.some(
        (message) => message.t === TraceMessageType.FocusMoved && message.s === 'lost',
      ),
    ).toBe(false);
  });
});

describe('tracker — announcements', () => {
  it('records what a live region would have spoken', async () => {
    const tracker = track();
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    document.body.append(status);

    status.textContent = 'Saved your changes';
    await settle();

    const announced = tracker.messages.find((message) => message.t === TraceMessageType.Announced);
    expect(announced).toMatchObject({ v: 'Saved your changes', s: 'polite' });
  });

  it('records role="alert" as assertive', async () => {
    const tracker = track();
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    document.body.append(alert);

    alert.textContent = 'Your session is about to expire';
    await settle();

    expect(tracker.messages.find((message) => message.t === TraceMessageType.Announced)?.s).toBe(
      'assertive',
    );
  });

  it('still records announcements when started before the body exists', async () => {
    /*
     * Regression: the observers only attached when `document.body` was already
     * present. `record()` is documented as something you drop into a `<script>`
     * tag, and the earliest useful place for that is `<head>` — where body is
     * null, nothing attached, and the whole session came back with no
     * announcements and no dialogs at all.
     */
    const real = Object.getOwnPropertyDescriptor(Document.prototype, 'body');
    Object.defineProperty(document, 'body', { configurable: true, get: () => null });

    let tracker: Tracker;
    try {
      tracker = track();
    } finally {
      // Restore before mutating, so the rest of the test uses the real body.
      delete (document as unknown as Record<string, unknown>).body;
      if (real) Object.defineProperty(Document.prototype, 'body', real);
    }

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    document.body.append(status);
    status.textContent = 'Saved your changes';
    await settle();

    expect(tracker.messages.find((message) => message.t === TraceMessageType.Announced)).toMatchObject(
      { v: 'Saved your changes' },
    );
  });

  it('ignores aria-live="off" and ordinary content changes', async () => {
    const tracker = track();
    document.body.innerHTML = '<div aria-live="off" id="quiet"></div><p id="plain"></p>';

    (document.getElementById('quiet') as HTMLElement).textContent = 'Nothing to see';
    (document.getElementById('plain') as HTMLElement).textContent = 'Ordinary prose';
    await settle();

    expect(typesOf(tracker)).not.toContain(TraceMessageType.Announced);
  });
});

describe('tracker — dialogs and navigation', () => {
  it('records a dialog appearing, with its modality', async () => {
    const tracker = track();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Confirm deletion');
    document.body.append(dialog);
    await settle();

    const opened = tracker.messages.find((message) => message.t === TraceMessageType.DialogOpened);
    expect(opened?.b).toBe(true);
    expect(
      tracker.messages.find((message) => message.id === opened?.id && message.t === TraceMessageType.NodeAdded)?.v,
    ).toBe('Confirm deletion');
  });

  it('records a dialog once, not on every unrelated mutation', async () => {
    const tracker = track();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    await settle();

    document.body.append(document.createElement('p'));
    await settle();

    expect(typesOf(tracker).filter((type) => type === TraceMessageType.DialogOpened)).toHaveLength(1);
  });

  it('records a history navigation', () => {
    const tracker = track();

    window.history.pushState({}, '', '/pricing');
    window.dispatchEvent(new PopStateEvent('popstate'));

    const navigated = tracker.messages.find((message) => message.t === TraceMessageType.Navigated);
    expect(navigated?.v).toContain('/pricing');

    window.history.pushState({}, '', '/');
  });
});

describe('tracker — privacy', () => {
  it('records that a field was edited but never its value', () => {
    const tracker = track();
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Card number');
    document.body.append(input);

    input.value = '4111 1111 1111 1111';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(typesOf(tracker)).toContain(TraceMessageType.InputEdited);
    expect(JSON.stringify(tracker.messages)).not.toContain('4111');
  });

  it('records navigation keys but not the characters someone typed', () => {
    const tracker = track();

    for (const key of ['s', 'e', 'c', 'r', 'e', 't']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    const keys = tracker.messages
      .filter((message) => message.t === TraceMessageType.KeyPressed)
      .map((message) => message.v);
    expect(keys).toEqual(['Enter', 'Space']);
  });
});

describe('tracker — steps and delivery', () => {
  it('brackets frames with the step they belong to', () => {
    const tracker = track();
    tracker.startStep('checkout', 'Open checkout');
    tracker.endStep(true);

    expect(tracker.messages.filter((message) => message.t === TraceMessageType.StepStarted)).toMatchObject([
      { v: 'checkout', s: 'Open checkout' },
    ]);
    expect(tracker.messages.filter((message) => message.t === TraceMessageType.StepEnded)).toMatchObject([
      { v: 'checkout', b: true },
    ]);
  });

  it('ignores endStep when no step is open', () => {
    const tracker = track();
    tracker.endStep();
    expect(typesOf(tracker)).not.toContain(TraceMessageType.StepEnded);
  });

  it('records an audit snapshot as a moment in the session', () => {
    const tracker = track();
    tracker.recordAudit(87, 4);

    expect(tracker.messages.at(-1)).toMatchObject({ t: TraceMessageType.AuditSnapshot, n: 87, m: 4 });
  });

  it('builds a trace stamped with the protocol version and tenancy', () => {
    const tracker = track({
      journeyId: 'journey-1',
      organisationId: 'org-1',
      generateId: () => 'trace-fixed',
    });

    const trace = tracker.build();
    expect(trace).toMatchObject({
      id: 'trace-fixed',
      journeyId: 'journey-1',
      organisationId: 'org-1',
      version: TRACE_PROTOCOL_VERSION,
      url: document.location.href,
    });
    expect(Date.parse(trace.startedAt)).not.toBeNaN();
  });

  it('hands the trace to the injected sender instead of fetching', async () => {
    const sent: JourneyTrace[] = [];
    const tracker = track({ send: async (trace) => void sent.push(trace) });
    tracker.recordAudit(90, 1);

    const built = await tracker.flush();
    expect(sent).toEqual([built]);
  });

  it('posts to the endpoint when no sender is injected', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const tracker = track({ endpoint: 'https://api.example.test/v1/traces' });
    await tracker.flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/traces');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).version).toBe(TRACE_PROTOCOL_VERSION);

    vi.unstubAllGlobals();
  });

  it('starts recording immediately from the convenience entry point', () => {
    const tracker = record();
    active = tracker;
    expect(tracker.isRecording).toBe(true);
    expect(tracker.messages[0]?.t).toBe(TraceMessageType.SessionStart);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The contract between the two halves
// ─────────────────────────────────────────────────────────────────────────────

describe('tracker → core round trip', () => {
  it('produces a trace the reconstructor can read back', async () => {
    const tracker = track({ organisationId: 'org-1', generateId: () => 'trace-1' });

    const button = document.createElement('button');
    button.textContent = 'Delete account';
    document.body.append(button);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    button.focus();
    await settle(5);

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    document.body.append(status);
    status.textContent = 'Account deleted';
    await settle();

    const session = reconstruct(tracker.build());

    expect(session.frames.some((frame) => frame.focus === 'Delete account')).toBe(true);
    expect(session.frames.some((frame) => frame.announcement === 'Account deleted')).toBe(true);
    expect(session.keyboardOnly).toBe(true);
  });

  it('lets the analyser find a real focus-loss defect in a recorded session', async () => {
    const tracker = track({ organisationId: 'org-1' });

    // The classic bug: a control is removed while focused and nothing catches it.
    const button = document.createElement('button');
    button.textContent = 'Dismiss';
    document.body.append(button);
    button.focus();
    await settle(5);
    button.blur();
    button.remove();
    await settle(5);

    const report = analyseJourney({ trace: tracker.build(), generateId: () => 'report-1' });

    const finding = report.findings.find((item) => item.ruleId === 'journey-focus-not-lost');
    expect(finding?.outcome).toBe('failed');
    expect(report.summary.focusLosses).toBe(1);
    expect(report.timeline[finding?.frameIndex ?? -1]?.findingIds).toContain(finding?.id);
  });
});
