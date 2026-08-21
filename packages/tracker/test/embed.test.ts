import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraceMessageType, type JourneyTrace } from '@accessly/contracts/journey.js';
import { install, readConfig, type EmbedHandle } from '../src/embed.js';

/**
 * The `<script>` tag layer.
 *
 * What matters here is not recording — that is covered in tracker.test.ts —
 * but the two things a customer installation gets wrong most often: reading its
 * own configuration, and delivering the trace at the moment the page goes away.
 */

let handle: EmbedHandle | null = null;

afterEach(() => {
  handle?.stop();
  handle = null;
  document.body.innerHTML = '';
  // Both markers, or a tag with no endpoint survives into the next test and
  // `locateScript` reads that one instead.
  document.head
    .querySelectorAll('script[data-accessly], script[data-endpoint]')
    .forEach((tag) => tag.remove());
  vi.unstubAllGlobals();
});

function withScript(attributes: Record<string, string>): void {
  const script = document.createElement('script');
  script.setAttribute('data-accessly', '');
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(`data-${name}`, value);
  }
  document.head.append(script);
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('reading configuration from the tag', () => {
  it('takes the endpoint, organisation and journey off the script element', () => {
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', 'https://api.accessly.test/v1/traces');
    script.setAttribute('data-organisation', 'org-1');
    script.setAttribute('data-journey', 'journey-1');

    expect(readConfig(script)).toMatchObject({
      endpoint: 'https://api.accessly.test/v1/traces',
      organisationId: 'org-1',
      journeyId: 'journey-1',
      autoStart: true,
    });
  });

  it('treats a missing or blank attribute as absent, not as an empty string', () => {
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', '   ');

    // An empty endpoint posted to would be a request to the current page.
    expect(readConfig(script).endpoint).toBeNull();
    expect(readConfig(null).endpoint).toBeNull();
  });

  it('refuses to let the page raise the message ceiling', () => {
    const script = document.createElement('script');
    script.setAttribute('data-max-messages', '999999');

    // The cap exists to keep a trace inside the browser's keepalive budget, so
    // it is a ceiling rather than a default.
    expect(readConfig(script).maxMessages).toBe(1000);
  });

  it('honours a lower message cap, and ignores nonsense', () => {
    const lower = document.createElement('script');
    lower.setAttribute('data-max-messages', '50');
    expect(readConfig(lower).maxMessages).toBe(50);

    const nonsense = document.createElement('script');
    nonsense.setAttribute('data-max-messages', 'lots');
    expect(readConfig(nonsense).maxMessages).toBe(1000);
  });

  it('allows opting out of auto-start', () => {
    const script = document.createElement('script');
    script.setAttribute('data-autostart', 'false');
    expect(readConfig(script).autoStart).toBe(false);
  });
});

describe('installing from a tag', () => {
  it('starts recording and finds its own configuration', () => {
    withScript({ endpoint: 'https://api.accessly.test/v1/traces', organisation: 'org-1' });
    handle = install();

    expect(handle.tracker.isRecording).toBe(true);
    expect(handle.config.organisationId).toBe('org-1');
    expect(handle.tracker.messages[0]?.t).toBe(TraceMessageType.SessionStart);
  });

  it('records without an endpoint, so it can be tried out from a console', () => {
    withScript({ accessly: '' });
    handle = install();

    expect(handle.tracker.isRecording).toBe(true);
    expect(handle.tracker.build().messages.length).toBeGreaterThan(0);
  });

  it('does not record when auto-start is off', () => {
    withScript({ endpoint: 'https://api.accessly.test/v1/traces', autostart: 'false' });
    handle = install();

    expect(handle.tracker.isRecording).toBe(false);
  });
});

describe('delivering the trace', () => {
  it('sends when the page is hidden, which is the only reliable signal on mobile', async () => {
    const sent: JourneyTrace[] = [];
    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    handle = install(document, { send: async (trace) => void sent.push(trace) });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(sent).toHaveLength(1);
  });

  it('sends on pagehide as the desktop backstop', async () => {
    const sent: JourneyTrace[] = [];
    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    handle = install(document, { send: async (trace) => void sent.push(trace) });

    window.dispatchEvent(new Event('pagehide'));
    await settle();

    expect(sent).toHaveLength(1);
  });

  it('sends once even when both lifecycle events fire', async () => {
    // Both routinely fire in one session; two posts would be two sessions as
    // far as the dashboard is concerned.
    const sent: JourneyTrace[] = [];
    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    handle = install(document, { send: async (trace) => void sent.push(trace) });

    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await handle.flush();
    await settle();

    expect(sent).toHaveLength(1);
  });

  it('ignores a visibilitychange back to visible', async () => {
    const sent: JourneyTrace[] = [];
    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    handle = install(document, { send: async (trace) => void sent.push(trace) });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(sent).toHaveLength(0);
  });

  it('stops listening for lifecycle events after stop()', async () => {
    const sent: JourneyTrace[] = [];
    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    const installed = install(document, { send: async (trace) => void sent.push(trace) });
    installed.stop();

    window.dispatchEvent(new Event('pagehide'));
    await settle();

    expect(sent).toHaveLength(0);
  });

  it('posts with keepalive and the tenant header', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    withScript({ endpoint: 'https://api.accessly.test/v1/traces', organisation: 'org-1' });
    handle = install();
    await handle.flush();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.accessly.test/v1/traces');
    // Without keepalive the request is cancelled with the document, which is
    // precisely when we need it to survive.
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)['x-accessly-organisation']).toBe('org-1');
  });

  it('never lets a failed delivery surface on the customer’s page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    handle = install();

    // A rejection here would become an unhandled rejection in somebody else's
    // console, and eventually in their error budget.
    await expect(handle.flush()).resolves.toBeUndefined();
  });
});

describe('honesty about truncation', () => {
  it('marks a trace that ran out of budget rather than looking complete', async () => {
    withScript({ endpoint: 'https://api.accessly.test/v1/traces', 'max-messages': '3' });
    handle = install();

    const button = document.createElement('button');
    button.textContent = 'Go';
    document.body.append(button);
    for (let i = 0; i < 20; i += 1) button.click();

    const trace = handle.tracker.build();
    expect(trace.messages).toHaveLength(3);
    // A session that ended and a recording that stopped look identical without
    // this flag, and they mean completely different things.
    expect(trace.truncated).toBe(true);
  });

  it('leaves the flag off a session that fitted', () => {
    withScript({ endpoint: 'https://api.accessly.test/v1/traces' });
    handle = install();

    expect(handle.tracker.build().truncated).toBeUndefined();
  });
});
