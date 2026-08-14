import type { ConformanceLevel, CriterionId, Impact } from '@accessly/contracts';
import type { ParsedDocument } from '../dom/parse.js';
import type { StyleModel } from '../dom/styles.js';

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

export type Rule = ElementRule | DocumentRule;
