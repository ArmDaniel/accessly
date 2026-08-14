export { auditHtml, diffAudits, ENGINE_VERSION, type AuditOptions } from './audit.js';

export { parseDocument, hashContent, normaliseForHash, type ParsedDocument } from './dom/parse.js';
export { cssPath, snippet } from './dom/selector.js';
export {
  contrastRatio,
  flatten,
  isLargeText,
  parseColor,
  relativeLuminance,
  requiredContrast,
  roundRatio,
  type Rgba,
} from './dom/color.js';
export { accessibleName, accessibleDescription, visibleText } from './dom/accname.js';
export {
  computeRole,
  implicitRole,
  isFocusable,
  isHiddenFromAccessibilityTree,
  isVisible,
  LANDMARK_ROLES,
  WIDGET_ROLES,
} from './dom/aria.js';
export { scriptText, styleText, normalisedStyleText } from './dom/collect.js';
export {
  collectStyleRules,
  resolveTextStyle,
  resolveVars,
  palettes,
  parseFontSize,
  parseFontWeight,
  EMPTY_STYLE_MODEL,
  type ResolvedTextStyle,
  type StyleModel,
} from './dom/styles.js';

export { RuleRegistry } from './engine/registry.js';
export { runRules, type RunOptions, type RunResult } from './engine/runner.js';
export type {
  DocumentIssue,
  DocumentRule,
  ElementRule,
  ElementVerdict,
  Rule,
  RuleContext,
} from './engine/types.js';

export { calculateScore, SCORING_WEIGHTS, type ScoreInput, type ScoreOutput } from './scoring/score.js';

export {
  allRules,
  createDefaultRegistry,
  defaultRegistry,
  operableRules,
  perceivableRules,
  robustRules,
  understandableRules,
} from './rules/index.js';
