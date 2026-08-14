import { parseColor, type Rgba } from './color.js';

/**
 * A deliberately small, honest CSS resolver.
 *
 * Accessly does not run a browser, so it cannot know the *rendered* colour of
 * every element. What it can do reliably is resolve declarations present in the
 * document itself: inline `style` attributes and `<style>` blocks.
 *
 * Three things make that useful rather than academic:
 *
 *  1. **Custom properties are resolved.** Every modern design system expresses
 *     its palette as `--token` variables, so a resolver that gives up at
 *     `var(--ink)` cannot check contrast on any site built this decade.
 *  2. **Selectors are matched by the DOM**, not by a hand-rolled pattern, so
 *     descendant and compound selectors work.
 *  3. **Theme variants are resolved separately.** A `prefers-color-scheme: dark`
 *     block redefines the palette, and text that passes in light mode can fail
 *     in dark mode. Both are checked.
 *
 * What remains out of reach is external stylesheets and anything that depends
 * on layout. Where a value cannot be resolved the caller is told, and reports
 * `cantTell` rather than guessing — a tool that invents contrast failures
 * teaches its users to ignore the whole report.
 */

export interface ResolvedTextStyle {
  readonly color: Rgba | null;
  readonly backgroundColor: Rgba | null;
  readonly fontSizePx: number | null;
  readonly fontWeight: number | null;
  /** True when every property needed for a contrast decision was resolved. */
  readonly complete: boolean;
  readonly unresolvedReason: string | null;
}

interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly specificity: readonly [number, number, number];
  readonly order: number;
  readonly inline: boolean;
}

const PROPERTIES_OF_INTEREST = new Set([
  'color',
  'background-color',
  'background',
  'font-size',
  'font-weight',
]);

export interface StyleRule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
  readonly order: number;
}

/** A named set of custom-property values — the default palette, or a theme. */
export interface ThemeVariant {
  readonly label: string;
  readonly variables: ReadonlyMap<string, string>;
}

export interface StyleModel {
  readonly rules: readonly StyleRule[];
  /** Custom properties from unconditional rules. */
  readonly variables: ReadonlyMap<string, string>;
  /**
   * Alternate palettes from `prefers-color-scheme` / `forced-colors` blocks.
   * Contrast must hold in every one of them, not just the default.
   */
  readonly variants: readonly ThemeVariant[];
  /** Selectors the DOM refused to evaluate. Makes resolution advisory. */
  readonly unsupportedSelectors: number;
}

export const EMPTY_STYLE_MODEL: StyleModel = {
  rules: [],
  variables: new Map(),
  variants: [],
  unsupportedSelectors: 0,
};

function parseDeclarationBlock(body: string): {
  properties: Map<string, string>;
  variables: Map<string, string>;
} {
  const properties = new Map<string, string>();
  const variables = new Map<string, string>();

  // Split on semicolons that are not inside parentheses, so `rgb(1, 2, 3)` and
  // `var(--x, #fff)` survive intact.
  for (const chunk of body.split(/;(?![^(]*\))/)) {
    const idx = chunk.indexOf(':');
    if (idx === -1) continue;
    const property = chunk.slice(0, idx).trim().toLowerCase();
    const value = chunk.slice(idx + 1).replace(/!important/i, '').trim();
    if (property.length === 0 || value.length === 0) continue;

    if (property.startsWith('--')) {
      variables.set(property, value);
    } else if (PROPERTIES_OF_INTEREST.has(property)) {
      properties.set(property, value);
    }
  }

  return { properties, variables };
}

/** Strip comments and split a stylesheet into top-level and at-rule sections. */
function splitAtRules(css: string): {
  top: string;
  conditional: Array<{ condition: string; body: string }>;
} {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const conditional: Array<{ condition: string; body: string }> = [];
  let top = '';

  let index = 0;
  while (index < clean.length) {
    const at = clean.indexOf('@', index);
    if (at === -1) {
      top += clean.slice(index);
      break;
    }

    top += clean.slice(index, at);

    const open = clean.indexOf('{', at);
    if (open === -1) break;

    // Walk to the matching close brace so nested rules stay together.
    let depth = 0;
    let cursor = open;
    for (; cursor < clean.length; cursor += 1) {
      if (clean[cursor] === '{') depth += 1;
      else if (clean[cursor] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    const condition = clean.slice(at, open).trim();
    const body = clean.slice(open + 1, cursor);

    // @media/@supports bodies contain rules; @font-face and friends do not.
    if (/^@(media|supports|layer|container)/i.test(condition)) {
      conditional.push({ condition, body });
    }

    index = cursor + 1;
  }

  return { top, conditional };
}

function collectBlocks(
  css: string,
  startOrder: number,
): { rules: StyleRule[]; variables: Map<string, string>; nextOrder: number } {
  const rules: StyleRule[] = [];
  const variables = new Map<string, string>();
  let order = startOrder;

  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(css)) !== null) {
    const rawSelectors = (match[1] ?? '').trim();
    if (rawSelectors.length === 0) continue;

    const { properties, variables: blockVariables } = parseDeclarationBlock(match[2] ?? '');

    const selectors = rawSelectors
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Custom properties declared on :root, html or * are treated as global.
    // Scoped custom properties are rare and resolving them per-element would
    // require a full cascade implementation.
    const isGlobalScope = selectors.some((s) => /^(:root|html|\*)$/i.test(s));
    if (isGlobalScope) {
      for (const [name, value] of blockVariables) variables.set(name, value);
    }

    if (properties.size > 0) {
      rules.push({ selectors, declarations: properties, order: order++ });
    }
  }

  return { rules, variables, nextOrder: order };
}

/** Build the style model for a document. */
export function collectStyleRules(document: Document): StyleModel {
  const rules: StyleRule[] = [];
  const variables = new Map<string, string>();
  const variants: ThemeVariant[] = [];
  let order = 0;

  for (const styleEl of Array.from(document.querySelectorAll('style'))) {
    const { top, conditional } = splitAtRules(styleEl.textContent ?? '');

    const parsed = collectBlocks(top, order);
    rules.push(...parsed.rules);
    for (const [name, value] of parsed.variables) variables.set(name, value);
    order = parsed.nextOrder;

    for (const block of conditional) {
      // A colour-scheme or contrast preference changes the palette. Those get
      // their own variant so contrast can be checked under each. Layout media
      // queries (max-width and friends) do not affect colour, so their rules
      // are ignored rather than applied unconditionally.
      const isPaletteVariant = /prefers-color-scheme|forced-colors|prefers-contrast/i.test(
        block.condition,
      );
      if (!isPaletteVariant) continue;

      const variantParsed = collectBlocks(block.body, order);
      order = variantParsed.nextOrder;
      if (variantParsed.variables.size === 0 && variantParsed.rules.length === 0) continue;

      variants.push({
        label: block.condition.replace(/^@media\s*/i, '').replace(/[()]/g, '').trim(),
        variables: variantParsed.variables,
      });
    }
  }

  return { rules, variables, variants, unsupportedSelectors: 0 };
}

/**
 * Resolve `var(--name, fallback)` against a variable map.
 *
 * Depth-limited: custom properties can legitimately reference each other, and a
 * cyclic definition must not hang the audit.
 */
export function resolveVars(
  value: string,
  variables: ReadonlyMap<string, string>,
  depth = 0,
): string | null {
  if (!value.includes('var(')) return value;
  if (depth > 8) return null;

  let unresolved = false;

  const resolved = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fallback) => {
    const own = variables.get(name as string);
    if (own !== undefined) return own;
    if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback.trim();
    unresolved = true;
    return '';
  });

  if (unresolved) return null;
  return resolveVars(resolved, variables, depth + 1);
}

function specificityOf(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]+\]/g) ?? []).length +
    (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const types = (selector.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, types];
}

/**
 * Does this selector match?
 *
 * Delegated to the DOM rather than pattern-matched by hand, so descendant,
 * child and compound selectors all work. A selector the engine cannot parse
 * throws, and is treated as not matching rather than as a match.
 */
function selectorMatches(element: Element, selector: string): boolean {
  // Pseudo-elements and state pseudo-classes describe a rendered state we do
  // not have, so they never contribute to the resting appearance.
  if (/::|:hover|:focus|:active|:visited|:target/.test(selector)) return false;
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function compareDeclarations(a: Declaration, b: Declaration): number {
  if (a.inline !== b.inline) return a.inline ? 1 : -1;
  for (let i = 0; i < 3; i += 1) {
    const diff = (a.specificity[i] ?? 0) - (b.specificity[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.order - b.order;
}

function declarationsFor(element: Element, model: StyleModel): Declaration[] {
  const out: Declaration[] = [];

  for (const rule of model.rules) {
    for (const selector of rule.selectors) {
      if (!selectorMatches(element, selector)) continue;
      for (const [property, value] of rule.declarations) {
        out.push({
          property,
          value,
          specificity: specificityOf(selector),
          order: rule.order,
          inline: false,
        });
      }
    }
  }

  const { properties } = parseDeclarationBlock(element.getAttribute('style') ?? '');
  for (const [property, value] of properties) {
    out.push({
      property,
      value,
      specificity: [0, 0, 0],
      order: Number.MAX_SAFE_INTEGER,
      inline: true,
    });
  }

  return out.sort(compareDeclarations);
}

function winningValue(declarations: readonly Declaration[], property: string): string | null {
  for (let i = declarations.length - 1; i >= 0; i -= 1) {
    const decl = declarations[i];
    if (decl && decl.property === property) return decl.value;
  }
  return null;
}

const ABSOLUTE_FONT_SIZES: Readonly<Record<string, number>> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
};

export const ROOT_FONT_SIZE_PX = 16;

export function parseFontSize(value: string | null, inheritedPx: number): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();

  const keyword = ABSOLUTE_FONT_SIZES[trimmed];
  if (keyword !== undefined) return keyword;

  // `clamp()` and `calc()` depend on the viewport; the preferred (middle)
  // argument of a clamp is the best static approximation available.
  const clamp = /^clamp\(([^,]+),([^,]+),([^)]+)\)$/.exec(trimmed);
  if (clamp) return parseFontSize((clamp[2] ?? '').trim(), inheritedPx);

  const numeric = /^(-?[\d.]+)(px|pt|rem|em|%)?$/.exec(trimmed);
  if (!numeric) return null;
  const amount = parseFloat(numeric[1] ?? '');
  if (!Number.isFinite(amount)) return null;

  switch (numeric[2]) {
    case 'px':
    case undefined:
      return amount;
    case 'pt':
      return (amount * 4) / 3;
    case 'rem':
      return amount * ROOT_FONT_SIZE_PX;
    case 'em':
      return amount * inheritedPx;
    case '%':
      return (amount / 100) * inheritedPx;
    default:
      return null;
  }
}

export function parseFontWeight(value: string | null, inherited: number): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'normal') return 400;
  if (trimmed === 'bold') return 700;
  if (trimmed === 'bolder') return Math.min(900, inherited + 300);
  if (trimmed === 'lighter') return Math.max(100, inherited - 300);
  const numeric = Number.parseInt(trimmed, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function backgroundShorthandColor(value: string): string | null {
  if (/url\(|gradient\(/i.test(value)) return null;
  const tokens = value.trim().split(/\s+(?![^(]*\))/);
  for (const token of tokens) {
    if (parseColor(token)) return token;
  }
  return null;
}

/**
 * Resolve the text style of an element under one palette.
 *
 * Walks the ancestor chain because `color` and `font-size` inherit while
 * `background-color` does not — the nearest opaque ancestor background is what
 * actually shows behind the text.
 */
export function resolveTextStyle(
  element: Element,
  model: StyleModel,
  variables: ReadonlyMap<string, string> = model.variables,
): ResolvedTextStyle {
  const chain: Element[] = [];
  let cursor: Element | null = element;
  while (cursor && cursor.nodeType === 1) {
    chain.unshift(cursor);
    cursor = cursor.parentElement;
  }

  let color: Rgba | null = null;
  let fontSizePx = ROOT_FONT_SIZE_PX;
  let fontWeight = 400;
  let background: Rgba | null = null;
  let unresolvedValue: string | null = null;

  const resolveColour = (raw: string | null): Rgba | null => {
    if (raw === null) return null;
    const expanded = resolveVars(raw, variables);
    if (expanded === null) {
      unresolvedValue = raw;
      return null;
    }
    const parsed = parseColor(expanded);
    if (!parsed) unresolvedValue = raw;
    return parsed;
  };

  for (const node of chain) {
    const declarations = declarationsFor(node, model);
    const tag = node.tagName.toLowerCase();

    const colorValue = winningValue(declarations, 'color');
    if (colorValue) {
      const parsed = resolveColour(colorValue);
      if (parsed) color = parsed;
    }

    const sizeValue = winningValue(declarations, 'font-size');
    if (sizeValue) {
      const expanded = resolveVars(sizeValue, variables);
      const parsed = expanded === null ? null : parseFontSize(expanded, fontSizePx);
      if (parsed !== null) fontSizePx = parsed;
    }

    const weightValue = winningValue(declarations, 'font-weight');
    if (weightValue) {
      const expanded = resolveVars(weightValue, variables);
      const parsed = expanded === null ? null : parseFontWeight(expanded, fontWeight);
      if (parsed !== null) fontWeight = parsed;
    } else if (/^h[1-6]$/.test(tag) || tag === 'strong' || tag === 'b') {
      // Every user-agent stylesheet bolds these.
      fontWeight = 700;
    }

    const backgroundValue =
      winningValue(declarations, 'background-color') ??
      (() => {
        const shorthand = winningValue(declarations, 'background');
        if (!shorthand) return null;
        const expanded = resolveVars(shorthand, variables);
        return expanded === null ? null : backgroundShorthandColor(expanded);
      })();

    if (backgroundValue) {
      const parsed = resolveColour(backgroundValue);
      // A transparent background lets the ancestor's show through, so it must
      // not overwrite what we already have.
      if (parsed && parsed.a > 0) background = parsed;
    }
  }

  /*
   * An unresolvable declaration makes the whole result undecidable, even when
   * an inherited value is available to fall back on.
   *
   * Without this, a `color: var(--missing)` silently leaves the ancestor's
   * colour in place and we report a confident, *wrong* ratio for a colour the
   * element does not actually have. A wrong number is worse than no number:
   * the customer cannot reproduce it and stops trusting the report.
   */
  const complete = color !== null && background !== null && unresolvedValue === null;

  let unresolvedReason: string | null = null;
  if (!complete) {
    if (unresolvedValue !== null) {
      unresolvedReason = `The value "${unresolvedValue}" could not be resolved — it may be a custom property defined in an external stylesheet.`;
    } else if (color === null) {
      unresolvedReason = 'No text colour is declared in the document.';
    } else {
      unresolvedReason = 'No background colour is declared behind this text.';
    }
  }

  return {
    color,
    backgroundColor: background,
    fontSizePx,
    fontWeight,
    complete,
    unresolvedReason,
  };
}

/**
 * Every palette the document defines: the default, plus each theme variant.
 * Contrast has to hold under all of them.
 */
export function palettes(model: StyleModel): ReadonlyArray<{ label: string; variables: ReadonlyMap<string, string> }> {
  const base = { label: 'default', variables: model.variables };
  return [
    base,
    ...model.variants.map((variant) => ({
      label: variant.label,
      // A variant overrides only the properties it redeclares.
      variables: new Map([...model.variables, ...variant.variables]),
    })),
  ];
}
