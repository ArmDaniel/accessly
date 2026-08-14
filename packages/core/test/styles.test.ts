import { describe, expect, it } from 'vitest';
import { auditHtml } from '../src/audit.js';
import { parseDocument } from '../src/dom/parse.js';
import { collectStyleRules, palettes, resolveTextStyle, resolveVars } from '../src/dom/styles.js';

function styleOf(html: string, selector: string, paletteIndex = 0) {
  const parsed = parseDocument(html);
  const model = collectStyleRules(parsed.document);
  const element = parsed.document.querySelector(selector);
  if (!element) throw new Error(`No element matched ${selector}`);
  const palette = palettes(model)[paletteIndex];
  return resolveTextStyle(element, model, palette?.variables);
}

const page = (head: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>Style test page</title>${head}</head><body>${body}</body></html>`;

describe('custom property resolution', () => {
  it('resolves a var() reference', () => {
    expect(resolveVars('var(--x)', new Map([['--x', '#123456']]))).toBe('#123456');
  });

  it('resolves a chain of references', () => {
    const vars = new Map([
      ['--a', 'var(--b)'],
      ['--b', '#abcdef'],
    ]);
    expect(resolveVars('var(--a)', vars)).toBe('#abcdef');
  });

  it('uses the fallback when the property is undefined', () => {
    expect(resolveVars('var(--missing, #fff)', new Map())).toBe('#fff');
  });

  it('returns null when a property is undefined and has no fallback', () => {
    // The caller must then report cantTell rather than guess.
    expect(resolveVars('var(--missing)', new Map())).toBeNull();
  });

  it('terminates on a cyclic definition', () => {
    const vars = new Map([
      ['--a', 'var(--b)'],
      ['--b', 'var(--a)'],
    ]);
    expect(resolveVars('var(--a)', vars)).toBeNull();
  });
});

describe('resolving styles from a stylesheet', () => {
  const html = page(
    `<style>
      :root { --ink: #0b1f24; --paper: #ffffff; }
      body { color: var(--ink); background-color: var(--paper); }
      .lede { font-size: 24px; }
      .card p { color: #767676; }
    </style>`,
    `<main><p class="lede">Big</p><div class="card"><p>Grey</p></div></main>`,
  );

  it('resolves colours declared through custom properties', () => {
    const style = styleOf(html, '.lede');
    expect(style.complete).toBe(true);
    expect(style.color).toEqual({ r: 11, g: 31, b: 36, a: 1 });
    expect(style.backgroundColor).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('matches descendant selectors', () => {
    // `.card p` needs real selector matching, not a simple-selector pattern.
    const style = styleOf(html, '.card p');
    expect(style.color).toEqual({ r: 118, g: 118, b: 118, a: 1 });
  });

  it('inherits font size and colour down the tree', () => {
    expect(styleOf(html, '.lede').fontSizePx).toBe(24);
    expect(styleOf(html, '.card p').fontSizePx).toBe(16);
  });

  it('lets a more specific selector win', () => {
    const specific = page(
      `<style>
        :root { --ink: #000; }
        p { color: #999999; background-color: #fff; }
        .card p { color: var(--ink); }
      </style>`,
      `<div class="card"><p>Text</p></div>`,
    );
    expect(styleOf(specific, '.card p').color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('lets an inline style beat any rule', () => {
    const inline = page(
      `<style>p { color: #999999; background-color: #ffffff; }</style>`,
      `<p style="color:#000000">Text</p>`,
    );
    expect(styleOf(inline, 'p').color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('ignores state pseudo-classes, which describe a state we cannot observe', () => {
    const hover = page(
      `<style>
        p { color: #0b1f24; background-color: #ffffff; }
        p:hover { color: #ffffff; }
      </style>`,
      `<p>Text</p>`,
    );
    expect(styleOf(hover, 'p').color).toEqual({ r: 11, g: 31, b: 36, a: 1 });
  });
});

describe('theme variants', () => {
  const themed = page(
    `<style>
      :root { --ink: #0b1f24; --paper: #ffffff; }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #edf5f4; --paper: #0d2126; }
      }
      body { color: var(--ink); background-color: var(--paper); }
    </style>`,
    `<main><p>Text</p></main>`,
  );

  it('exposes the default palette and each variant', () => {
    const model = collectStyleRules(parseDocument(themed).document);
    const list = palettes(model);
    expect(list).toHaveLength(2);
    expect(list[0]?.label).toBe('default');
    expect(list[1]?.label).toMatch(/prefers-color-scheme/);
  });

  it('resolves different colours under each palette', () => {
    expect(styleOf(themed, 'p', 0).color).toEqual({ r: 11, g: 31, b: 36, a: 1 });
    expect(styleOf(themed, 'p', 1).color).toEqual({ r: 237, g: 245, b: 244, a: 1 });
  });

  it('inherits unchanged properties into a variant', () => {
    const partial = page(
      `<style>
        :root { --ink: #0b1f24; --paper: #ffffff; }
        @media (prefers-color-scheme: dark) { :root { --paper: #0d2126; } }
        body { color: var(--ink); background-color: var(--paper); }
      </style>`,
      `<p>Text</p>`,
    );
    // --ink is not redeclared, so the variant keeps the default value.
    expect(styleOf(partial, 'p', 1).color).toEqual({ r: 11, g: 31, b: 36, a: 1 });
  });

  it('ignores layout media queries, which do not change colour', () => {
    const layout = page(
      `<style>
        :root { --ink: #0b1f24; --paper: #ffffff; }
        body { color: var(--ink); background-color: var(--paper); }
        @media (max-width: 40rem) { :root { --ink: #cccccc; } }
      </style>`,
      `<p>Text</p>`,
    );
    const model = collectStyleRules(parseDocument(layout).document);
    expect(palettes(model)).toHaveLength(1);
  });
});

describe('contrast across themes', () => {
  it('fails when text passes in light mode but not in dark mode', () => {
    // The exact bug the self-audit found in our own theme: the surface flips
    // but the text colour does not.
    const html = page(
      `<style>
        :root { --panel: #0b1f24; }
        @media (prefers-color-scheme: dark) { :root { --panel: #edf5f4; } }
        .panel { background-color: var(--panel); color: #edf5f4; }
      </style>`,
      `<main><div class="panel"><p style="color:#edf5f4">Footer text</p></div></main>`,
    );

    const report = auditHtml({ html, url: 'https://example.test/', only: ['text-contrast'] });
    const failure = report.findings.find((f) => f.outcome === 'failed');

    expect(failure).toBeDefined();
    expect(failure?.message).toMatch(/prefers-color-scheme: dark/);
  });

  it('passes when both palettes are readable', () => {
    const html = page(
      `<style>
        :root { --panel: #0b1f24; --on-panel: #edf5f4; }
        @media (prefers-color-scheme: dark) {
          :root { --panel: #edf5f4; --on-panel: #0b1f24; }
        }
        .panel { background-color: var(--panel); color: var(--on-panel); }
      </style>`,
      `<main><div class="panel"><p>Footer text</p></div></main>`,
    );

    const report = auditHtml({ html, url: 'https://example.test/', only: ['text-contrast'] });
    expect(report.findings).toEqual([]);
  });
});

describe('honesty under unresolvable values', () => {
  it('reports cantTell rather than a wrong ratio when a property is undefined', () => {
    /*
     * The subtle failure mode this guards against: `color: var(--missing)`
     * leaves the inherited colour in place, so a naive resolver reports a
     * confident ratio for a colour the element does not have.
     */
    const html = page(
      `<style>
        body { color: #0b1f24; background-color: #ffffff; }
        .btn { background-color: #0a5c63; color: var(--not-defined); }
      </style>`,
      `<main><p class="btn">Button text</p></main>`,
    );

    const report = auditHtml({ html, url: 'https://example.test/', only: ['text-contrast'] });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.outcome).toBe('cantTell');
    expect(report.findings[0]?.message).toMatch(/could not be resolved/i);
  });

  it('still reports cantTell when no colours are declared at all', () => {
    const report = auditHtml({
      html: page('', '<main><p>Text</p></main>'),
      url: 'https://example.test/',
      only: ['text-contrast'],
    });
    expect(report.findings[0]?.outcome).toBe('cantTell');
  });
});
