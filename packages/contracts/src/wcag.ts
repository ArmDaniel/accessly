/**
 * The WCAG 2.1 catalogue.
 *
 * Source of truth: W3C Recommendation "Web Content Accessibility Guidelines
 * (WCAG) 2.1" — https://www.w3.org/TR/WCAG21/
 *
 * This file is deliberately *data only*. Every rule in @accessly/core must cite
 * at least one criterion id from here, and the test suite asserts that the
 * catalogue matches the published Recommendation exactly: 4 principles,
 * 13 guidelines, 78 success criteria (30 A, 20 AA, 28 AAA).
 *
 * Nothing here may be edited to make a rule "fit" — if a rule has no home in
 * this catalogue, the rule is wrong, not the catalogue.
 */

export const CONFORMANCE_LEVELS = ['A', 'AA', 'AAA'] as const;
export type ConformanceLevel = (typeof CONFORMANCE_LEVELS)[number];

export const PRINCIPLE_IDS = ['1', '2', '3', '4'] as const;
export type PrincipleId = (typeof PRINCIPLE_IDS)[number];

/** A WCAG success criterion number, e.g. `"1.4.3"`. */
export type CriterionId = string;

export interface SuccessCriterion {
  /** Dotted criterion number, e.g. "1.4.3". */
  readonly id: CriterionId;
  /** Official criterion title, e.g. "Contrast (Minimum)". */
  readonly title: string;
  readonly level: ConformanceLevel;
  /** Owning guideline number, e.g. "1.4". */
  readonly guideline: string;
  /** Owning principle number, e.g. "1". */
  readonly principle: PrincipleId;
  /** Canonical "Understanding" document URL. */
  readonly url: string;
  /** True when 2.1 introduced this criterion (i.e. it is not in WCAG 2.0). */
  readonly newInWcag21: boolean;
}

export interface Guideline {
  readonly id: string;
  readonly title: string;
  readonly principle: PrincipleId;
}

export interface Principle {
  readonly id: PrincipleId;
  readonly title: string;
}

export const PRINCIPLES: readonly Principle[] = [
  { id: '1', title: 'Perceivable' },
  { id: '2', title: 'Operable' },
  { id: '3', title: 'Understandable' },
  { id: '4', title: 'Robust' },
] as const;

export const GUIDELINES: readonly Guideline[] = [
  { id: '1.1', title: 'Text Alternatives', principle: '1' },
  { id: '1.2', title: 'Time-based Media', principle: '1' },
  { id: '1.3', title: 'Adaptable', principle: '1' },
  { id: '1.4', title: 'Distinguishable', principle: '1' },
  { id: '2.1', title: 'Keyboard Accessible', principle: '2' },
  { id: '2.2', title: 'Enough Time', principle: '2' },
  { id: '2.3', title: 'Seizures and Physical Reactions', principle: '2' },
  { id: '2.4', title: 'Navigable', principle: '2' },
  { id: '2.5', title: 'Input Modalities', principle: '2' },
  { id: '3.1', title: 'Readable', principle: '3' },
  { id: '3.2', title: 'Predictable', principle: '3' },
  { id: '3.3', title: 'Input Assistance', principle: '3' },
  { id: '4.1', title: 'Compatible', principle: '4' },
] as const;

/** Slugs for the W3C "Understanding" documents, keyed by criterion id. */
const UNDERSTANDING_BASE = 'https://www.w3.org/WAI/WCAG21/Understanding/';

interface CriterionSeed {
  id: string;
  title: string;
  level: ConformanceLevel;
  slug: string;
  /** New in WCAG 2.1. */
  n21?: true;
}

const SEEDS: readonly CriterionSeed[] = [
  // ── 1. Perceivable ───────────────────────────────────────────────────────
  { id: '1.1.1', title: 'Non-text Content', level: 'A', slug: 'non-text-content' },

  { id: '1.2.1', title: 'Audio-only and Video-only (Prerecorded)', level: 'A', slug: 'audio-only-and-video-only-prerecorded' },
  { id: '1.2.2', title: 'Captions (Prerecorded)', level: 'A', slug: 'captions-prerecorded' },
  { id: '1.2.3', title: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', slug: 'audio-description-or-media-alternative-prerecorded' },
  { id: '1.2.4', title: 'Captions (Live)', level: 'AA', slug: 'captions-live' },
  { id: '1.2.5', title: 'Audio Description (Prerecorded)', level: 'AA', slug: 'audio-description-prerecorded' },
  { id: '1.2.6', title: 'Sign Language (Prerecorded)', level: 'AAA', slug: 'sign-language-prerecorded' },
  { id: '1.2.7', title: 'Extended Audio Description (Prerecorded)', level: 'AAA', slug: 'extended-audio-description-prerecorded' },
  { id: '1.2.8', title: 'Media Alternative (Prerecorded)', level: 'AAA', slug: 'media-alternative-prerecorded' },
  { id: '1.2.9', title: 'Audio-only (Live)', level: 'AAA', slug: 'audio-only-live' },

  { id: '1.3.1', title: 'Info and Relationships', level: 'A', slug: 'info-and-relationships' },
  { id: '1.3.2', title: 'Meaningful Sequence', level: 'A', slug: 'meaningful-sequence' },
  { id: '1.3.3', title: 'Sensory Characteristics', level: 'A', slug: 'sensory-characteristics' },
  { id: '1.3.4', title: 'Orientation', level: 'AA', slug: 'orientation', n21: true },
  { id: '1.3.5', title: 'Identify Input Purpose', level: 'AA', slug: 'identify-input-purpose', n21: true },
  { id: '1.3.6', title: 'Identify Purpose', level: 'AAA', slug: 'identify-purpose', n21: true },

  { id: '1.4.1', title: 'Use of Color', level: 'A', slug: 'use-of-color' },
  { id: '1.4.2', title: 'Audio Control', level: 'A', slug: 'audio-control' },
  { id: '1.4.3', title: 'Contrast (Minimum)', level: 'AA', slug: 'contrast-minimum' },
  { id: '1.4.4', title: 'Resize text', level: 'AA', slug: 'resize-text' },
  { id: '1.4.5', title: 'Images of Text', level: 'AA', slug: 'images-of-text' },
  { id: '1.4.6', title: 'Contrast (Enhanced)', level: 'AAA', slug: 'contrast-enhanced' },
  { id: '1.4.7', title: 'Low or No Background Audio', level: 'AAA', slug: 'low-or-no-background-audio' },
  { id: '1.4.8', title: 'Visual Presentation', level: 'AAA', slug: 'visual-presentation' },
  { id: '1.4.9', title: 'Images of Text (No Exception)', level: 'AAA', slug: 'images-of-text-no-exception' },
  { id: '1.4.10', title: 'Reflow', level: 'AA', slug: 'reflow', n21: true },
  { id: '1.4.11', title: 'Non-text Contrast', level: 'AA', slug: 'non-text-contrast', n21: true },
  { id: '1.4.12', title: 'Text Spacing', level: 'AA', slug: 'text-spacing', n21: true },
  { id: '1.4.13', title: 'Content on Hover or Focus', level: 'AA', slug: 'content-on-hover-or-focus', n21: true },

  // ── 2. Operable ──────────────────────────────────────────────────────────
  { id: '2.1.1', title: 'Keyboard', level: 'A', slug: 'keyboard' },
  { id: '2.1.2', title: 'No Keyboard Trap', level: 'A', slug: 'no-keyboard-trap' },
  { id: '2.1.3', title: 'Keyboard (No Exception)', level: 'AAA', slug: 'keyboard-no-exception' },
  { id: '2.1.4', title: 'Character Key Shortcuts', level: 'A', slug: 'character-key-shortcuts', n21: true },

  { id: '2.2.1', title: 'Timing Adjustable', level: 'A', slug: 'timing-adjustable' },
  { id: '2.2.2', title: 'Pause, Stop, Hide', level: 'A', slug: 'pause-stop-hide' },
  { id: '2.2.3', title: 'No Timing', level: 'AAA', slug: 'no-timing' },
  { id: '2.2.4', title: 'Interruptions', level: 'AAA', slug: 'interruptions' },
  { id: '2.2.5', title: 'Re-authenticating', level: 'AAA', slug: 're-authenticating' },
  { id: '2.2.6', title: 'Timeouts', level: 'AAA', slug: 'timeouts', n21: true },

  { id: '2.3.1', title: 'Three Flashes or Below Threshold', level: 'A', slug: 'three-flashes-or-below-threshold' },
  { id: '2.3.2', title: 'Three Flashes', level: 'AAA', slug: 'three-flashes' },
  { id: '2.3.3', title: 'Animation from Interactions', level: 'AAA', slug: 'animation-from-interactions', n21: true },

  { id: '2.4.1', title: 'Bypass Blocks', level: 'A', slug: 'bypass-blocks' },
  { id: '2.4.2', title: 'Page Titled', level: 'A', slug: 'page-titled' },
  { id: '2.4.3', title: 'Focus Order', level: 'A', slug: 'focus-order' },
  { id: '2.4.4', title: 'Link Purpose (In Context)', level: 'A', slug: 'link-purpose-in-context' },
  { id: '2.4.5', title: 'Multiple Ways', level: 'AA', slug: 'multiple-ways' },
  { id: '2.4.6', title: 'Headings and Labels', level: 'AA', slug: 'headings-and-labels' },
  { id: '2.4.7', title: 'Focus Visible', level: 'AA', slug: 'focus-visible' },
  { id: '2.4.8', title: 'Location', level: 'AAA', slug: 'location' },
  { id: '2.4.9', title: 'Link Purpose (Link Only)', level: 'AAA', slug: 'link-purpose-link-only' },
  { id: '2.4.10', title: 'Section Headings', level: 'AAA', slug: 'section-headings' },

  { id: '2.5.1', title: 'Pointer Gestures', level: 'A', slug: 'pointer-gestures', n21: true },
  { id: '2.5.2', title: 'Pointer Cancellation', level: 'A', slug: 'pointer-cancellation', n21: true },
  { id: '2.5.3', title: 'Label in Name', level: 'A', slug: 'label-in-name', n21: true },
  { id: '2.5.4', title: 'Motion Actuation', level: 'A', slug: 'motion-actuation', n21: true },
  { id: '2.5.5', title: 'Target Size', level: 'AAA', slug: 'target-size', n21: true },
  { id: '2.5.6', title: 'Concurrent Input Mechanisms', level: 'AAA', slug: 'concurrent-input-mechanisms', n21: true },

  // ── 3. Understandable ────────────────────────────────────────────────────
  { id: '3.1.1', title: 'Language of Page', level: 'A', slug: 'language-of-page' },
  { id: '3.1.2', title: 'Language of Parts', level: 'AA', slug: 'language-of-parts' },
  { id: '3.1.3', title: 'Unusual Words', level: 'AAA', slug: 'unusual-words' },
  { id: '3.1.4', title: 'Abbreviations', level: 'AAA', slug: 'abbreviations' },
  { id: '3.1.5', title: 'Reading Level', level: 'AAA', slug: 'reading-level' },
  { id: '3.1.6', title: 'Pronunciation', level: 'AAA', slug: 'pronunciation' },

  { id: '3.2.1', title: 'On Focus', level: 'A', slug: 'on-focus' },
  { id: '3.2.2', title: 'On Input', level: 'A', slug: 'on-input' },
  { id: '3.2.3', title: 'Consistent Navigation', level: 'AA', slug: 'consistent-navigation' },
  { id: '3.2.4', title: 'Consistent Identification', level: 'AA', slug: 'consistent-identification' },
  { id: '3.2.5', title: 'Change on Request', level: 'AAA', slug: 'change-on-request' },

  { id: '3.3.1', title: 'Error Identification', level: 'A', slug: 'error-identification' },
  { id: '3.3.2', title: 'Labels or Instructions', level: 'A', slug: 'labels-or-instructions' },
  { id: '3.3.3', title: 'Error Suggestion', level: 'AA', slug: 'error-suggestion' },
  { id: '3.3.4', title: 'Error Prevention (Legal, Financial, Data)', level: 'AA', slug: 'error-prevention-legal-financial-data' },
  { id: '3.3.5', title: 'Help', level: 'AAA', slug: 'help' },
  { id: '3.3.6', title: 'Error Prevention (All)', level: 'AAA', slug: 'error-prevention-all' },

  // ── 4. Robust ────────────────────────────────────────────────────────────
  { id: '4.1.1', title: 'Parsing', level: 'A', slug: 'parsing' },
  { id: '4.1.2', title: 'Name, Role, Value', level: 'A', slug: 'name-role-value' },
  { id: '4.1.3', title: 'Status Messages', level: 'AA', slug: 'status-messages', n21: true },
] as const;

export const SUCCESS_CRITERIA: readonly SuccessCriterion[] = SEEDS.map((seed) => {
  const [principle, minor] = seed.id.split('.') as [PrincipleId, string];
  return {
    id: seed.id,
    title: seed.title,
    level: seed.level,
    guideline: `${principle}.${minor}`,
    principle,
    url: `${UNDERSTANDING_BASE}${seed.slug}`,
    newInWcag21: seed.n21 === true,
  };
});

const CRITERION_INDEX: ReadonlyMap<CriterionId, SuccessCriterion> = new Map(
  SUCCESS_CRITERIA.map((c) => [c.id, c]),
);

/** Look up a criterion, or `undefined` if the id is not part of WCAG 2.1. */
export function findCriterion(id: CriterionId): SuccessCriterion | undefined {
  return CRITERION_INDEX.get(id);
}

/**
 * Look up a criterion, throwing when it does not exist.
 * Used at module-load time by the rule registry so a typo'd citation is a
 * startup crash rather than a silently mis-attributed finding in a report.
 */
export function getCriterion(id: CriterionId): SuccessCriterion {
  const found = CRITERION_INDEX.get(id);
  if (!found) {
    throw new Error(
      `Unknown WCAG 2.1 success criterion "${id}". Rules may only cite criteria that exist in the published Recommendation.`,
    );
  }
  return found;
}

/** Conformance to level AA requires satisfying both A and AA criteria. */
export function levelsIncludedIn(target: ConformanceLevel): readonly ConformanceLevel[] {
  switch (target) {
    case 'A':
      return ['A'];
    case 'AA':
      return ['A', 'AA'];
    case 'AAA':
      return ['A', 'AA', 'AAA'];
  }
}

/** True when `level` must be satisfied in order to claim conformance at `target`. */
export function isInScope(level: ConformanceLevel, target: ConformanceLevel): boolean {
  return levelsIncludedIn(target).includes(level);
}

export function criteriaForLevel(target: ConformanceLevel): readonly SuccessCriterion[] {
  return SUCCESS_CRITERIA.filter((c) => isInScope(c.level, target));
}

export function guidelineById(id: string): Guideline | undefined {
  return GUIDELINES.find((g) => g.id === id);
}

export function principleById(id: PrincipleId): Principle | undefined {
  return PRINCIPLES.find((p) => p.id === id);
}

/** Sort helper: orders "1.4.10" after "1.4.9" rather than before it. */
export function compareCriterionIds(a: CriterionId, b: CriterionId): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
