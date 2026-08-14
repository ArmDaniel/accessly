import { describe, expect, it } from 'vitest';
import {
  GUIDELINES,
  PRINCIPLES,
  SUCCESS_CRITERIA,
  compareCriterionIds,
  criteriaForLevel,
  findCriterion,
  getCriterion,
  isInScope,
  levelsIncludedIn,
} from '../src/wcag.js';

/**
 * The catalogue is asserted against the published W3C Recommendation, not
 * against itself. These counts and titles come from
 * https://www.w3.org/TR/WCAG21/ — if a test here fails, the catalogue has
 * drifted from the standard and the catalogue is what is wrong.
 */
describe('WCAG 2.1 catalogue', () => {
  it('contains exactly the 78 published success criteria', () => {
    expect(SUCCESS_CRITERIA).toHaveLength(78);
  });

  it('splits into 30 level A, 20 level AA and 28 level AAA criteria', () => {
    const byLevel = (level: string) => SUCCESS_CRITERIA.filter((c) => c.level === level).length;
    expect(byLevel('A')).toBe(30);
    expect(byLevel('AA')).toBe(20);
    expect(byLevel('AAA')).toBe(28);
  });

  it('has 4 principles and 13 guidelines', () => {
    expect(PRINCIPLES).toHaveLength(4);
    expect(GUIDELINES).toHaveLength(13);
  });

  it('marks the 17 criteria that WCAG 2.1 added to 2.0', () => {
    const added = SUCCESS_CRITERIA.filter((c) => c.newInWcag21).map((c) => c.id);
    expect(added).toHaveLength(17);
    // Spot-check the ones people cite most often.
    expect(added).toContain('1.3.4'); // Orientation
    expect(added).toContain('1.4.10'); // Reflow
    expect(added).toContain('1.4.11'); // Non-text Contrast
    expect(added).toContain('2.5.3'); // Label in Name
    expect(added).toContain('4.1.3'); // Status Messages
    // ...and confirm a 2.0 criterion is not mislabelled.
    expect(added).not.toContain('1.4.3');
  });

  it('gives every criterion a unique id', () => {
    const ids = SUCCESS_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives each criterion’s guideline and principle from its number', () => {
    for (const criterion of SUCCESS_CRITERIA) {
      const [principle, guideline] = criterion.id.split('.');
      expect(criterion.principle).toBe(principle);
      expect(criterion.guideline).toBe(`${principle}.${guideline}`);
      expect(GUIDELINES.some((g) => g.id === criterion.guideline)).toBe(true);
    }
  });

  it('records the well-known criteria with their exact published titles', () => {
    const expectations: Record<string, [string, string]> = {
      '1.1.1': ['Non-text Content', 'A'],
      '1.4.3': ['Contrast (Minimum)', 'AA'],
      '1.4.6': ['Contrast (Enhanced)', 'AAA'],
      '2.1.1': ['Keyboard', 'A'],
      '2.4.7': ['Focus Visible', 'AA'],
      '3.1.1': ['Language of Page', 'A'],
      '4.1.2': ['Name, Role, Value', 'A'],
      '4.1.3': ['Status Messages', 'AA'],
    };

    for (const [id, [title, level]] of Object.entries(expectations)) {
      const criterion = getCriterion(id);
      expect(criterion.title).toBe(title);
      expect(criterion.level).toBe(level);
    }
  });

  it('points every criterion at a W3C Understanding document', () => {
    for (const criterion of SUCCESS_CRITERIA) {
      expect(criterion.url).toMatch(/^https:\/\/www\.w3\.org\/WAI\/WCAG21\/Understanding\/[a-z0-9-]+$/);
    }
  });
});

describe('conformance level scoping', () => {
  it('includes lower levels when targeting a higher one', () => {
    expect(levelsIncludedIn('A')).toEqual(['A']);
    expect(levelsIncludedIn('AA')).toEqual(['A', 'AA']);
    expect(levelsIncludedIn('AAA')).toEqual(['A', 'AA', 'AAA']);
  });

  it('treats level A criteria as in scope when targeting AA', () => {
    expect(isInScope('A', 'AA')).toBe(true);
    expect(isInScope('AA', 'AA')).toBe(true);
    expect(isInScope('AAA', 'AA')).toBe(false);
  });

  it('scopes 50 criteria at level AA', () => {
    // 30 level A + 20 level AA.
    expect(criteriaForLevel('AA')).toHaveLength(50);
    expect(criteriaForLevel('A')).toHaveLength(30);
    expect(criteriaForLevel('AAA')).toHaveLength(78);
  });
});

describe('lookups', () => {
  it('returns undefined for a criterion that is not in WCAG 2.1', () => {
    expect(findCriterion('2.4.11')).toBeUndefined(); // WCAG 2.2, not 2.1
    expect(findCriterion('9.9.9')).toBeUndefined();
  });

  it('throws on an unknown criterion so a rule typo fails at startup', () => {
    expect(() => getCriterion('2.4.11')).toThrowError(/Unknown WCAG 2\.1 success criterion/);
  });
});

describe('criterion ordering', () => {
  it('sorts 1.4.10 after 1.4.9, not lexically before it', () => {
    expect(compareCriterionIds('1.4.9', '1.4.10')).toBeLessThan(0);
    expect(compareCriterionIds('1.4.10', '1.4.9')).toBeGreaterThan(0);
    expect(compareCriterionIds('1.4.3', '1.4.3')).toBe(0);
    expect(compareCriterionIds('2.1.1', '1.4.13')).toBeGreaterThan(0);
  });
});
