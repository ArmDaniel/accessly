import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TRACE_PROTOCOL_VERSION, TraceMessageType, type TraceMessage } from '@accessly/contracts';
import { createHarness, GOOD_PAGE, type Harness } from './helpers.js';

/**
 * Journeys over HTTP.
 *
 * The behaviour under test that matters most is tenancy: a trace arrives from a
 * script running on a customer's page, so nothing in its body may decide which
 * organisation it lands in, and a journey belonging to somebody else has to be
 * indistinguishable from one that does not exist.
 */

let harness: Harness;

const OTHER_ORG = '00000000-0000-4000-8000-0000000000ff';

beforeEach(async () => {
  harness = await createHarness({ 'https://example.test/': GOOD_PAGE });
});

afterEach(async () => {
  await harness.app.close();
});

const journeyBody = {
  name: 'Checkout',
  description: 'Add an item and pay for it.',
  startUrl: 'https://example.test/',
  steps: [
    {
      id: 'open-basket',
      label: 'Open the basket',
      action: 'click',
      expect: { announces: 'basket', keyboardOnly: true },
    },
  ],
};

async function createJourney(body: object = journeyBody, organisation?: string) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/journeys',
    ...(organisation ? { headers: { 'x-accessly-organisation': organisation } } : {}),
    payload: body,
  });
  return response;
}

/**
 * `WireMessage` rather than `TraceMessage`: the wire deliberately allows type
 * ids this build does not know about, and one test depends on that.
 */
type WireMessage = Omit<TraceMessage, 't'> & { t: number };

function traceBody(messages: readonly WireMessage[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'trace-from-the-browser',
    journeyId: null,
    version: TRACE_PROTOCOL_VERSION,
    startedAt: '2026-01-01T09:00:00.000Z',
    durationMs: messages.at(-1)?.o ?? 0,
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

const SESSION_START: TraceMessage = {
  t: TraceMessageType.SessionStart,
  o: 0,
  v: 'https://example.test/',
};

describe('POST /v1/journeys', () => {
  it('creates a journey scoped to the calling organisation', async () => {
    const response = await createJourney();
    expect(response.statusCode).toBe(201);

    const journey = response.json();
    expect(journey).toMatchObject({ name: 'Checkout', siteId: null });
    expect(journey.organisationId).toBe('00000000-0000-4000-8000-000000000001');
    expect(journey.steps).toHaveLength(1);
  });

  it('rejects duplicate step ids, which would make one step unverifiable', async () => {
    const response = await createJourney({
      ...journeyBody,
      steps: [
        { id: 'same', label: 'One', action: 'click' },
        { id: 'same', label: 'Two', action: 'click' },
      ],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().errors.steps[0]).toContain('same');
  });

  it('rejects a startUrl that is not an absolute http(s) URL', async () => {
    const response = await createJourney({ ...journeyBody, startUrl: 'javascript:alert(1)' });
    expect(response.statusCode).toBe(422);
  });

  it('reports a site belonging to another organisation as missing', async () => {
    const site = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: { 'x-accessly-organisation': OTHER_ORG },
      payload: { url: 'https://example.test/', label: 'Theirs' },
    });

    const response = await createJourney({ ...journeyBody, siteId: site.json().id });
    expect(response.statusCode).toBe(404);
  });
});

describe('journey tenancy', () => {
  it('hides another organisation’s journey behind a 404, not a 403', async () => {
    const id = (await createJourney()).json().id;

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const response = await harness.app.inject({
        method,
        url: `/v1/journeys/${id}`,
        headers: { 'x-accessly-organisation': OTHER_ORG },
        ...(method === 'PATCH' ? { payload: { name: 'Stolen' } } : {}),
      });
      // 403 would confirm the id exists; existence must not leak.
      expect(response.statusCode).toBe(404);
    }
  });

  it('lists only the calling organisation’s journeys', async () => {
    await createJourney();
    await createJourney({ ...journeyBody, name: 'Theirs' }, OTHER_ORG);

    const mine = await harness.app.inject({ method: 'GET', url: '/v1/journeys' });
    expect(mine.json().items).toHaveLength(1);
    expect(mine.json().items[0].name).toBe('Checkout');
  });

  it('will not let a patch move a journey into another organisation', async () => {
    const id = (await createJourney()).json().id;

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/journeys/${id}`,
      payload: { name: 'Renamed', organisationId: OTHER_ORG },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().organisationId).toBe('00000000-0000-4000-8000-000000000001');
  });
});

describe('POST /v1/traces', () => {
  it('analyses a posted trace and answers with the report', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: traceBody([
        SESSION_START,
        { t: TraceMessageType.NodeAdded, o: 10, id: 1, r: 'button', v: 'Delete' },
        { t: TraceMessageType.FocusMoved, o: 20, id: 1, s: 'keyboard' },
        { t: TraceMessageType.FocusMoved, o: 2_000, s: 'lost' },
      ]),
    });

    expect(response.statusCode).toBe(201);
    const report = response.json();

    expect(report.summary).toMatchObject({ focusLosses: 1, keyboardOnly: true });
    const finding = report.findings.find(
      (item: { ruleId: string }) => item.ruleId === 'journey-focus-not-lost',
    );
    expect(finding.outcome).toBe('failed');
    expect(finding.criteria).toContain('2.4.3');
    expect(report.timeline[finding.frameIndex].findingIds).toContain(finding.id);
  });

  it('takes tenancy from the request, never from the body', async () => {
    // The body is composed by a script on the customer's page; anything in it
    // is under the visitor's control.
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { 'x-accessly-organisation': OTHER_ORG },
      payload: traceBody([SESSION_START], { organisationId: '00000000-0000-4000-8000-000000000001' }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().organisationId).toBe(OTHER_ORG);
  });

  it('checks declared steps when the trace names a journey', async () => {
    const journeyId = (await createJourney()).json().id;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: traceBody(
        [
          SESSION_START,
          { t: TraceMessageType.StepStarted, o: 100, v: 'open-basket', s: 'Open the basket' },
          { t: TraceMessageType.KeyPressed, o: 150, v: 'Enter' },
          { t: TraceMessageType.Announced, o: 300, v: 'Basket, 1 item', s: 'polite' },
          { t: TraceMessageType.StepEnded, o: 400, v: 'open-basket', b: true },
        ],
        { journeyId },
      ),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().name).toBe('Checkout');
    expect(response.json().steps).toEqual([
      { stepId: 'open-basket', label: 'Open the basket', satisfied: true, detail: expect.any(String) },
    ]);
  });

  it('reports a journey from another organisation as missing', async () => {
    const journeyId = (await createJourney(journeyBody, OTHER_ORG)).json().id;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: traceBody([SESSION_START], { journeyId }),
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses a trace from a newer tracker rather than misreading it', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: traceBody([SESSION_START], { version: TRACE_PROTOCOL_VERSION + 1 }),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().detail ?? response.json().title).toMatch(/newer tracker|protocol/i);
  });

  it('ignores message types it does not recognise instead of rejecting the trace', async () => {
    // The tracker outlives server versions; an unknown message must not cost
    // us the rest of the session.
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: traceBody([SESSION_START, { t: 250, o: 100, v: 'from the future' }]),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().summary.frames).toBe(1);
  });

  it('rejects a malformed trace with field-level problem details', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: { ...traceBody([SESSION_START]), url: 'not-a-url' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(Object.keys(response.json().errors)).toContain('url');
  });
});

describe('reading journey reports', () => {
  async function ingest(organisation?: string) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/traces',
      ...(organisation ? { headers: { 'x-accessly-organisation': organisation } } : {}),
      payload: traceBody([SESSION_START, { t: TraceMessageType.FocusMoved, o: 500, s: 'lost' }]),
    });
    return response.json();
  }

  it('returns a stored report by id', async () => {
    const created = await ingest();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/journey-reports/${created.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(created.id);
  });

  it('hides another organisation’s report', async () => {
    const created = await ingest();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/journey-reports/${created.id}`,
      headers: { 'x-accessly-organisation': OTHER_ORG },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lists reports newest first, scoped to the organisation', async () => {
    await ingest();
    harness.clock.advance(60_000);
    await ingest(OTHER_ORG);

    const response = await harness.app.inject({ method: 'GET', url: '/v1/journey-reports' });
    expect(response.json().items).toHaveLength(1);
  });

  it('keeps the raw trace as the evidence behind the report', async () => {
    await ingest();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/traces/trace-from-the-browser',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages).toHaveLength(2);
    expect(response.json().organisationId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('will not hand a trace to another organisation, even with the right id', async () => {
    await ingest();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/traces/trace-from-the-browser',
      headers: { 'x-accessly-organisation': OTHER_ORG },
    });

    // Trace ids come from the browser and are guessable in a way our uuids
    // are not, which is exactly why this is scoped at the lookup.
    expect(response.statusCode).toBe(404);
  });

  it('will not list reports for a journey belonging to someone else', async () => {
    const journeyId = (await createJourney(journeyBody, OTHER_ORG)).json().id;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/journeys/${journeyId}/reports`,
    });

    expect(response.statusCode).toBe(404);
  });
});
