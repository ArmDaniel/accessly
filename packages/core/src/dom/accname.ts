import { inputType, isHiddenFromAccessibilityTree, tagOf } from './aria.js';

/**
 * Accessible Name computation, following the ordering of Accessible Name and
 * Description Computation 1.2 (§4.3.  Text Alternative Computation).
 * https://www.w3.org/TR/accname-1.2/
 *
 * Implemented steps: 2A (hidden), 2B (aria-labelledby), 2C (aria-label),
 * 2D (native host-language labelling), 2F (name from content),
 * 2I (tooltip / title).  Steps that require CSS (2F's `::before`/`::after`
 * pseudo-element text) are out of reach without layout and are documented as
 * such — a rule that depends on them must return `cantTell`.
 */

export interface AccessibleName {
  readonly value: string;
  /** Which step produced the name, for explaining the finding to the user. */
  readonly source:
    | 'aria-labelledby'
    | 'aria-label'
    | 'native-label'
    | 'alt'
    | 'value'
    | 'legend'
    | 'caption'
    | 'content'
    | 'title'
    | 'none';
}

const EMPTY: AccessibleName = { value: '', source: 'none' };

function normalise(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Resolve an IDREF list against the document, dropping ids that do not exist. */
function resolveIdRefs(element: Element, attribute: string): Element[] {
  const raw = element.getAttribute(attribute);
  if (!raw) return [];
  const doc = element.ownerDocument;
  if (!doc) return [];

  return raw
    .split(/\s+/)
    .filter((id) => id.length > 0)
    .map((id) => doc.getElementById(id) as Element | null)
    .filter((el): el is Element => el !== null);
}

/**
 * Text from a subtree, used by step 2F.
 *
 * `visited` guards the recursion: `aria-labelledby` can point at an element
 * that points back, and the spec requires we do not loop.
 */
function textFromContent(element: Element, visited: Set<Element>): string {
  if (visited.has(element)) return '';
  visited.add(element);

  const parts: string[] = [];

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
      continue;
    }
    if (node.nodeType !== 1) continue;

    const child = node as Element;
    if (isHiddenFromAccessibilityTree(child)) continue;

    // A labelled descendant contributes its name, not its raw text.
    const childName = computeName(child, visited, true);
    parts.push(childName.value.length > 0 ? childName.value : textFromContent(child, visited));
  }

  return normalise(parts.join(' '));
}

/** Native labelling per HTML-AAM, for the elements our rules care about. */
function nativeLabel(element: Element, visited: Set<Element>): AccessibleName {
  const tag = tagOf(element);
  const doc = element.ownerDocument;

  if (tag === 'img' || (tag === 'input' && inputType(element) === 'image')) {
    const alt = element.getAttribute('alt');
    if (alt !== null) {
      // alt="" is a valid, intentional empty name (decorative image).
      return { value: normalise(alt), source: 'alt' };
    }
  }

  if (tag === 'input') {
    const type = inputType(element);
    if (type === 'submit' || type === 'reset' || type === 'button') {
      const value = element.getAttribute('value');
      if (value !== null && normalise(value).length > 0) {
        return { value: normalise(value), source: 'value' };
      }
      // Submit and reset have UA-supplied default names.
      if (type === 'submit') return { value: 'Submit', source: 'value' };
      if (type === 'reset') return { value: 'Reset', source: 'value' };
    }
  }

  // <label for> and wrapping <label>.
  if (['input', 'select', 'textarea', 'meter', 'progress', 'output'].includes(tag)) {
    const id = element.getAttribute('id');
    if (id && doc) {
      const explicit = Array.from(doc.querySelectorAll('label[for]')).filter(
        (label) => label.getAttribute('for') === id,
      );
      const text = normalise(explicit.map((l) => textFromContent(l, visited)).join(' '));
      if (text.length > 0) return { value: text, source: 'native-label' };
    }

    const wrapping = element.closest?.('label');
    if (wrapping) {
      const text = textFromContent(wrapping, visited);
      if (text.length > 0) return { value: text, source: 'native-label' };
    }
  }

  if (tag === 'fieldset') {
    const legend = element.querySelector(':scope > legend') ?? element.querySelector('legend');
    if (legend) {
      const text = textFromContent(legend, visited);
      if (text.length > 0) return { value: text, source: 'legend' };
    }
  }

  if (tag === 'table') {
    const caption = element.querySelector('caption');
    if (caption) {
      const text = textFromContent(caption, visited);
      if (text.length > 0) return { value: text, source: 'caption' };
    }
  }

  if (tag === 'figure') {
    const figcaption = element.querySelector('figcaption');
    if (figcaption) {
      const text = textFromContent(figcaption, visited);
      if (text.length > 0) return { value: text, source: 'caption' };
    }
  }

  if (tag === 'svg') {
    const title = element.querySelector('title');
    if (title) {
      const text = normalise(title.textContent);
      if (text.length > 0) return { value: text, source: 'title' };
    }
  }

  return EMPTY;
}

/** Roles whose name may come from their own content (accname step 2F). */
const NAME_FROM_CONTENT_TAGS = new Set([
  'a',
  'button',
  'summary',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'td',
  'th',
  'legend',
  'label',
  'option',
  'caption',
  'figcaption',
]);

const NAME_FROM_CONTENT_ROLES = new Set([
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'gridcell',
  'heading',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'row',
  'rowheader',
  'switch',
  'tab',
  'tooltip',
  'treeitem',
]);

function allowsNameFromContent(element: Element): boolean {
  const explicitRole = (element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0];
  if (explicitRole) return NAME_FROM_CONTENT_ROLES.has(explicitRole);
  return NAME_FROM_CONTENT_TAGS.has(tagOf(element));
}

function computeName(
  element: Element,
  visited: Set<Element>,
  /** True when we are recursing from a parent's name computation. */
  isDescendant: boolean,
): AccessibleName {
  // Step 2A — hidden and not referenced.
  if (!isDescendant && isHiddenFromAccessibilityTree(element)) return EMPTY;

  // Step 2B — aria-labelledby. Skipped while recursing, per the spec, to avoid
  // an element's label being recomputed through itself.
  if (!visited.has(element)) {
    const refs = resolveIdRefs(element, 'aria-labelledby');
    if (refs.length > 0) {
      const next = new Set(visited);
      next.add(element);
      const text = normalise(
        refs
          .map((ref) => {
            const own = computeName(ref, next, true);
            return own.value.length > 0 ? own.value : textFromContent(ref, next);
          })
          .join(' '),
      );
      if (text.length > 0) return { value: text, source: 'aria-labelledby' };
    }
  }

  // Step 2C — aria-label.
  const ariaLabel = normalise(element.getAttribute('aria-label'));
  if (ariaLabel.length > 0) return { value: ariaLabel, source: 'aria-label' };

  // Step 2D — host-language labelling.
  const native = nativeLabel(element, visited);
  if (native.source !== 'none') return native;

  // Step 2F — name from content.
  if (allowsNameFromContent(element) || isDescendant) {
    const text = textFromContent(element, new Set(visited));
    if (text.length > 0) return { value: text, source: 'content' };
  }

  // Step 2I — tooltip.
  const title = normalise(element.getAttribute('title'));
  if (title.length > 0) return { value: title, source: 'title' };

  return EMPTY;
}

/** Compute the accessible name of an element. */
export function accessibleName(element: Element): AccessibleName {
  return computeName(element, new Set(), false);
}

/** Accessible description — `aria-describedby`, falling back to `title`. */
export function accessibleDescription(element: Element): string {
  const refs = resolveIdRefs(element, 'aria-describedby');
  if (refs.length > 0) {
    const text = normalise(refs.map((r) => r.textContent ?? '').join(' '));
    if (text.length > 0) return text;
  }
  // `title` only becomes the description when it did not become the name.
  const name = accessibleName(element);
  if (name.source !== 'title') {
    return normalise(element.getAttribute('title'));
  }
  return '';
}

/** Visible text of an element, normalised. Used by 2.5.3 Label in Name. */
export function visibleText(element: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
    } else if (node.nodeType === 1) {
      const child = node as Element;
      if (!isHiddenFromAccessibilityTree(child)) parts.push(visibleText(child));
    }
  }
  return normalise(parts.join(' '));
}
