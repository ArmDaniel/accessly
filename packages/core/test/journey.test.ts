import { describe, expect, it } from 'vitest';
import {
  TRACE_PROTOCOL_VERSION,
  TraceMessageType,
  type Journey,
  type JourneyTrace,
  type TraceMessage,
} from '@accessly/contracts';
import { analyseJourney, evaluateJourney, reconstruct } from '../src/journey/analyse.js';

/**
 * Journey analysis.
 *
 * These tests are written against traces rather than against markup, because
 * that is the point of the feature: every criterion checked here is one the
 * static engine can only ever report as `cantTell`. 2.4.3 Focus Order is not a
 * property of a document — it is a property of what happened when someone
 * pressed Tab.
 */

function trace(messages: readonly TraceMessage[], overrides: Partial<JourneyTrace> = {}): JourneyTrace {
  const last = messages[messages.length - 1];
  return {
    id: 'trace-1',
    journeyId: null,
    organisationId: 'org-1',
    version: TRACE_PROTOCOL_VERSION,
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: last?.o ?? 0,
    url: 'https://example.test/',
    messages,
    client: {
      viewportWidth: 1280,
      viewportHeight: 800,
      prefersReducedMotion: false,
      forcedColors: false,
    },
    ...overrides,
  };
}

const start = (o = 0): TraceMessage => ({ t: TraceMessageType.SessionStart, o, v: 'https://example.test/' });
const addNode = (id: number, role: string, name: string, o = 0): TraceMessage => ({
  t: TraceMessageType.NodeAdded,
  o,
  id,
  r: role,
  v: name,
});
const focus = (id: number, o: number, cause = 'keyboard'): TraceMessage => ({
  t: TraceMessageType.FocusMoved,
  o,
  id,
  s: cause,
});
const focusLost = (o: number): TraceMessage => ({ t: TraceMessageType.FocusMoved, o, s: 'lost' });
const announce = (text: string, o: number, politeness = 'polite'): TraceMessage => ({
  t: TraceMessageType.Announced,
  o,
  v: text,
  s: politeness,
});
const key = (name: string, o: number): TraceMessage => ({ t: TraceMessageType.KeyPressed, o, v: name });

const ruleIds = (findings: readonly { ruleId: string }[]): string[] => findings.map((f) => f.ruleId);

// ─────────────────────────────────────────────────────────────────────────────
// Reconstruction — the mirror
// ─────────────────────────────────────────────────────────────────────────────

describe('reconstruct — the mirror', () => {
  it('resolves a focus message to the name the tracker sent once', () => {
    const session = reconstruct(
      trace([start(), addNode(1, 'button', 'Open settings'), focus(1, 500)]),
    );

    const frame = session.frames.find((candidate) => candidate.kind === 'focus');
    expect(frame?.focus).toBe('Open settings');
    expect(frame?.focusRole).toBe('button');
    expect(frame?.summary).toContain('button “Open settings”');
  });

  it('records focus on a node it never saw rather than discarding it', () => {
    // A truncated trace is still diagnostic; "focus moved somewhere we never
    // saw" is information, not a reason to drop the frame.
    const session = reconstruct(trace([start(), focus(99, 100)]));

    const frame = session.frames.find((candidate) => candidate.kind === 'focus');
    expect(frame).toBeDefined();
    expect(frame?.summary).toContain('an unknown element');
  });

  it('applies renames, so a frame shows the name in force at that moment', () => {
    const session = reconstruct(
      trace([
        start(),
        addNode(1, 'button', 'Show more'),
        { t: TraceMessageType.NodeRenamed, o: 200, id: 1, v: 'Show less' },
        focus(1, 300),
      ]),
    );

    expect(session.frames.find((frame) => frame.kind === 'focus')?.focus).toBe('Show less');
  });

  it('reports a session with no pointer activation as keyboard-only', () => {
    const keyboard = reconstruct(trace([start(), addNode(1, 'link', 'Home'), key('Tab', 10), focus(1, 20)]));
    expect(keyboard.keyboardOnly).toBe(true);

    const pointer = reconstruct(
      trace([start(), addNode(1, 'link', 'Home'), { t: TraceMessageType.PointerActivated, o: 20, id: 1 }]),
    );
    expect(pointer.keyboardOnly).toBe(false);
  });

  it('never carries an input value into the timeline', () => {
    const session = reconstruct(
      trace([start(), addNode(1, 'textbox', 'Card number'), { t: TraceMessageType.InputEdited, o: 100, id: 1 }]),
    );

    const frame = session.frames.find((candidate) => candidate.kind === 'input');
    expect(frame?.summary).toBe('The user typed into textbox “Card number”.');
    // The protocol has no field for a value, and the summary must not invent one.
    expect(JSON.stringify(session.frames)).not.toMatch(/4111/);
  });

  it('tracks the frame range of each step, closing an unclosed final step', () => {
    const session = reconstruct(
      trace([
        start(),
        { t: TraceMessageType.StepStarted, o: 100, v: 'checkout', s: 'Open checkout' },
        addNode(1, 'button', 'Pay'),
        focus(1, 200),
      ]),
    );

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0]?.label).toBe('Open checkout');
    expect(session.steps[0]?.to).toBe(session.frames.length);
    expect(session.frames.at(-1)?.stepId).toBe('checkout');
  });

  it('takes the duration from the last offset when the header understates it', () => {
    const session = reconstruct(trace([start(), focus(1, 9_000)], { durationMs: 10 }));
    expect(session.durationMs).toBe(9_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────────────────────

describe('journey rules — 2.4.3 focus order', () => {
  it('fails when focus is lost, and names the dialog as the likely cause', () => {
    const session = reconstruct(
      trace([
        start(),
        addNode(1, 'dialog', 'Confirm deletion'),
        { t: TraceMessageType.DialogOpened, o: 100, id: 1, b: true },
        focus(1, 150),
        { t: TraceMessageType.DialogClosed, o: 2_000, id: 1 },
        focusLost(2_050),
      ]),
    );

    const finding = evaluateJourney(session).find((f) => f.ruleId === 'journey-focus-not-lost');
    expect(finding?.outcome).toBe('failed');
    expect(finding?.impact).toBe('critical');
    expect(finding?.criteria).toContain('2.4.3');
    expect(finding?.message).toContain('dialog closed');
  });

  it('fails a dialog that opens without taking focus', () => {
    const session = reconstruct(
      trace([
        start(),
        addNode(1, 'dialog', 'Newsletter'),
        { t: TraceMessageType.DialogOpened, o: 1_000, id: 1, b: true },
        announce('Subscribe to our newsletter', 1_200),
      ]),
    );

    expect(ruleIds(evaluateJourney(session))).toContain('journey-dialog-takes-focus');
  });

  it('passes a dialog that moves focus into itself', () => {
    const session = reconstruct(
      trace([
        start(),
        addNode(1, 'dialog', 'Newsletter'),
        addNode(2, 'button', 'Close'),
        { t: TraceMessageType.DialogOpened, o: 1_000, id: 1, b: true },
        focus(2, 1_050, 'script'),
      ]),
    );

    expect(ruleIds(evaluateJourney(session))).not.toContain('journey-dialog-takes-focus');
  });
});

describe('journey rules — 2.1.2 keyboard trap', () => {
  const trapMessages = (): TraceMessage[] => {
    const messages: TraceMessage[] = [start(), addNode(1, 'button', 'A'), addNode(2, 'button', 'B')];
    let offset = 100;
    for (let i = 0; i < 8; i += 1) {
      messages.push(key('Tab', offset));
      messages.push(focus(i % 2 === 0 ? 1 : 2, offset + 10));
      offset += 200;
    }
    return messages;
  };

  it('fails when repeated Tab presses cycle two elements with no dialog open', () => {
    const finding = evaluateJourney(reconstruct(trace(trapMessages()))).find(
      (f) => f.ruleId === 'journey-keyboard-trap',
    );

    expect(finding?.outcome).toBe('failed');
    expect(finding?.criteria).toEqual(['2.1.2']);
  });

  it('reports cantTell rather than a guess when a dialog was open', () => {
    // Containment inside a modal is correct behaviour. Calling it a failure
    // would be inventing a verdict we cannot reach from the trace.
    const messages: TraceMessage[] = [
      start(),
      addNode(9, 'dialog', 'Settings'),
      { t: TraceMessageType.DialogOpened, o: 50, id: 9, b: true },
      ...trapMessages().slice(1),
    ];

    const finding = evaluateJourney(reconstruct(trace(messages))).find(
      (f) => f.ruleId === 'journey-keyboard-trap',
    );
    expect(finding?.outcome).toBe('cantTell');
  });

  it('stays quiet when Tab moves through many different elements', () => {
    const messages: TraceMessage[] = [start()];
    for (let i = 1; i <= 8; i += 1) {
      messages.push(addNode(i, 'link', `Item ${i}`));
      messages.push(key('Tab', i * 200));
      messages.push(focus(i, i * 200 + 10));
    }

    expect(ruleIds(evaluateJourney(reconstruct(trace(messages))))).not.toContain('journey-keyboard-trap');
  });
});

describe('journey rules — 4.1.3 status messages', () => {
  it('fails a route change that is neither announced nor focused', () => {
    const session = reconstruct(
      trace([start(), { t: TraceMessageType.Navigated, o: 2_000, v: 'https://example.test/pricing' }]),
    );

    const finding = evaluateJourney(session).find((f) => f.ruleId === 'journey-route-announced');
    expect(finding?.outcome).toBe('failed');
    expect(finding?.message).toContain('pricing');
  });

  it('accepts a route change that announces the new page', () => {
    const session = reconstruct(
      trace([
        start(),
        { t: TraceMessageType.Navigated, o: 2_000, v: 'https://example.test/pricing' },
        announce('Pricing', 2_100),
      ]),
    );

    expect(ruleIds(evaluateJourney(session))).not.toContain('journey-route-announced');
  });

  it('fails three assertive announcements in quick succession', () => {
    const session = reconstruct(
      trace([
        start(),
        announce('Saved', 1_000, 'assertive'),
        announce('Synced', 2_000, 'assertive'),
        announce('Published', 3_000, 'assertive'),
      ]),
    );

    const finding = evaluateJourney(session).find((f) => f.ruleId === 'journey-assertive-overuse');
    expect(finding?.outcome).toBe('failed');
  });

  it('leaves polite announcements alone however many there are', () => {
    const session = reconstruct(
      trace([start(), announce('One', 1_000), announce('Two', 2_000), announce('Three', 3_000)]),
    );

    expect(ruleIds(evaluateJourney(session))).not.toContain('journey-assertive-overuse');
  });
});

describe('journey rules — 2.1.1 and 3.2.2', () => {
  it('reports cantTell for a control clicked without ever receiving focus', () => {
    const session = reconstruct(
      trace([start(), addNode(1, 'generic', 'Delete'), { t: TraceMessageType.PointerActivated, o: 1_000, id: 1 }]),
    );

    const finding = evaluateJourney(session).find((f) => f.ruleId === 'journey-keyboard-reachable');
    // We cannot see whether it is tabbable, only that it was never focused.
    expect(finding?.outcome).toBe('cantTell');
  });

  it('says nothing when the clicked control was focused around the click', () => {
    const session = reconstruct(
      trace([
        start(),
        addNode(1, 'button', 'Delete'),
        focus(1, 950, 'pointer'),
        { t: TraceMessageType.PointerActivated, o: 1_000, id: 1 },
      ]),
    );

    expect(ruleIds(evaluateJourney(session))).not.toContain('journey-keyboard-reachable');
  });

  it('fails a page that navigates while the user is typing', () => {
    const session = reconstruct(
      trace([
        start(),
        addNode(1, 'textbox', 'Postcode'),
        { t: TraceMessageType.InputEdited, o: 1_000, id: 1 },
        { t: TraceMessageType.Navigated, o: 1_150, v: 'https://example.test/results' },
      ]),
    );

    const finding = evaluateJourney(session).find((f) => f.ruleId === 'journey-typing-no-context-change');
    expect(finding?.outcome).toBe('failed');
    expect(finding?.criteria).toEqual(['3.2.2']);
  });
});

describe('journey rules — determinism and robustness', () => {
  it('gives the same finding id for the same defect in two recordings', () => {
    const messages = [start(), focusLost(1_000)];
    const a = evaluateJourney(reconstruct(trace(messages, { id: 'trace-a' })));
    const b = evaluateJourney(reconstruct(trace(messages, { id: 'trace-b' })));

    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.id).toHaveLength(16);
  });

  it('returns findings in timeline order', () => {
    const session = reconstruct(
      trace([
        start(),
        { t: TraceMessageType.Navigated, o: 5_000, v: 'https://example.test/two' },
        focusLost(1_000),
      ]),
    );

    const offsets = evaluateJourney(session).map((finding) => finding.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it('produces nothing at all for an empty trace', () => {
    const session = reconstruct(trace([]));
    expect(session.frames).toHaveLength(0);
    expect(evaluateJourney(session)).toEqual([]);
  });

  it('assigns each finding a level no weaker than its strictest criterion', () => {
    const session = reconstruct(trace([start(), focusLost(500)]));
    // 2.4.3 is level A, so the finding must be reported at A.
    expect(evaluateJourney(session)[0]?.level).toBe('A');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The report
// ─────────────────────────────────────────────────────────────────────────────

describe('analyseJourney', () => {
  const journey: Journey = {
    id: 'journey-1',
    organisationId: 'org-1',
    siteId: null,
    name: 'Checkout',
    description: 'Buy one item.',
    startUrl: 'https://example.test/',
    steps: [
      {
        id: 'open-basket',
        label: 'Open the basket',
        action: 'click',
        expect: { announces: 'basket', keyboardOnly: true },
      },
      { id: 'pay', label: 'Pay', action: 'click' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const recorded = trace([
    start(),
    addNode(1, 'button', 'Basket'),
    { t: TraceMessageType.StepStarted, o: 100, v: 'open-basket', s: 'Open the basket' },
    key('Enter', 150),
    announce('Basket, 1 item', 300),
    { t: TraceMessageType.StepEnded, o: 400, v: 'open-basket', b: true },
  ]);

  it('attaches findings to the frame they happened at', () => {
    const report = analyseJourney({
      trace: trace([start(), focusLost(1_000)]),
      generateId: () => 'report-1',
    });

    const finding = report.findings[0];
    expect(finding).toBeDefined();
    expect(report.timeline[finding?.frameIndex ?? -1]?.findingIds).toContain(finding?.id);
  });

  it('summarises the session for the player header', () => {
    const report = analyseJourney({ trace: recorded, generateId: () => 'report-1' });

    expect(report.summary).toMatchObject({
      announcements: 1,
      focusMoves: 0,
      focusLosses: 0,
      keyboardOnly: true,
    });
    expect(report.summary.frames).toBe(report.timeline.length);
  });

  it('marks a step satisfied when its expectations are met', () => {
    const report = analyseJourney({ trace: recorded, journey, generateId: () => 'report-1' });

    expect(report.steps[0]).toMatchObject({ stepId: 'open-basket', satisfied: true });
  });

  it('explains which expectation a step failed', () => {
    const silent = trace([
      start(),
      { t: TraceMessageType.StepStarted, o: 100, v: 'open-basket', s: 'Open the basket' },
      { t: TraceMessageType.PointerActivated, o: 200, id: 1 },
      { t: TraceMessageType.StepEnded, o: 400, v: 'open-basket', b: true },
    ]);

    const outcome = analyseJourney({ trace: silent, journey, generateId: () => 'r' }).steps[0];
    expect(outcome?.satisfied).toBe(false);
    expect(outcome?.detail).toContain('nothing was announced');
    expect(outcome?.detail).toContain('pointer');
  });

  it('reports a step that was never reached rather than silently passing it', () => {
    const outcome = analyseJourney({ trace: recorded, journey, generateId: () => 'r' }).steps[1];
    expect(outcome).toMatchObject({ stepId: 'pay', satisfied: false });
    expect(outcome?.detail).toContain('never reached');
  });

  it('carries tenancy through from the trace', () => {
    const report = analyseJourney({ trace: recorded, journey, generateId: () => 'r' });
    expect(report.organisationId).toBe('org-1');
    expect(report.traceId).toBe('trace-1');
  });

  it('names an unattached recording after the URL it ran on', () => {
    const report = analyseJourney({ trace: recorded, generateId: () => 'r' });
    expect(report.name).toContain('https://example.test/');
    expect(report.steps).toEqual([]);
  });
});
