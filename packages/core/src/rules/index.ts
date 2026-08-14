import { RuleRegistry } from '../engine/registry.js';
import type { Rule } from '../engine/types.js';
import { perceivableRules } from './perceivable.js';
import { operableRules } from './operable.js';
import { understandableRules } from './understandable.js';
import { robustRules } from './robust.js';
import { extendedRules } from './extended.js';

export const allRules: readonly Rule[] = [
  ...perceivableRules,
  ...operableRules,
  ...understandableRules,
  ...robustRules,
  ...extendedRules,
];

/**
 * The default registry.
 *
 * Built once at module load. Registration validates every criterion citation
 * against the WCAG catalogue, so an invalid rule crashes the process at import
 * time rather than producing a wrong report at runtime.
 */
export function createDefaultRegistry(): RuleRegistry {
  return new RuleRegistry().registerAll(allRules);
}

export const defaultRegistry: RuleRegistry = createDefaultRegistry();

export { perceivableRules, operableRules, understandableRules, robustRules, extendedRules };
