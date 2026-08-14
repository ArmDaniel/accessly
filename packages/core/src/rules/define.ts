import type { DocumentRule, ElementRule } from '../engine/types.js';

/**
 * Identity helpers that exist purely for type inference — they let each rule be
 * written as an object literal while still being checked against the `Rule`
 * contract at the definition site, where the error message is useful.
 */
export const elementRule = (rule: Omit<ElementRule, 'kind'>): ElementRule => ({
  ...rule,
  kind: 'element',
});

export const documentRule = (rule: Omit<DocumentRule, 'kind'>): DocumentRule => ({
  ...rule,
  kind: 'document',
});

export const PASS = { outcome: 'passed' } as const;
export const SKIP = { outcome: 'inapplicable' } as const;
