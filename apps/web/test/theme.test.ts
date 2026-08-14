// @vitest-environment node
//
// This suite reads the stylesheets off disk and does arithmetic on them. It has
// no DOM at all, and under jsdom `import.meta.url` is an http URL rather than a
// file one, so the reads would fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor, roundRatio, type Rgba } from '@accessly/core';

/**
 * The design tokens are the one place our own contrast can be verified.
 *
 * Component tests run in jsdom, which resolves no stylesheets, so an automated
 * audit of rendered markup can never decide contrast. Rather than let that
 * become a blind spot, we assert the palette itself here: every colour pair the
 * design system actually uses, checked against the same maths the product
 * applies to customers.
 *
 * The ratios claimed in the comments in tokens.css are asserted too, so a
 * comment cannot quietly become a lie.
 */

const readCss = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), 'utf8');

/**
 * Strip comments before parsing.
 *
 * The token file documents each measured ratio in a comment next to the value,
 * and those comments contain colons, semicolons and the literal text
 * `outline: none`. Parsing without removing them first reads the prose as
 * declarations.
 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokensCss = readCss('tokens.css');
const tokensCode = stripComments(tokensCss);

/** Pull `--a-name: value;` declarations out of a `:root` block. */
function readTokens(css: string, blockIndex: number): Map<string, string> {
  const blocks = css.match(/:root\s*\{[^}]*\}/g) ?? [];
  const block = blocks[blockIndex] ?? '';
  const tokens = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--a-[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name as string, (value as string).trim());
  }
  return tokens;
}

const light = readTokens(tokensCode, 0);
const dark = readTokens(tokensCode, 1);

function colour(tokens: Map<string, string>, name: string): Rgba {
  const raw = tokens.get(name);
  expect(raw, `token ${name} is missing`).toBeDefined();
  const parsed = parseColor(raw as string);
  expect(parsed, `token ${name} ("${raw}") is not a parseable colour`).not.toBeNull();
  return parsed as Rgba;
}

function ratio(tokens: Map<string, string>, foreground: string, background: string): number {
  return roundRatio(contrastRatio(colour(tokens, foreground), colour(tokens, background)));
}

describe('light theme text contrast', () => {
  /** [foreground, background, minimum required, why]. */
  const pairs: Array<[string, string, number, string]> = [
    ['--a-ink', '--a-surface', 4.5, 'body text'],
    ['--a-ink', '--a-surface-sunken', 4.5, 'body text on a sunken section'],
    ['--a-ink-muted', '--a-surface', 4.5, 'secondary text'],
    ['--a-ink-subtle', '--a-surface', 4.5, 'the lightest text we use'],
    ['--a-brand', '--a-surface', 4.5, 'link text'],
    ['--a-brand', '--a-surface-sunken', 4.5, 'link text on a sunken section'],
    ['--a-brand-strong', '--a-surface', 4.5, 'hovered link text'],
    ['--a-brand-strong', '--a-brand-tint', 4.5, 'text on the brand tint'],
    ['--a-success', '--a-surface', 4.5, 'success text'],
    ['--a-success', '--a-success-tint', 4.5, 'success text on its own tint'],
    ['--a-danger', '--a-surface', 4.5, 'error text'],
    ['--a-danger', '--a-danger-tint', 4.5, 'error text on its own tint'],
    ['--a-warning', '--a-surface', 4.5, 'warning text'],
    ['--a-warning', '--a-warning-tint', 4.5, 'warning text on its own tint'],
    ['--a-accent-strong', '--a-surface', 4.5, 'the text-safe amber'],
    ['--a-surface', '--a-surface-inverse', 4.5, 'text on the dark section'],
    ['--a-accent', '--a-surface-inverse', 4.5, 'links on the dark section'],
  ];

  it.each(pairs)('%s on %s reaches %d:1 (%s)', (fg, bg, minimum) => {
    expect(ratio(light, fg, bg)).toBeGreaterThanOrEqual(minimum);
  });

  it('reaches AAA for the primary body text pair', () => {
    // The main reading experience should not merely scrape past AA.
    expect(ratio(light, '--a-ink', '--a-surface')).toBeGreaterThanOrEqual(7);
  });

  it('gives white text on the primary button enough contrast', () => {
    const white = parseColor('#ffffff') as Rgba;
    expect(roundRatio(contrastRatio(white, colour(light, '--a-brand')))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('light theme non-text contrast (WCAG 1.4.11)', () => {
  it('makes control boundaries visible at 3:1', () => {
    // --a-border-strong is used for input and control borders, so it is a
    // "user interface component" boundary and must reach 3:1.
    expect(ratio(light, '--a-border-strong', '--a-surface')).toBeGreaterThanOrEqual(3);
    expect(ratio(light, '--a-border-strong', '--a-surface-sunken')).toBeGreaterThanOrEqual(3);
  });

  it('makes the focus indicator visible against both surfaces', () => {
    expect(ratio(light, '--a-focus-ring', '--a-surface')).toBeGreaterThanOrEqual(3);
    expect(ratio(light, '--a-focus-ring-offset', '--a-surface-inverse')).toBeGreaterThanOrEqual(3);
  });

  it('uses a focus ring at least 2px thick', () => {
    const width = light.get('--a-focus-width');
    expect(Number.parseFloat(width ?? '0')).toBeGreaterThanOrEqual(2);
  });
});

describe('dark theme contrast', () => {
  const pairs: Array<[string, string, number]> = [
    ['--a-ink', '--a-surface', 4.5],
    ['--a-ink-muted', '--a-surface', 4.5],
    ['--a-ink-subtle', '--a-surface', 4.5],
    ['--a-brand', '--a-surface', 4.5],
    ['--a-success', '--a-surface', 4.5],
    ['--a-danger', '--a-surface', 4.5],
    ['--a-warning', '--a-surface', 4.5],
    ['--a-accent-strong', '--a-surface', 4.5],
  ];

  it.each(pairs)('%s on %s reaches %d:1', (fg, bg, minimum) => {
    expect(ratio(dark, fg, bg)).toBeGreaterThanOrEqual(minimum);
  });

  it('keeps control boundaries visible', () => {
    expect(ratio(dark, '--a-border-strong', '--a-surface')).toBeGreaterThanOrEqual(3);
  });

  it('is a re-measured palette, not an inversion of the light one', () => {
    expect(dark.get('--a-brand')).not.toBe(light.get('--a-brand'));
    expect(dark.size).toBeGreaterThan(15);
  });
});

describe('token hygiene', () => {
  it('sizes text in relative units so browser font settings are respected', () => {
    // A px type scale silently overrides the font size a low-vision user has
    // chosen in their browser, which breaks 1.4.4 Resize Text.
    for (const [name, value] of light) {
      if (!name.startsWith('--a-text-')) continue;
      expect(value, `${name} must not be sized in px`).not.toMatch(/\d+px/);
      expect(value).toMatch(/rem|clamp/);
    }
  });

  it('sets a body line height of at least 1.5', () => {
    expect(Number.parseFloat(light.get('--a-leading-normal') ?? '0')).toBeGreaterThanOrEqual(1.5);
  });

  it('sets a minimum target size of at least 44px', () => {
    expect(Number.parseFloat(light.get('--a-target-min') ?? '0')).toBeGreaterThanOrEqual(44);
  });

  it('puts an accessibility-first typeface at the head of the stack', () => {
    expect(light.get('--a-font-sans')).toMatch(/Atkinson Hyperlegible/);
  });

  it('declares every contrast ratio it claims in a comment', () => {
    // Every "on white: N:1" comment in tokens.css must be true.
    const claims = [...tokensCss.matchAll(/(--a-[\w-]+):\s*(#[0-9a-f]{6});.*?on white:\s*([\d.]+):1/gi)];
    expect(claims.length).toBeGreaterThan(3);

    const white = parseColor('#ffffff') as Rgba;
    for (const [, name, hex, claimed] of claims) {
      const measured = roundRatio(contrastRatio(parseColor(hex as string) as Rgba, white));
      expect(
        measured,
        `${name} claims ${claimed}:1 against white but measures ${measured}:1`,
      ).toBeGreaterThanOrEqual(Number.parseFloat(claimed as string) - 0.1);
    }
  });
});

describe('motion and forced colors', () => {
  const baseCss = stripComments(readCss('base.css'));

  it('honours prefers-reduced-motion', () => {
    expect(baseCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(baseCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it('never removes a focus outline without providing one', () => {
    // A bare `outline: none` anywhere in our own stylesheets would be the exact
    // defect the product reports to customers.
    const declarations = [...baseCss.matchAll(/outline\s*:\s*none/g)];
    for (const match of declarations) {
      const context = baseCss.slice(Math.max(0, match.index - 200), match.index + 100);
      // The only permitted case is a programmatic focus target, which the user
      // did not tab to.
      expect(context).toMatch(/tabindex='-1'|tabindex="-1"/);
    }
  });

  it('supports forced-colors mode', () => {
    expect(tokensCss).toMatch(/@media \(forced-colors: active\)/);
    expect(tokensCss).toMatch(/CanvasText/);
  });
});
