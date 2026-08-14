/**
 * Colour maths for WCAG 1.4.3 / 1.4.6 / 1.4.11.
 *
 * The formulae here are transcribed directly from the Recommendation and must
 * not be "tidied": the 0.03928 threshold and the 2.4 exponent are normative.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export interface Rgba {
  /** 0–255 */
  readonly r: number;
  /** 0–255 */
  readonly g: number;
  /** 0–255 */
  readonly b: number;
  /** 0–1 */
  readonly a: number;
}

/** The 16 CSS 2.1 basic colours plus the handful that show up in real markup. */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  transparent: '#00000000',
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  dimgray: '#696969',
  dimgrey: '#696969',
  slategray: '#708090',
  slategrey: '#708090',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
  indigo: '#4b0082',
  gold: '#ffd700',
  crimson: '#dc143c',
  tomato: '#ff6347',
  salmon: '#fa8072',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function parseHex(input: string): Rgba | null {
  const hex = input.slice(1);
  const expand = (c: string): number => parseInt(c + c, 16);

  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = hex.split('') as [string, string, string, string?];
    return {
      r: expand(r),
      g: expand(g),
      b: expand(b),
      a: a === undefined ? 1 : expand(a) / 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a };
  }
  return null;
}

function parseNumericComponent(raw: string, scale: number): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) {
    return clamp((parseFloat(trimmed) / 100) * scale, 0, scale);
  }
  return clamp(parseFloat(trimmed), 0, scale);
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) return clamp(parseFloat(trimmed) / 100, 0, 1);
  return clamp(parseFloat(trimmed), 0, 1);
}

/** Split `rgb(1 2 3 / 40%)` and `rgb(1, 2, 3, 0.4)` into components. */
function splitFunctionArgs(body: string): string[] {
  const [main, alpha] = body.split('/');
  const parts = (main ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);
  if (alpha !== undefined) parts.push(alpha.trim());
  return parts;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/**
 * Parse a CSS colour value. Returns `null` for anything we cannot resolve
 * statically (`currentColor`, `var(--x)`, `inherit`, gradients) — the caller
 * must then report `cantTell` rather than guess. Guessing is how automated
 * tools produce false failures that customers learn to ignore.
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  const named = NAMED_COLORS[value];
  if (named) return parseHex(named);

  if (value.startsWith('#')) return parseHex(value);

  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!fn) return null;

  const [, name, body] = fn as unknown as [string, string, string];
  const parts = splitFunctionArgs(body);
  if (parts.length < 3) return null;

  if (name === 'rgb' || name === 'rgba') {
    return {
      r: Math.round(parseNumericComponent(parts[0] as string, 255)),
      g: Math.round(parseNumericComponent(parts[1] as string, 255)),
      b: Math.round(parseNumericComponent(parts[2] as string, 255)),
      a: parseAlpha(parts[3]),
    };
  }

  const hue = parseFloat(parts[0] as string);
  const sat = clamp(parseFloat((parts[1] as string).replace('%', '')) / 100, 0, 1);
  const light = clamp(parseFloat((parts[2] as string).replace('%', '')) / 100, 0, 1);
  if ([hue, sat, light].some(Number.isNaN)) return null;

  return { ...hslToRgb(hue, sat, light), a: parseAlpha(parts[3]) };
}

/** WCAG relative luminance. Input channels are 0–255. */
export function relativeLuminance({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Composite a possibly-translucent foreground over an opaque backdrop.
 * WCAG's contrast formula is defined for opaque colours only, so anything with
 * alpha must be flattened first.
 */
export function flatten(foreground: Rgba, backdrop: Rgba): Rgba {
  const alpha = clamp(foreground.a, 0, 1);
  return {
    r: Math.round(foreground.r * alpha + backdrop.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + backdrop.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + backdrop.b * (1 - alpha)),
    a: 1,
  };
}

/** Contrast ratio between two opaque colours. Ranges from 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded down to 2dp — never round *up* into a passing ratio. */
export function roundRatio(ratio: number): number {
  return Math.floor(ratio * 100) / 100;
}

/**
 * "Large text" per WCAG: at least 18pt, or 14pt bold.
 * 1pt = 4/3 px, so the thresholds are 24px and 18.66…px.
 * https://www.w3.org/TR/WCAG21/#dfn-large-scale
 */
export const LARGE_TEXT_MIN_PX = 24;
export const LARGE_TEXT_BOLD_MIN_PX = 18.6667;
export const BOLD_MIN_WEIGHT = 700;

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  if (fontSizePx >= LARGE_TEXT_MIN_PX) return true;
  return fontWeight >= BOLD_MIN_WEIGHT && fontSizePx >= LARGE_TEXT_BOLD_MIN_PX;
}

/** Required ratio for body text and large text at a given conformance level. */
export function requiredContrast(level: 'AA' | 'AAA', large: boolean): number {
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}
