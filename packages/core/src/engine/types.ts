import type { ConformanceLevel, CriterionId, Impact, MediaKind } from '@accessly/contracts';
import type { ParsedDocument } from '../dom/parse.js';
import type { StyleModel } from '../dom/styles.js';
import type { AccessibleNode, AccessibleTree, NodeRole } from '../tree/node.js';

/** Everything a rule is allowed to see. Rules must be pure functions of this. */
export interface RuleContext {
  readonly parsed: ParsedDocument;
  readonly document: Document;
  /** Pre-parsed stylesheet model, shared across all rules for one audit. */
  readonly styleModel: StyleModel;
  /** Conformance level the audit is targeting. */
  readonly target: ConformanceLevel;
  /** Base URL for resolving relative links, when known. */
  readonly baseUrl: string | null;
}

/** What a rule concluded about one element. */
export type ElementVerdict =
  | { readonly outcome: 'passed' }
  /** The element is outside this rule's scope after closer inspection. */
  | { readonly outcome: 'inapplicable' }
  | {
      readonly outcome: 'failed' | 'cantTell';
      readonly message: string;
      readonly remediation: string;
      /** Overrides the rule's default impact for this specific element. */
      readonly impact?: Impact;
    };

/** A document-level finding, optionally anchored to an element. */
export interface DocumentIssue {
  readonly element: Element | null;
  readonly outcome: 'failed' | 'cantTell';
  readonly message: string;
  readonly remediation: string;
  readonly impact?: Impact;
}

export interface DocumentVerdict {
  /** How many things the rule looked at. Zero means inapplicable. */
  readonly elementsTested: number;
  readonly issues: readonly DocumentIssue[];
}

/**
 * What a rule is actually capable of concluding.
 *
 * This distinction is the difference between honest and flattering coverage
 * reporting. An `advisory` rule can only ever say "a human needs to look at
 * this" — it can raise the question but never settle it. If such a rule counted
 * as covering its criterion, we could claim 100% WCAG coverage tomorrow by
 * adding 78 rules that each say "please check". That number would be worthless,
 * and worse, the score would start awarding partial credit for criteria nobody
 * has actually verified.
 *
 * So: only `automated` rules count towards coverage and towards the score.
 * Advisory rules are reported separately, as review prompts.
 */
export type RuleDetection =
  /** Can produce a confirmed `failed` outcome from the markup alone. */
  | 'automated'
  /** Only ever produces `cantTell`. Raises the question; cannot answer it. */
  | 'advisory';

interface RuleBase {
  /** Stable, kebab-case, unique. Appears in reports and in customer tickets. */
  readonly id: string;
  readonly title: string;
  /** One sentence: what this rule checks and why it matters to a user. */
  readonly help: string;
  /** Every criterion a failure of this rule violates. Must be non-empty. */
  readonly criteria: readonly CriterionId[];
  readonly impact: Impact;
  /** Defaults to `automated` when omitted. */
  readonly detection?: RuleDetection;
  /** WCAG technique / failure identifiers, e.g. `["H37", "F65"]`. */
  readonly techniques?: readonly string[];
}

/** A rule that visits each element matching `selector` independently. */
export interface ElementRule extends RuleBase {
  readonly kind: 'element';
  readonly selector: string;
  /** Narrow the candidate set before evaluation (e.g. skip hidden elements). */
  readonly filter?: (element: Element, context: RuleContext) => boolean;
  readonly evaluate: (element: Element, context: RuleContext) => ElementVerdict;
}

/** A rule that reasons about the document as a whole (counts, ordering, uniqueness). */
export interface DocumentRule extends RuleBase {
  readonly kind: 'document';
  readonly evaluate: (context: RuleContext) => DocumentVerdict;
}

/**
 * Everything a format-neutral rule is allowed to see.
 *
 * Deliberately has no `document`. A rule written against this cannot reach for
 * the DOM even by accident, which is what guarantees it works unchanged on a
 * PDF or a slide deck.
 */
export interface TreeContext {
  readonly tree: AccessibleTree;
  readonly mediaKind: MediaKind;
  readonly target: ConformanceLevel;
}

/** A rule that visits each node of a given role. */
export interface NodeRule extends RuleBase {
  readonly kind: 'node';
  /** Roles to visit. */
  readonly role: NodeRole | readonly NodeRole[];
  /**
   * Formats this rule applies to. Omit for "every format".
   *
   * This is what keeps coverage honest per format: a rule that cannot apply to
   * a PDF never runs on one, so it never appears as covering a criterion the
   * PDF audit did not actually check.
   */
  readonly media?: readonly MediaKind[];
  readonly filter?: (node: AccessibleNode, context: TreeContext) => boolean;
  readonly evaluate: (node: AccessibleNode, context: TreeContext) => ElementVerdict;
}

/** A rule that reasons about the whole tree — ordering, counts, uniqueness. */
export interface TreeRule extends RuleBase {
  readonly kind: 'tree';
  readonly media?: readonly MediaKind[];
  readonly evaluate: (context: TreeContext) => TreeVerdict;
}

/** A tree-level finding, optionally anchored to a node. */
export interface TreeIssue {
  readonly node: AccessibleNode | null;
  readonly outcome: 'failed' | 'cantTell';
  readonly message: string;
  readonly remediation: string;
  readonly impact?: Impact;
}

export interface TreeVerdict {
  readonly elementsTested: number;
  readonly issues: readonly TreeIssue[];
}

export type Rule = ElementRule | DocumentRule | NodeRule | TreeRule;

/** Rules that need a DOM, and therefore only ever run on HTML. */
export type DomRule = ElementRule | DocumentRule;

/** Rules that run on the format-neutral tree. */
export type TreeSurfaceRule = NodeRule | TreeRule;

export function isDomRule(rule: Rule): rule is DomRule {
  return rule.kind === 'element' || rule.kind === 'document';
}

export function isTreeRule(rule: Rule): rule is TreeSurfaceRule {
  return rule.kind === 'node' || rule.kind === 'tree';
}

/**
 * Does this rule apply to the format being audited?
 *
 * DOM rules are HTML-only by construction. Tree rules say so themselves, and
 * default to every format.
 */
export function appliesToMedia(rule: Rule, mediaKind: MediaKind): boolean {
  if (isDomRule(rule)) return mediaKind === 'html';
  return rule.media === undefined || rule.media.includes(mediaKind);
}
