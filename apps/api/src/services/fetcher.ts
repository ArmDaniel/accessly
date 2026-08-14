import { FetchFailedError } from '../domain/errors.js';
import { assertFetchableUrl, type UrlGuardOptions } from './url-guard.js';

export interface FetchedDocument {
  /** URL after redirects — what we actually audited. */
  readonly url: string;
  readonly html: string;
  readonly status: number;
  readonly contentType: string;
}

/**
 * Port for retrieving a page.
 *
 * Everything that audits a URL depends on this interface rather than on
 * `fetch`, which is what lets the watcher tests run a hundred simulated polls
 * without a network.
 */
export interface HtmlFetcher {
  fetch(url: string): Promise<FetchedDocument>;
}

export interface HttpFetcherOptions extends UrlGuardOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly userAgent?: string;
}

const DEFAULT_USER_AGENT =
  'Accessly/0.1 (+https://accessly.eu/bot; accessibility auditing on behalf of the site owner)';

export class HttpHtmlFetcher implements HtmlFetcher {
  /** Redirects are followed manually so every hop re-passes the SSRF guard. */
  static readonly MAX_REDIRECTS = 5;

  constructor(private readonly options: HttpFetcherOptions) {}

  async fetch(rawUrl: string): Promise<FetchedDocument> {
    /*
     * The timeout is a deadline over the *whole* exchange — connection, each
     * redirect hop and the body read. A timeout that only covers headers lets
     * a slow-dripping body hold the request (and its buffered bytes) open far
     * beyond the configured limit.
     */
    const deadline = Date.now() + this.options.timeoutMs;
    let current = await assertFetchableUrl(rawUrl, this.options);
    let response: Response | null = null;

    for (let hop = 0; hop <= HttpHtmlFetcher.MAX_REDIRECTS; hop += 1) {
      response = await this.#request(current, deadline);
      if (response.status < 300 || response.status > 399) break;

      const location = response.headers.get('location');
      if (!location) break; // Malformed redirect; treat as a normal response.

      /*
       * Re-validate every hop. A public URL that 302s to
       * http://169.254.169.254/ is the classic SSRF bypass, and
       * `redirect: 'follow'` would follow it blindly.
       */
      current = await assertFetchableUrl(new URL(location, current).toString(), this.options);

      if (hop === HttpHtmlFetcher.MAX_REDIRECTS) {
        throw new FetchFailedError(
          'That page redirects too many times.',
          `More than ${HttpHtmlFetcher.MAX_REDIRECTS} redirects were followed.`,
        );
      }
    }

    if (!response) throw new FetchFailedError('That page could not be retrieved.', 'No response.');

    if (!response.ok) {
      throw new FetchFailedError(
        'That page could not be retrieved.',
        `The server responded with HTTP ${response.status}.`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new FetchFailedError(
        'That URL is not an HTML page.',
        `The server returned content-type "${contentType}". Accessly audits HTML documents.`,
      );
    }

    // Trust the declared length when it is present, but still cap while reading:
    // content-length is a hint, not a promise.
    const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declared) && declared > this.options.maxBytes) {
      throw new FetchFailedError(
        'That page is too large to scan.',
        `The document is ${Math.round(declared / 1024)} KB; the limit is ${Math.round(this.options.maxBytes / 1024)} KB.`,
      );
    }

    const html = await this.#readCapped(response, deadline);

    return {
      url: response.url || current.toString(),
      html,
      status: response.status,
      contentType,
    };
  }

  /** One request attempt with the remaining budget; also reads nothing. */
  async #request(url: URL, deadline: number): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new FetchFailedError(
        'That page could not be retrieved.',
        `The page did not respond within ${this.options.timeoutMs / 1000} seconds.`,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    try {
      return await globalThis.fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': this.options.userAgent ?? DEFAULT_USER_AGENT,
        },
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError'
        ? `The page did not respond within ${this.options.timeoutMs / 1000} seconds.`
        : error instanceof Error
          ? error.message
          : 'Unknown network error.';
      throw new FetchFailedError('That page could not be retrieved.', reason);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Read the body, aborting if it exceeds the cap mid-stream or outlives the deadline. */
  async #readCapped(response: Response, deadline: number): Promise<string> {
    const body = response.body;
    if (!body) return '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > this.options.maxBytes) {
          await reader.cancel();
          throw new FetchFailedError(
            'That page is too large to scan.',
            `The document exceeds the ${Math.round(this.options.maxBytes / 1024)} KB limit.`,
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof FetchFailedError) throw error;
      const reason = error instanceof Error && error.name === 'AbortError'
        ? `The page did not finish sending within ${this.options.timeoutMs / 1000} seconds.`
        : error instanceof Error
          ? error.message
          : 'Unknown network error.';
      throw new FetchFailedError('That page could not be retrieved.', reason);
    } finally {
      clearTimeout(timeout);
    }

    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  }
}

/** Fetcher backed by a fixed map of URL → HTML. Used by tests and the watcher suite. */
export class StubHtmlFetcher implements HtmlFetcher {
  readonly #pages = new Map<string, string>();
  readonly calls: string[] = [];

  constructor(pages: Record<string, string> = {}) {
    for (const [url, html] of Object.entries(pages)) this.#pages.set(url, html);
  }

  set(url: string, html: string): void {
    this.#pages.set(url, html);
  }

  async fetch(url: string): Promise<FetchedDocument> {
    this.calls.push(url);
    const html = this.#pages.get(url);
    if (html === undefined) {
      throw new FetchFailedError('That page could not be retrieved.', `No stub registered for ${url}.`);
    }
    return { url, html, status: 200, contentType: 'text/html; charset=utf-8' };
  }
}
