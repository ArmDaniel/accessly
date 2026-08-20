export { auditHtml, diffAudits, ENGINE_VERSION, type AuditOptions } from './audit.js';
export { auditTree, hashBytes, treeText, type MediaAuditOptions } from './audit-media.js';

export {
  ancestry,
  countByRole,
  descendants,
  findByRole,
  node,
  nextNodeId,
  parentOf,
  resetNodeIds,
  textContent,
  unknownAbout,
  walk,
  NODE_ROLES,
  type AccessibleNode,
  type AccessibleTree,
  type NodeInit,
  type NodeLocator,
  type NodeRole,
  type TreeUnknown,
} from './tree/node.js';
export { treeFromDocument, type DomTreeOptions } from './tree/from-dom.js';

export {
  analyseJourney,
  evaluateJourney,
  reconstruct,
  type AnalyseOptions,
  type Session,
} from './journey/analyse.js';
export { journeyRules, type JourneyRule } from './journey/rules.js';

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
export { runRules, runTreeRules, type RunOptions, type RunTreeOptions, type RunResult } from './engine/runner.js';
export type {
  DocumentIssue,
  DocumentRule,
  DomRule,
  ElementRule,
  ElementVerdict,
  NodeRule,
  Rule,
  RuleContext,
  RuleDetection,
  TreeContext,
  TreeIssue,
  TreeRule,
  TreeSurfaceRule,
  TreeVerdict,
} from './engine/types.js';
export { appliesToMedia, isDomRule, isTreeRule } from './engine/types.js';

export { calculateScore, SCORING_WEIGHTS, type ScoreInput, type ScoreOutput } from './scoring/score.js';

export {
  allRules,
  createDefaultRegistry,
  defaultRegistry,
  operableRules,
  perceivableRules,
  robustRules,
  understandableRules,
  structureRules,
  captionRules,
} from './rules/index.js';
