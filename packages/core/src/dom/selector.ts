/**
 * Producing a selector a human can paste into devtools, and that is stable
 * enough for the watcher to match "the same element" across two audits.
 */

const ID_SAFE = /^[A-Za-z][\w-]*$/;

function escapeIdent(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1');
}

function nthOfType(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  let index = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName === element.tagName) {
      index += 1;
      if (child === element) return index;
    }
  }
  return index;
}

function segmentFor(element: Element): string {
  const tag = element.tagName.toLowerCase();

  const id = element.getAttribute('id');
  if (id && ID_SAFE.test(id)) {
    return `${tag}#${id}`;
  }

  // A class is only useful in a selector if it narrows the result. We keep at
  // most two so the selector stays readable in a printed report.
  const classes = (element.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((c) => c.length > 0 && ID_SAFE.test(c))
    .slice(0, 2)
    .map((c) => `.${escapeIdent(c)}`)
    .join('');

  const parent = element.parentElement;
  if (!parent) return `${tag}${classes}`;

  const siblingsOfType = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
  if (siblingsOfType.length === 1) return `${tag}${classes}`;

  return `${tag}${classes}:nth-of-type(${nthOfType(element)})`;
}

/** Build a path selector from the document root down to `element`. */
export function cssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === 1) {
    const segment = segmentFor(current);
    parts.unshift(segment);
    // An id is unique by definition — stop climbing once we have one.
    if (segment.includes('#')) break;
    current = current.parentElement;
    if (current && current.tagName.toLowerCase() === 'html') {
      parts.unshift('html');
      break;
    }
  }

  return parts.join(' > ');
}

/** Outer HTML, clipped for report display. */
export function snippet(element: Element, maxLength = 180): string {
  const html = (element.outerHTML ?? '').replace(/\s+/g, ' ').trim();
  if (html.length <= maxLength) return html;
  return `${html.slice(0, maxLength - 1)}…`;
}
