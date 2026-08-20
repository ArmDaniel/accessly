import { accessibleName } from '../dom/accname.js';
import { computeRole, isHiddenFromAccessibilityTree, tagOf } from '../dom/aria.js';
import { cssPath, snippet } from '../dom/selector.js';
import { node, resetNodeIds, type AccessibleNode, type AccessibleTree, type NodeRole } from './node.js';

/**
 * Project a DOM into the format-neutral tree.
 *
 * HTML is the one format where we have both surfaces, and both are worth
 * having. The DOM rules stay precise about things only HTML has — computed
 * contrast, ARIA states, focus order — while the tree rules check the
 * structural questions that are identical whether the content is a web page or
 * a Word document.
 *
 * The projection is lossy on purpose. It keeps document structure and drops
 * presentation, because that is exactly the part a slide deck and a web page
 * have in common.
 */

const ROLE_MAP: Readonly<Record<string, NodeRole>> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  ul: 'list',
  ol: 'list',
  dl: 'list',
  li: 'listitem',
  dt: 'listitem',
  dd: 'listitem',
  table: 'table',
  tr: 'row',
  td: 'cell',
  th: 'columnheader',
  img: 'image',
  svg: 'image',
  figure: 'figure',
  figcaption: 'caption',
  caption: 'caption',
  a: 'link',
  form: 'form',
  input: 'field',
  select: 'field',
  textarea: 'field',
  button: 'button',
  code: 'code',
  pre: 'code',
  math: 'math',
  blockquote: 'quote',
  video: 'video',
  audio: 'audio',
  track: 'track',
  section: 'section',
  article: 'section',
  main: 'section',
  aside: 'section',
  nav: 'section',
  header: 'section',
  footer: 'section',
};

/** Elements that carry no structural meaning worth projecting. */
const SKIP_TAGS = new Set(['script', 'style', 'template', 'link', 'meta', 'noscript', 'br', 'wbr']);

/**
 * Maximum projected DOM depth.
 *
 * The projection recurses per nesting level, and a hostile (or merely
 * machine-generated) page can nest tens of thousands of elements. The cap
 * keeps the audit's own machinery from overflowing the stack: deeper content
 * is simply not projected, and the DOM rules - which iterate, not recurse -
 * still see the full document.
 */
const MAX_DEPTH = 200;

/** Longest href retained on a node. Report-usable, not a URL database. */
const MAX_HREF_LENGTH = 300;

function roleFor(element: Element): NodeRole {
  const tag = tagOf(element);
  const explicit = (element.getAttribute('role') ?? '').trim().toLowerCase();

  if (explicit === 'heading') return 'heading';
  if (explicit === 'img') return 'image';
  if (explicit === 'presentation' || explicit === 'none') return 'artifact';
  if (explicit === 'columnheader') return 'columnheader';
  if (explicit === 'rowheader') return 'rowheader';

  if (tag === 'th') {
    const scope = (element.getAttribute('scope') ?? '').toLowerCase();
    return scope === 'row' ? 'rowheader' : 'columnheader';
  }

  return ROLE_MAP[tag] ?? 'generic';
}

function levelFor(element: Element): number | undefined {
  const tag = tagOf(element);
  if (/^h[1-6]$/.test(tag)) return Number.parseInt(tag.slice(1), 10);
  const aria = Number.parseInt(element.getAttribute('aria-level') ?? '', 10);
  return Number.isFinite(aria) ? aria : undefined;
}

/** Direct text of an element, excluding descendants' text. */
function ownText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((child) => child.nodeType === 3)
    .map((child) => child.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function project(element: Element, depth = 0): AccessibleNode | null {
  const tag = tagOf(element);
  if (SKIP_TAGS.has(tag)) return null;

  // Hidden content is not part of the accessibility tree by definition, and a
  // rule that reports on it produces findings the user cannot even locate.
  if (isHiddenFromAccessibilityTree(element)) return null;

  if (depth >= MAX_DEPTH) return null;

  const children = Array.from(element.children)
    .map((child) => project(child, depth + 1))
    .filter((child): child is AccessibleNode => child !== null);

  const role = roleFor(element);
  const name = accessibleName(element).value;
  const text = ownText(element);
  const level = levelFor(element);
  const lang = element.getAttribute('lang');

  /*
   * A `generic` node with nothing of its own is pure plumbing — a layout div.
   * Collapsing it keeps the tree shallow enough that "is this image inside a
   * figure" stays a cheap, readable question instead of a deep walk.
   */
  if (role === 'generic' && name.length === 0 && text.length === 0 && !lang) {
    if (children.length === 1) return children[0] as AccessibleNode;
    if (children.length === 0) return null;
  }

  return node({
    role,
    name: name.length > 0 ? name : null,
    ...(text.length > 0 ? { text } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(lang ? { lang } : {}),
    locator: {
      path: cssPath(element),
      snippet: snippet(element, 120),
    },
    props: {
      tag,
      ...(tag === 'img' ? { hasAltAttribute: element.hasAttribute('alt') } : {}),
      ...(tag === 'a'
        ? { href: (element.getAttribute('href') ?? '').slice(0, MAX_HREF_LENGTH) }
        : {}),
      ...(tag === 'track' ? { kind: element.getAttribute('kind') ?? 'subtitles' } : {}),
      ...(role === 'columnheader' || role === 'rowheader'
        ? { scope: element.getAttribute('scope') }
        : {}),
      ...(computeRole(element) ? { ariaRole: computeRole(element) } : {}),
    },
    children,
  });
}

export interface DomTreeOptions {
  /** Reset node ids first, so tests get deterministic output. */
  readonly deterministicIds?: boolean;
}

export function treeFromDocument(
  document: Document,
  options: DomTreeOptions = {},
): AccessibleTree {
  if (options.deterministicIds) resetNodeIds();

  const root = document.documentElement as Element | null;
  const body = (() => {
    try {
      return (document.body as Element | null) ?? null;
    } catch {
      return null;
    }
  })();

  const title = document.querySelector('title')?.textContent?.trim() ?? null;
  const lang = root?.getAttribute('lang')?.trim() ?? null;

  const children = body
    ? Array.from(body.children)
        .map((child) => project(child, 1))
        .filter((child): child is AccessibleNode => child !== null)
    : [];

  return {
    mediaKind: 'html',
    title: title && title.length > 0 ? title : null,
    lang: lang && lang.length > 0 ? lang : null,
    root: node({
      role: 'document',
      name: title ?? null,
      ...(lang ? { lang } : {}),
      locator: { path: 'html' },
      props: {},
      children,
    }),
    unknowns: [],
    producer: 'accessly-dom-adapter/1',
  };
}
