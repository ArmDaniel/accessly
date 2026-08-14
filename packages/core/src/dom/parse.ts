import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';

/**
 * A parsed document plus the metadata rules and the watcher need about it.
 *
 * We parse with linkedom rather than jsdom on purpose: rules must never depend
 * on script execution or layout. Everything Accessly reports is derived from
 * the markup as served, which is what makes a finding reproducible and what
 * makes the content hash meaningful to the watcher.
 */
export interface ParsedDocument {
  readonly document: Document;
  readonly html: string;
  readonly byteLength: number;
  /** SHA-256 over the normalised markup. Stable across insignificant whitespace. */
  readonly contentHash: string;
  readonly title: string | null;
  readonly lang: string | null;
}

/**
 * Normalise before hashing so that a redeploy which only reflows whitespace
 * does not read as "the customer changed something" and burn an audit.
 *
 * We do not strip comments or attribute order — both can carry real meaning
 * (conditional comments, and attribute order affects nothing but is cheap to
 * keep honest about).
 */
export function normaliseForHash(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function hashContent(html: string): string {
  return createHash('sha256').update(normaliseForHash(html), 'utf8').digest('hex');
}

/**
 * Read `document.body` without assuming there is one.
 *
 * A document parsed from an empty or badly truncated string can have a null
 * `documentElement`, and in that state the `body` getter itself throws rather
 * than returning null — so `if (document.body)` is not a safe guard. Rules must
 * use this instead.
 */
export function safeBody(document: Document): Element | null {
  try {
    return (document.body as Element | null) ?? null;
  } catch {
    return null;
  }
}

export function parseDocument(html: string): ParsedDocument {
  // linkedom's Document is structurally compatible with the subset of the DOM
  // the rules use (querySelector*, attributes, traversal) but is not nominally
  // the lib.dom type. One cast here keeps every rule written against standard
  // DOM types instead of a parser-specific API.
  const { document } = parseHTML(html) as unknown as { document: Document };

  const root = document.documentElement as Element | null;
  const titleEl = document.querySelector('title');
  const title = titleEl?.textContent?.trim() ?? null;
  const lang = root?.getAttribute('lang')?.trim() ?? null;

  return {
    document,
    html,
    byteLength: Buffer.byteLength(html, 'utf8'),
    contentHash: hashContent(html),
    title: title && title.length > 0 ? title : null,
    lang: lang && lang.length > 0 ? lang : null,
  };
}
