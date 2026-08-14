import { describe, expect, it } from 'vitest';
import {
  BOLD_MIN_WEIGHT,
  contrastRatio,
  flatten,
  isLargeText,
  parseColor,
  relativeLuminance,
  requiredContrast,
  roundRatio,
} from '../src/dom/color.js';

/**
 * The contrast maths is normative — the numbers below are taken from the WCAG
 * definitions themselves, not from our implementation. If one of these fails,
 * the implementation has drifted from the specification.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
describe('relative luminance', () => {
  it('is 0 for black and 1 for white, by definition', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('applies the linear segment below the 0.03928 threshold', () => {
    // 10/255 = 0.0392 which is just under the threshold, so c/12.92 applies.
    const value = relativeLuminance({ r: 10, g: 10, b: 10 });
    const expected = 10 / 255 / 12.92;
    expect(value).toBeCloseTo(expected, 10);
  });

  it('weights green far more heavily than blue', () => {
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeCloseTo(0.7152, 4);
    expect(blue).toBeCloseTo(0.0722, 4);
  });
});

describe('contrast ratio', () => {
  it('is 21:1 for black on white — the maximum possible', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(ratio).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a colour against itself', () => {
    const colour = { r: 120, g: 45, b: 200, a: 1 };
    expect(contrastRatio(colour, colour)).toBe(1);
  });

  it('is symmetric — order of arguments does not matter', () => {
    const a = { r: 10, g: 92, b: 99, a: 1 };
    const b = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('matches published values for well-known pairs', () => {
    // #767676 on white is the canonical "exactly passes AA body text" grey.
    const grey = parseColor('#767676');
    const white = parseColor('#ffffff');
    expect(grey && white).toBeTruthy();
    expect(roundRatio(contrastRatio(grey!, white!))).toBeGreaterThanOrEqual(4.5);

    // #777777 on white falls just below.
    const lighterGrey = parseColor('#777777');
    expect(roundRatio(contrastRatio(lighterGrey!, white!))).toBeLessThan(4.5);
  });

  it('never rounds up into a passing ratio', () => {
    // 4.4999 must not present as 4.5.
    expect(roundRatio(4.4999)).toBe(4.49);
    expect(roundRatio(4.5)).toBe(4.5);
  });
});

describe('alpha compositing', () => {
  it('flattens a translucent foreground over its backdrop', () => {
    const result = flatten(
      { r: 0, g: 0, b: 0, a: 0.5 },
      { r: 255, g: 255, b: 255, a: 1 },
    );
    expect(result).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });

  it('leaves an opaque foreground unchanged', () => {
    const foreground = { r: 12, g: 34, b: 56, a: 1 };
    expect(flatten(foreground, { r: 255, g: 255, b: 255, a: 1 })).toEqual({
      ...foreground,
      a: 1,
    });
  });

  it('yields the backdrop for a fully transparent foreground', () => {
    const backdrop = { r: 200, g: 100, b: 50, a: 1 };
    expect(flatten({ r: 0, g: 0, b: 0, a: 0 }, backdrop)).toEqual(backdrop);
  });
});

describe('colour parsing', () => {
  it('parses hex in 3, 4, 6 and 8 digit forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0a5c63')).toEqual({ r: 10, g: 92, b: 99, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.502, 2);
    expect(parseColor('#f00f')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses both comma and space separated rgb syntax', () => {
    expect(parseColor('rgb(10, 92, 99)')).toEqual({ r: 10, g: 92, b: 99, a: 1 });
    expect(parseColor('rgb(10 92 99)')).toEqual({ r: 10, g: 92, b: 99, a: 1 });
    expect(parseColor('rgba(10, 92, 99, 0.5)')?.a).toBe(0.5);
    expect(parseColor('rgb(10 92 99 / 50%)')?.a).toBe(0.5);
  });

  it('parses hsl', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('hsl(120 100% 50%)')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
  });

  it('parses named colours', () => {
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('REBECCA')).toBeNull();
    expect(parseColor('transparent')?.a).toBe(0);
  });

  it('returns null for anything it cannot resolve statically', () => {
    // This is the important case: a rule must report cantTell rather than
    // guessing, so unresolvable input must not silently become a colour.
    expect(parseColor('currentColor')).toBeNull();
    expect(parseColor('var(--brand)')).toBeNull();
    expect(parseColor('inherit')).toBeNull();
    expect(parseColor('linear-gradient(red, blue)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor(null)).toBeNull();
  });
});

describe('large text thresholds', () => {
  it('treats 18pt (24px) and above as large', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
  });

  it('treats 14pt bold (18.66px) and above as large', () => {
    expect(isLargeText(18.67, BOLD_MIN_WEIGHT)).toBe(true);
    expect(isLargeText(18.67, 600)).toBe(false); // 600 is not bold per WCAG
    expect(isLargeText(18, 700)).toBe(false);
  });
});

describe('required contrast', () => {
  it('requires 4.5:1 for body text and 3:1 for large text at AA', () => {
    expect(requiredContrast('AA', false)).toBe(4.5);
    expect(requiredContrast('AA', true)).toBe(3);
  });

  it('requires 7:1 for body text and 4.5:1 for large text at AAA', () => {
    expect(requiredContrast('AAA', false)).toBe(7);
    expect(requiredContrast('AAA', true)).toBe(4.5);
  });
});
