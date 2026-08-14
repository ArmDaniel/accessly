/**
 * The slice of ARIA in HTML / HTML-AAM that our rules depend on.
 *
 * Scope note: this is not a full implementation of the accessibility tree. It
 * covers implicit roles for the elements that appear in real page markup and
 * the state queries our rules need. Where it cannot decide, callers must report
 * `cantTell` rather than assume.
 *
 * https://www.w3.org/TR/html-aam-1.0/
 * https://www.w3.org/TR/wai-aria-1.2/
 */

/** Elements whose implicit role does not depend on their attributes. */
const STATIC_IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  article: 'article',
  aside: 'complementary',
  button: 'button',
  datalist: 'listbox',
  dd: 'definition',
  details: 'group',
  dialog: 'dialog',
  dt: 'term',
  fieldset: 'group',
  figure: 'figure',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hr: 'separator',
  html: 'document',
  li: 'listitem',
  main: 'main',
  math: 'math',
  menu: 'list',
  meter: 'meter',
  nav: 'navigation',
  ol: 'list',
  optgroup: 'group',
  option: 'option',
  output: 'status',
  progress: 'progressbar',
  search: 'search',
  summary: 'button',
  table: 'table',
  tbody: 'rowgroup',
  td: 'cell',
  textarea: 'textbox',
  tfoot: 'rowgroup',
  th: 'columnheader',
  thead: 'rowgroup',
  tr: 'row',
  ul: 'list',
};

/** `<input type>` → implicit role. Types absent here have no mapped role. */
const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: 'button',
  checkbox: 'checkbox',
  email: 'textbox',
  image: 'button',
  number: 'spinbutton',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  url: 'textbox',
};

export function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
}

export function inputType(element: Element): string {
  return (element.getAttribute('type') ?? 'text').trim().toLowerCase();
}

/** The role the element has before any `role` attribute is applied. */
export function implicitRole(element: Element): string | null {
  const tag = tagOf(element);

  if (tag === 'a' || tag === 'area') {
    return element.hasAttribute('href') ? 'link' : 'generic';
  }
  if (tag === 'img') {
    // alt="" is the author explicitly marking the image decorative.
    const alt = element.getAttribute('alt');
    return alt !== null && alt.trim() === '' ? 'presentation' : 'img';
  }
  if (tag === 'input') {
    if (inputType(element) === 'hidden') return null;
    return INPUT_ROLES[inputType(element)] ?? null;
  }
  if (tag === 'select') {
    const multiple = element.hasAttribute('multiple');
    const size = Number(element.getAttribute('size') ?? '0');
    return multiple || size > 1 ? 'listbox' : 'combobox';
  }
  if (tag === 'section') {
    // Only a named section maps to `region`.
    return hasAccessibleNameAttribute(element) ? 'region' : 'generic';
  }
  if (tag === 'header' || tag === 'footer') {
    // Scoped to the body, these are landmarks; inside sectioning content they
    // are generic. https://www.w3.org/TR/html-aam-1.0/#el-header
    return isScopedToBody(element) ? (tag === 'header' ? 'banner' : 'contentinfo') : 'generic';
  }

  return STATIC_IMPLICIT_ROLES[tag] ?? null;
}

function hasAccessibleNameAttribute(element: Element): boolean {
  return (
    (element.getAttribute('aria-label') ?? '').trim().length > 0 ||
    (element.getAttribute('aria-labelledby') ?? '').trim().length > 0
  );
}

const SECTIONING_CONTENT = new Set(['article', 'aside', 'nav', 'section', 'main']);

function isScopedToBody(element: Element): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (SECTIONING_CONTENT.has(tagOf(parent))) return false;
    parent = parent.parentElement;
  }
  return true;
}

/** Effective role: an explicit, non-abstract `role` wins over the implicit one. */
export function computeRole(element: Element): string | null {
  const explicit = (element.getAttribute('role') ?? '').trim().toLowerCase();
  if (explicit.length > 0) {
    // role accepts a token list; the first valid token is used.
    const first = explicit.split(/\s+/)[0];
    if (first && first.length > 0) return first;
  }
  return implicitRole(element);
}

/**
 * Removed from the accessibility tree entirely.
 *
 * We check `hidden`, `aria-hidden`, `display:none`/`visibility:hidden` declared
 * inline, and `<input type=hidden>`. We cannot see stylesheet-driven hiding
 * without layout, so this is deliberately conservative: it is better to check
 * an element that is actually hidden (and be told so) than to skip a visible
 * one.
 */
export function isHiddenFromAccessibilityTree(element: Element): boolean {
  let current: Element | null = element;
  while (current && current.nodeType === 1) {
    if (current.hasAttribute('hidden')) return true;
    if ((current.getAttribute('aria-hidden') ?? '').trim() === 'true') return true;
    if (tagOf(current) === 'input' && inputType(current) === 'hidden') return true;

    const style = (current.getAttribute('style') ?? '').toLowerCase();
    if (/display\s*:\s*none/.test(style)) return true;
    if (/visibility\s*:\s*hidden/.test(style)) return true;

    current = current.parentElement;
  }
  return false;
}

/**
 * In the accessibility tree and therefore worth examining.
 *
 * Rules need this predicate constantly, so it lives next to its inverse rather
 * than being re-derived (with slight divergences) in every rule file.
 */
export function isVisible(element: Element): boolean {
  return !isHiddenFromAccessibilityTree(element);
}

const NATIVELY_FOCUSABLE = new Set(['a', 'area', 'button', 'input', 'select', 'textarea', 'summary']);

/** Can the element receive keyboard focus in the normal tab sequence? */
export function isFocusable(element: Element): boolean {
  if (element.hasAttribute('disabled')) return false;
  if (isHiddenFromAccessibilityTree(element)) return false;

  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null) {
    const parsed = Number.parseInt(tabindex, 10);
    return Number.isFinite(parsed) && parsed >= 0;
  }

  const tag = tagOf(element);
  if (tag === 'a' || tag === 'area') return element.hasAttribute('href');
  if (tag === 'input' && inputType(element) === 'hidden') return false;
  if (element.hasAttribute('contenteditable')) return true;

  return NATIVELY_FOCUSABLE.has(tag);
}

/** Roles that behave as interactive controls and therefore need a name. */
export const WIDGET_ROLES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
]);

/** Form controls that carry a user-supplied value and therefore need a label. */
export const LABELLABLE_TAGS: ReadonlySet<string> = new Set([
  'input',
  'select',
  'textarea',
  'meter',
  'progress',
  'output',
]);

/** `<input>` types that are labelled by their own `value`, not an external label. */
export const SELF_LABELLING_INPUT_TYPES: ReadonlySet<string> = new Set([
  'submit',
  'reset',
  'button',
  'hidden',
  'image',
]);
