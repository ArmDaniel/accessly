import type { MediaKind } from '@accessly/contracts';

/**
 * The format-neutral accessibility tree.
 *
 * This is the abstraction that lets one rule set audit a web page, a Word
 * document, a slide deck and an EPUB. Every format has *some* notion of
 * headings, images, tables and reading order; what differs is only how you dig
 * them out. So adapters do the digging and produce this, and rules written
 * against it never learn what a `<w:drawing>` or a PDF `/StructTreeRoot` is.
 *
 * Why a tree rather than a flat list: almost every interesting accessibility
 * question is relational. Does this heading have content under it? Is this cell
 * in a row that has a header? Is this image inside a figure that already
 * captions it? A flat list cannot answer any of those.
 *
 * The design constraint that keeps this honest is `unknowns`. An adapter that
 * cannot determine something says so, and the rules turn that into `cantTell`
 * rather than assuming absence means "not present". For a PDF with compressed
 * object streams, "I could not read the structure tree" and "there is no
 * structure tree" are completely different verdicts, and conflating them would
 * tell a customer their untagged PDF is fine.
 */

/**
 * Controlled role vocabulary.
 *
 * Deliberately ARIA-flavoured, because ARIA is the vocabulary the WCAG success
 * criteria are written against — which keeps the mapping from a rule to the
 * criterion it cites direct instead of interpretive. Formats map onto it:
 * a PowerPoint slide is a `slide`, a PDF page is a `page`, a Word `Heading 1`
 * paragraph is a `heading` with `level: 1`.
 */
export const NODE_ROLES = [
  'document',
  'page',
  'slide',
  'section',
  'heading',
  'paragraph',
  'list',
  'listitem',
  'table',
  'row',
  'cell',
  'columnheader',
  'rowheader',
  'image',
  'figure',
  'caption',
  'link',
  'form',
  'field',
  'button',
  'note',
  'code',
  'math',
  'quote',
  'video',
  'audio',
  'track',
  'cue',
  'artifact',
  'generic',
] as const;

export type NodeRole = (typeof NODE_ROLES)[number];

/** Where a node lives, in terms the reader of a report can act on. */
export interface NodeLocator {
  /**
   * A human-pointable path. A CSS selector for HTML, "Slide 4 › Title" for a
   * deck, "Page 12 › Figure 3" for a PDF. It has to be something a person can
   * find in the authoring tool, not an internal index.
   */
  readonly path: string;
  /** 1-based page or slide number, when the format has them. */
  readonly page?: number;
  /** Short excerpt for recognition in a printed report. */
  readonly snippet?: string;
}

export interface AccessibleNode {
  /** Unique within its tree. Adapters assign these; rules only compare them. */
  readonly id: string;
  readonly role: NodeRole;
  /** Accessible name: alt text, a label, a slide title. Null when absent. */
  readonly name: string | null;
  readonly description?: string | null;
  /** Textual content of this node alone, not its descendants. */
  readonly text?: string | null;
  /** Heading level, or nesting depth for lists. */
  readonly level?: number;
  readonly lang?: string | null;
  readonly locator: NodeLocator;
  /**
   * Format-specific facts a rule may consult, kept out of the core shape so
   * adding a format never changes this interface. Keys are documented by the
   * adapter that sets them.
   */
  readonly props: Readonly<Record<string, string | number | boolean | null>>;
  readonly children: readonly AccessibleNode[];
}

/**
 * Something the adapter could not determine.
 *
 * Carried on the tree rather than thrown away, so a rule can distinguish
 * "absent" from "unreadable" and report `cantTell` for the latter.
 */
export interface TreeUnknown {
  /** Machine-readable topic, e.g. `structure-tree`, `alt-text`, `reading-order`. */
  readonly topic: string;
  /** Written for the person reading the report. */
  readonly reason: string;
}

export interface AccessibleTree {
  readonly mediaKind: MediaKind;
  readonly title: string | null;
  readonly lang: string | null;
  readonly root: AccessibleNode;
  readonly unknowns: readonly TreeUnknown[];
  /** Adapter name and version, recorded in the report's methodology section. */
  readonly producer: string;
}

// ── Construction ─────────────────────────────────────────────────────────────

let counter = 0;

/** Fresh node id. Adapters may supply their own where the format has stable ids. */
export function nextNodeId(prefix = 'n'): string {
  counter += 1;
  return `${prefix}${counter}`;
}

/** Reset the id counter. Tests only — keeps snapshots stable across runs. */
export function resetNodeIds(): void {
  counter = 0;
}

export interface NodeInit {
  readonly role: NodeRole;
  readonly name?: string | null;
  readonly description?: string | null;
  readonly text?: string | null;
  readonly level?: number;
  readonly lang?: string | null;
  readonly locator: NodeLocator;
  readonly props?: Readonly<Record<string, string | number | boolean | null>>;
  readonly children?: readonly AccessibleNode[];
  readonly id?: string;
}

export function node(init: NodeInit): AccessibleNode {
  return {
    id: init.id ?? nextNodeId(),
    role: init.role,
    name: init.name ?? null,
    ...(init.description !== undefined ? { description: init.description } : {}),
    ...(init.text !== undefined ? { text: init.text } : {}),
    ...(init.level !== undefined ? { level: init.level } : {}),
    ...(init.lang !== undefined ? { lang: init.lang } : {}),
    locator: init.locator,
    props: init.props ?? {},
    children: init.children ?? [],
  };
}

// ── Traversal ────────────────────────────────────────────────────────────────

/**
 * Depth-first, document order — which is reading order for every format here.
 *
 * Iterative on purpose: a generator that recursed would overflow the stack on
 * a tree whose depth survived the adapters' own caps, and traversal is exactly
 * where an adversarial document would like to take us down.
 */
export function* walk(root: AccessibleNode): Generator<AccessibleNode> {
  const stack: AccessibleNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as AccessibleNode;
    yield current;
    // Push in reverse so the leftmost child is popped first.
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i] as AccessibleNode);
    }
  }
}

export function descendants(root: AccessibleNode): AccessibleNode[] {
  return [...walk(root)].slice(1);
}

export function findByRole(
  root: AccessibleNode,
  role: NodeRole | readonly NodeRole[],
): AccessibleNode[] {
  const roles = new Set<NodeRole>(Array.isArray(role) ? role : [role as NodeRole]);
  return [...walk(root)].filter((candidate) => roles.has(candidate.role));
}

/** Path from the root down to `target`, inclusive. Empty when not present. */
export function ancestry(root: AccessibleNode, target: AccessibleNode): AccessibleNode[] {
  // Iterative DFS with an explicit parent map; same reason as `walk`.
  const parentOfNode = new Map<AccessibleNode, AccessibleNode>();
  const stack: AccessibleNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as AccessibleNode;
    if (current.id === target.id) {
      const path: AccessibleNode[] = [current];
      let ancestor = parentOfNode.get(current);
      while (ancestor) {
        path.unshift(ancestor);
        ancestor = parentOfNode.get(ancestor);
      }
      return path;
    }
    for (const child of current.children) {
      parentOfNode.set(child, current);
      stack.push(child);
    }
  }
  return [];
}

export function parentOf(root: AccessibleNode, target: AccessibleNode): AccessibleNode | null {
  const path = ancestry(root, target);
  return path.length >= 2 ? (path[path.length - 2] as AccessibleNode) : null;
}

/** All text under a node, in reading order, normalised. */
export function textContent(root: AccessibleNode): string {
  const parts: string[] = [];
  for (const current of walk(root)) {
    if (current.text) parts.push(current.text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function countByRole(root: AccessibleNode): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const current of walk(root)) {
    counts[current.role] = (counts[current.role] ?? 0) + 1;
  }
  return counts;
}

/** Did the adapter fail to determine something about this topic? */
export function unknownAbout(tree: AccessibleTree, topic: string): TreeUnknown | undefined {
  return tree.unknowns.find((unknown) => unknown.topic === topic);
}
