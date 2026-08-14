import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/dom/parse.js';
import { accessibleDescription, accessibleName, visibleText } from '../src/dom/accname.js';
import { computeRole, isFocusable, isHiddenFromAccessibilityTree } from '../src/dom/aria.js';

function el(html: string, selector: string): Element {
  const { document } = parseDocument(`<!doctype html><html><body>${html}</body></html>`);
  const found = document.querySelector(selector);
  if (!found) throw new Error(`No element matched "${selector}"`);
  return found;
}

/**
 * Accessible name computation, tested against the ordering in
 * Accessible Name and Description Computation 1.2 §4.3.
 * https://www.w3.org/TR/accname-1.2/
 */
describe('accessible name — precedence order', () => {
  it('prefers aria-labelledby over everything else', () => {
    const element = el(
      '<span id="l">From labelledby</span><button id="b" aria-labelledby="l" aria-label="From label" title="From title">From content</button>',
      '#b',
    );
    expect(accessibleName(element)).toEqual({
      value: 'From labelledby',
      source: 'aria-labelledby',
    });
  });

  it('prefers aria-label over native labelling and content', () => {
    const element = el('<button aria-label="Close dialog" title="x">×</button>', 'button');
    expect(accessibleName(element).value).toBe('Close dialog');
  });

  it('falls back to native labelling before content', () => {
    const element = el('<label for="f">Email address</label><input id="f" title="tip">', 'input');
    const name = accessibleName(element);
    expect(name.value).toBe('Email address');
    expect(name.source).toBe('native-label');
  });

  it('falls back to content when nothing else names the element', () => {
    const element = el('<button>Save changes</button>', 'button');
    expect(accessibleName(element)).toEqual({ value: 'Save changes', source: 'content' });
  });

  it('uses title only as a last resort', () => {
    const element = el('<a href="/x" title="Go to X"></a>', 'a');
    expect(accessibleName(element)).toEqual({ value: 'Go to X', source: 'title' });
  });

  it('concatenates multiple aria-labelledby references in order', () => {
    const element = el(
      '<span id="a">Delete</span><span id="b">invoice 42</span><button aria-labelledby="a b">×</button>',
      'button',
    );
    expect(accessibleName(element).value).toBe('Delete invoice 42');
  });

  it('ignores aria-labelledby ids that do not resolve', () => {
    const element = el('<button aria-labelledby="missing">Fallback</button>', 'button');
    expect(accessibleName(element).value).toBe('Fallback');
  });
});

describe('accessible name — native host language labelling', () => {
  it('reads alt from an image, including an intentional empty alt', () => {
    expect(accessibleName(el('<img src="a" alt="A cat">', 'img')).value).toBe('A cat');

    const decorative = accessibleName(el('<img src="a" alt="">', 'img'));
    expect(decorative.value).toBe('');
    // Crucially the *source* is alt, not none — the author said something.
    expect(decorative.source).toBe('alt');
  });

  it('reads a wrapping label', () => {
    const element = el('<label>Postcode <input name="p"></label>', 'input');
    expect(accessibleName(element).value).toBe('Postcode');
  });

  it('reads a legend for a fieldset', () => {
    const element = el('<fieldset><legend>Delivery</legend><input></fieldset>', 'fieldset');
    expect(accessibleName(element)).toEqual({ value: 'Delivery', source: 'legend' });
  });

  it('reads a caption for a table', () => {
    const element = el('<table><caption>Q3 revenue</caption><tr><td>1</td></tr></table>', 'table');
    expect(accessibleName(element).value).toBe('Q3 revenue');
  });

  it('supplies the user-agent default name for submit and reset buttons', () => {
    expect(accessibleName(el('<input type="submit">', 'input')).value).toBe('Submit');
    expect(accessibleName(el('<input type="reset">', 'input')).value).toBe('Reset');
    expect(accessibleName(el('<input type="submit" value="Pay now">', 'input')).value).toBe(
      'Pay now',
    );
  });

  it('reads an svg title element', () => {
    const element = el('<svg><title>Accessly logo</title><path d="M0 0"/></svg>', 'svg');
    expect(accessibleName(element).value).toBe('Accessly logo');
  });
});

describe('accessible name — recursion safety', () => {
  it('does not loop when two elements label each other', () => {
    const element = el(
      '<button id="a" aria-labelledby="b">A</button><button id="b" aria-labelledby="a">B</button>',
      '#a',
    );
    // The important assertion is that this terminates at all.
    expect(() => accessibleName(element)).not.toThrow();
    expect(accessibleName(element).value.length).toBeGreaterThan(0);
  });

  it('skips hidden descendants when computing a name from content', () => {
    const element = el('<button>Save <span hidden>(draft)</span></button>', 'button');
    expect(accessibleName(element).value).toBe('Save');
  });

  it('normalises whitespace', () => {
    const element = el('<button>  Save   \n  changes </button>', 'button');
    expect(accessibleName(element).value).toBe('Save changes');
  });
});

describe('accessible description', () => {
  it('reads aria-describedby', () => {
    const element = el(
      '<input aria-describedby="h"><p id="h">At least 12 characters</p>',
      'input',
    );
    expect(accessibleDescription(element)).toBe('At least 12 characters');
  });

  it('does not reuse title as the description when it became the name', () => {
    const element = el('<a href="/x" title="Go to X"></a>', 'a');
    expect(accessibleName(element).source).toBe('title');
    expect(accessibleDescription(element)).toBe('');
  });
});

describe('visible text', () => {
  it('excludes hidden subtrees', () => {
    const element = el(
      '<button>Send<span class="visually-hidden" aria-hidden="true"> message</span></button>',
      'button',
    );
    expect(visibleText(element)).toBe('Send');
  });
});

describe('roles', () => {
  it('maps implicit roles from the element and its attributes', () => {
    expect(computeRole(el('<a href="/x">x</a>', 'a'))).toBe('link');
    expect(computeRole(el('<a>x</a>', 'a'))).toBe('generic');
    expect(computeRole(el('<input type="checkbox">', 'input'))).toBe('checkbox');
    expect(computeRole(el('<input type="text">', 'input'))).toBe('textbox');
    expect(computeRole(el('<select><option>a</option></select>', 'select'))).toBe('combobox');
    expect(computeRole(el('<select multiple><option>a</option></select>', 'select'))).toBe(
      'listbox',
    );
    expect(computeRole(el('<h2>x</h2>', 'h2'))).toBe('heading');
    expect(computeRole(el('<nav></nav>', 'nav'))).toBe('navigation');
  });

  it('treats an image with empty alt as presentational', () => {
    expect(computeRole(el('<img src="a" alt="">', 'img'))).toBe('presentation');
    expect(computeRole(el('<img src="a" alt="cat">', 'img'))).toBe('img');
  });

  it('only maps section to region when it has a name', () => {
    expect(computeRole(el('<section></section>', 'section'))).toBe('generic');
    expect(computeRole(el('<section aria-label="Filters"></section>', 'section'))).toBe('region');
  });

  it('scopes header and footer to the body for landmark roles', () => {
    expect(computeRole(el('<header></header>', 'header'))).toBe('banner');
    expect(computeRole(el('<article><header></header></article>', 'header'))).toBe('generic');
  });

  it('lets an explicit role win', () => {
    expect(computeRole(el('<div role="button">x</div>', 'div'))).toBe('button');
  });
});

describe('hidden and focusable', () => {
  it('treats hidden, aria-hidden and inline display:none as hidden', () => {
    expect(isHiddenFromAccessibilityTree(el('<div hidden>x</div>', 'div'))).toBe(true);
    expect(isHiddenFromAccessibilityTree(el('<div aria-hidden="true">x</div>', 'div'))).toBe(true);
    expect(isHiddenFromAccessibilityTree(el('<div style="display:none">x</div>', 'div'))).toBe(true);
    expect(isHiddenFromAccessibilityTree(el('<div>x</div>', 'div'))).toBe(false);
  });

  it('inherits hidden state from an ancestor', () => {
    expect(isHiddenFromAccessibilityTree(el('<div hidden><button>x</button></div>', 'button'))).toBe(
      true,
    );
  });

  it('knows which elements are in the tab order', () => {
    expect(isFocusable(el('<button>x</button>', 'button'))).toBe(true);
    expect(isFocusable(el('<button disabled>x</button>', 'button'))).toBe(false);
    expect(isFocusable(el('<a href="/x">x</a>', 'a'))).toBe(true);
    expect(isFocusable(el('<a>x</a>', 'a'))).toBe(false);
    expect(isFocusable(el('<div>x</div>', 'div'))).toBe(false);
    expect(isFocusable(el('<div tabindex="0">x</div>', 'div'))).toBe(true);
    expect(isFocusable(el('<div tabindex="-1">x</div>', 'div'))).toBe(false);
  });
});
