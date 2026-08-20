import {
  node,
  parseDocument,
  treeFromDocument,
  type AccessibleNode,
  type AccessibleTree,
  type TreeUnknown,
} from '@accessly/core';
import { attr, findAll, findFirst, parseXml } from './xml.js';
import { openArchive } from './zip.js';

/**
 * EPUB adapter.
 *
 * An EPUB is a ZIP of XHTML, which means the HTML adapter already knows how to
 * read its content — the only new work is the container: find the OPF package
 * document, read its metadata, follow the spine in reading order, and project
 * each chapter with the DOM adapter.
 *
 * Reusing the HTML path is the point. It is also the clearest demonstration
 * that the tree abstraction is doing real work: an e-book gets the full
 * structural rule set for free, and any improvement to the HTML projection
 * improves e-book auditing at the same time.
 *
 * EPUB Accessibility 1.1 additionally expects `schema:accessibilityFeature`
 * and friends in the metadata. Those are a publisher's *claim* about the book,
 * and a missing claim is a real defect in a distribution context — a retailer
 * cannot surface what the file does not declare.
 */

const A11Y_METADATA = [
  'schema:accessibilityFeature',
  'schema:accessibilitySummary',
  'schema:accessMode',
  'schema:accessibilityHazard',
] as const;

function resolveRelative(base: string, relative: string): string {
  if (relative.startsWith('/')) return relative.slice(1);
  const segments = base.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '.' || part.length === 0) continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

export function parseEpub(bytes: Uint8Array): AccessibleTree {
  // Chapters are XHTML (needed in full); fonts and images are skipped - they
  // are most of an e-book's bytes and nothing the structural rules read.
  const archive = openArchive(bytes, {
    include: (name) =>
      name === 'mimetype' ||
      name.startsWith('META-INF/') ||
      !/\.(jpe?g|png|gif|webp|svg|ttf|otf|woff2?|mp4|webm|mp3|css)$/i.test(name),
  });
  const unknowns: TreeUnknown[] = [];

  // The container points at the package document; its location is not fixed.
  const containerXml = archive.text('META-INF/container.xml');
  const container = containerXml ? parseXml(containerXml) : null;
  const rootfile = container ? findFirst(container, 'rootfile') : null;
  const opfPath = rootfile ? attr(rootfile, 'full-path') : null;

  const resolvedOpfPath =
    opfPath ?? archive.match((path) => path.endsWith('.opf'))[0] ?? null;

  if (!resolvedOpfPath) {
    return {
      mediaKind: 'epub',
      title: null,
      lang: null,
      root: node({ role: 'document', name: null, locator: { path: 'Book' }, props: {} }),
      unknowns: [
        { topic: 'structure-tree', reason: 'No package document (.opf) was found in the archive.' },
      ],
      producer: 'accessly-epub-adapter/1',
    };
  }

  const opfXml = archive.text(resolvedOpfPath);
  const opf = opfXml ? parseXml(opfXml) : null;

  if (!opf) {
    return {
      mediaKind: 'epub',
      title: null,
      lang: null,
      root: node({ role: 'document', name: null, locator: { path: 'Book' }, props: {} }),
      unknowns: [
        { topic: 'structure-tree', reason: 'The package document could not be parsed.' },
      ],
      producer: 'accessly-epub-adapter/1',
    };
  }

  const title = findFirst(opf, 'title')?.text?.trim() ?? null;
  const lang = findFirst(opf, 'language')?.text?.trim() ?? null;

  // Accessibility metadata lives in <meta property="schema:..."> elements.
  const declaredMetadata = new Set(
    findAll(opf, 'meta')
      .map((meta) => attr(meta, 'property'))
      .filter((property): property is string => property !== null),
  );
  const missingMetadata = A11Y_METADATA.filter((key) => !declaredMetadata.has(key));

  if (missingMetadata.length > 0) {
    unknowns.push({
      topic: 'a11y-metadata',
      reason: `The package document does not declare ${missingMetadata.join(', ')}. EPUB Accessibility 1.1 expects these so retailers and libraries can surface what the book supports.`,
    });
  }

  if (archive.truncated) {
    unknowns.push({
      topic: 'archive-truncated',
      reason: 'The archive expands beyond Accessly\u2019s size limits, so some parts were not read.',
    });
  }

  // Manifest maps ids to files; the spine gives reading order.
  const manifest = new Map<string, { href: string; mediaType: string | null }>();
  for (const item of findAll(opf, 'item')) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (!id || !href) continue;
    manifest.set(id, { href, mediaType: attr(item, 'media-type') });
  }

  const spine = findAll(opf, 'itemref')
    .map((ref) => attr(ref, 'idref'))
    .filter((id): id is string => id !== null);

  const chapters: AccessibleNode[] = [];
  let parsedChapters = 0;

  for (const [index, id] of spine.entries()) {
    const entry = manifest.get(id);
    if (!entry) continue;

    /*
     * OPF hrefs are URIs and archive entry names are raw paths, so a chapter
     * with a space in its filename is written `my%20chapter.xhtml` in the
     * package document. Without decoding, every such book reports all its
     * chapters as "missing from the archive".
     */
    const decodedHref = (() => {
      try {
        return decodeURIComponent(entry.href);
      } catch {
        // A malformed escape sequence; keep the raw form.
        return entry.href;
      }
    })();

    const path = resolveRelative(resolvedOpfPath, decodedHref);
    const xhtml = archive.text(path);
    if (!xhtml) {
      unknowns.push({
        topic: 'structure-tree',
        reason: `Chapter ${index + 1} (${entry.href}) is listed in the spine but missing from the archive.`,
      });
      continue;
    }

    /*
     * The HTML adapter does the real work. Chapters come back as `document`
     * roots, so they are re-labelled as sections and their locators prefixed
     * with the chapter, keeping every finding pointable. A chapter that fails
     * to parse degrades to an unknown like every other unreadable part -
     * one bad file must not cost the customer the whole book.
     */
    let chapterTree: ReturnType<typeof treeFromDocument> | null = null;
    try {
      chapterTree = treeFromDocument(parseDocument(xhtml).document);
    } catch {
      chapterTree = null;
    }
    if (!chapterTree) {
      unknowns.push({
        topic: 'structure-tree',
        reason: `Chapter ${index + 1} (${entry.href}) could not be parsed as XHTML.`,
      });
      continue;
    }
    parsedChapters += 1;

    chapters.push(
      node({
        role: 'section',
        name: chapterTree.title ?? entry.href,
        ...(chapterTree.lang ? { lang: chapterTree.lang } : {}),
        locator: { path: `Chapter ${index + 1} (${entry.href})`, page: index + 1 },
        props: { source: 'epub', href: entry.href },
        children: chapterTree.root.children.map((child) =>
          prefixLocator(child, `Chapter ${index + 1}`, index + 1),
        ),
      }),
    );
  }

  if (spine.length === 0) {
    unknowns.push({
      topic: 'reading-order',
      reason: 'The package document declares no spine, so the reading order of the book is undefined.',
    });
  }

  if (!lang) {
    unknowns.push({
      topic: 'language',
      reason: 'The package document declares no dc:language.',
    });
  }

  return {
    mediaKind: 'epub',
    title,
    lang,
    root: node({
      role: 'document',
      name: title,
      ...(lang ? { lang } : {}),
      locator: { path: 'Book' },
      props: {
        source: 'epub',
        chapters: parsedChapters,
        declaresA11yMetadata: missingMetadata.length === 0,
      },
      children: chapters,
    }),
    unknowns,
    producer: 'accessly-epub-adapter/1',
  };
}

/** Re-root a chapter's locators so findings name the chapter they are in. */
function prefixLocator(target: AccessibleNode, prefix: string, page: number): AccessibleNode {
  // Iterative: an e-book chapter is ordinary HTML depth, but this runs over
  // untrusted content and recursion here would be a stack-overflow handle.
  // Nodes are immutable once published, so each is rebuilt into a mutable
  // shell first and the children attached afterwards.
  type MutableNode = { -readonly [K in keyof AccessibleNode]: AccessibleNode[K] };
  const withPrefix = (path: string): string => `${prefix} \u203a ${path}`;
  const rebuilt = {
    ...target,
    locator: { ...target.locator, path: withPrefix(target.locator.path), page },
    children: [] as AccessibleNode[],
  } as MutableNode;
  const queue: Array<{ from: AccessibleNode; to: MutableNode }> = [
    { from: target, to: rebuilt },
  ];
  while (queue.length > 0) {
    const { from, to } = queue.pop() as { from: AccessibleNode; to: MutableNode };
    to.children = from.children.map((child) => {
      const clone = {
        ...child,
        locator: { ...child.locator, path: withPrefix(child.locator.path), page },
        children: [] as AccessibleNode[],
      } as MutableNode;
      queue.push({ from: child, to: clone });
      return clone as AccessibleNode;
    });
  }
  return rebuilt as AccessibleNode;
}
