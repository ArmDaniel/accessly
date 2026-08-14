import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenTargetError } from '../src/domain/errors.js';
import { HttpHtmlFetcher } from '../src/services/fetcher.js';

/**
 * SSRF redirect handling.
 *
 * The URL guard checks the *initial* URL; a public URL that redirects to a
 * private address is the classic bypass. These tests pin a fake network so the
 * whole hop chain runs against the guard, not just the first request.
 */

const PUBLIC = '93.184.216.34';

function htmlResponse(body = '<html lang="en"><body><main>ok</main></body></html>'): Response {
  // The fetcher falls back to the tracked request URL when `response.url` is
  // empty, which a constructed Response always is.
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

describe('HttpHtmlFetcher redirects', () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function fetcher(): HttpHtmlFetcher {
    return new HttpHtmlFetcher({
      maxBytes: 1024 * 1024,
      timeoutMs: 5000,
      blockPrivateHosts: true,
      resolve: async (hostname) => {
        // Everything resolves publicly unless the test says otherwise.
        if (hostname === 'dns-rebind.test') return [PUBLIC];
        return [PUBLIC];
      },
    });
  }

  it('follows a same-origin redirect chain to a public page', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://start.test/') {
        return new Response(null, { status: 302, headers: { location: 'https://mid.test/hop' } });
      }
      return htmlResponse();
    }) as typeof fetch;

    const doc = await fetcher().fetch('https://start.test/');
    expect(doc.status).toBe(200);
    expect(doc.html).toContain('main');
    expect(calls).toEqual(['https://start.test/', 'https://mid.test/hop']);
  });

  it('refuses a redirect to a link-local address', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://start.test/') {
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      }
      return htmlResponse();
    }) as typeof fetch;

    await expect(fetcher().fetch('https://start.test/')).rejects.toThrow(ForbiddenTargetError);
  });

  it('refuses a redirect to a loopback address even after several hops', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://start.test/') {
        return new Response(null, { status: 301, headers: { location: 'https://hop2.test/' } });
      }
      if (url === 'https://hop2.test/') {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } });
      }
      return htmlResponse();
    }) as typeof fetch;

    await expect(fetcher().fetch('https://start.test/')).rejects.toThrow(ForbiddenTargetError);
  });

  it('refuses a relative redirect that resolves to a private address', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://start.test/') {
        // Relative against the current origin — still the same host, fine.
        return new Response(null, { status: 302, headers: { location: '/next' } });
      }
      if (url === 'https://start.test/next') {
        return new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/internal' } });
      }
      return htmlResponse();
    }) as typeof fetch;

    await expect(fetcher().fetch('https://start.test/')).rejects.toThrow(ForbiddenTargetError);
  });

  it('gives up after too many redirects', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(null, { status: 302, headers: { location: `${url}x` } });
    }) as typeof fetch;

    await expect(fetcher().fetch('https://start.test/')).rejects.toThrow(/redirect/i);
  });

  it('still rejects a non-HTML final response', async () => {
    globalThis.fetch = (async () =>
      new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    await expect(fetcher().fetch('https://start.test/')).rejects.toThrow(/not an HTML page/i);
  });
});
