import type { ConformanceLevel, CriterionId, PrincipleId } from './wcag.js';
import type { MediaKind } from './media.js';

// ─────────────────────────────────────────────────────────────────────────────
// Findings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Impact of a finding on real users.
 *
 * WCAG itself does not define severity — conformance is binary per criterion.
 * We keep impact strictly separate from conformance so a report can be honest
 * about both: "this fails 1.1.1 (level A)" is a conformance fact, while
 * "critical" is our prioritisation advice.
 */
export const IMPACTS = ['critical', 'serious', 'moderate', 'minor'] as const;
export type Impact = (typeof IMPACTS)[number];

/**
 * Outcome vocabulary aligned with the W3C "Evaluation and Report Language"
 * (EARL) outcome values, so reports can be exported to EARL later without
 * remodelling. https://www.w3.org/TR/EARL10-Schema/#OutcomeValue
 */
export const OUTCOMES = ['passed', 'failed', 'cantTell', 'inapplicable'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Where in the source document a finding lives. */
export interface SourceLocation {
  /** CSS selector that uniquely identifies the element in the audited document. */
  readonly selector: string;
  /** Truncated outer HTML, for human recognition in the report. */
  readonly snippet: string;
  readonly line?: number;
  readonly column?: number;
}

export interface Finding {
  /** Stable id, deterministic for the same rule + element across runs. */
  readonly id: string;
  readonly ruleId: string;
  readonly ruleTitle: string;
  readonly outcome: Extract<Outcome, 'failed' | 'cantTell'>;
  readonly impact: Impact;
  /** Every criterion this finding contributes a failure to. */
  readonly criteria: readonly CriterionId[];
  /** Highest-obligation level among `criteria` — the one that gates conformance. */
  readonly level: ConformanceLevel;
  /** What is wrong, in plain language, specific to this element. */
  readonly message: string;
  /** How to fix it. Actionable, not a restatement of the problem. */
  readonly remediation: string;
  readonly location: SourceLocation;
  /** Supporting technique/failure ids from WCAG's techniques documents. */
  readonly techniques?: readonly string[];
}

/**
 * Per-rule result. A rule that found nothing wrong still reports, because
 * "checked and passed" and "never checked" are very different claims to make
 * in an accessibility report.
 */
export interface RuleResult {
  readonly ruleId: string;
  readonly ruleTitle: string;
  readonly criteria: readonly CriterionId[];
  readonly outcome: Outcome;
  /** Elements the rule examined. Zero means the rule was inapplicable. */
  readonly elementsTested: number;
  readonly findings: readonly Finding[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface CriterionScore {
  readonly criterion: CriterionId;
  readonly title: string;
  readonly level: ConformanceLevel;
  readonly outcome: Outcome;
  readonly findingCount: number;
  /**
   * True when no automated rule covers this criterion at all. These criteria
   * require human review and are reported as such rather than silently passed.
   */
  readonly requiresManualReview: boolean;
}

export interface PrincipleScore {
  readonly principle: PrincipleId;
  readonly title: string;
  /** 0–100. */
  readonly score: number;
  readonly criteriaPassed: number;
  readonly criteriaFailed: number;
  readonly criteriaNotApplicable: number;
}

/**
 * Conformance is pass/fail per WCAG's own definition — a single unmet level A
 * criterion means the page does not conform at level A. The numeric score is
 * *progress reporting*, never a substitute for the conformance verdict.
 */
export interface Score {
  /** 0–100, weighted by conformance level and finding impact. */
  readonly value: number;
  /** Letter band derived from `value`, for at-a-glance reporting. */
  readonly band: ScoreBand;
  /** The highest level fully satisfied by the automated checks, if any. */
  readonly conformsTo: ConformanceLevel | null;
  /** Level the audit was run against. */
  readonly target: ConformanceLevel;
  readonly byPrinciple: readonly PrincipleScore[];
  readonly criteriaEvaluated: number;
  readonly criteriaPassed: number;
  readonly criteriaFailed: number;
  readonly criteriaRequiringManualReview: number;
}

export const SCORE_BANDS = ['excellent', 'good', 'fair', 'poor', 'critical'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Audits & reports
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIT_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** What was audited and how it was obtained. */
export interface AuditSubject {
  /** Canonical URL, or a synthetic `inline:` / `file:` URI for supplied bytes. */
  readonly url: string;
  /**
   * What was audited. Drives which rules were in scope and which standards the
   * report cites — a PDF is judged against PDF/UA as well as WCAG.
   */
  readonly mediaKind: MediaKind;
  /** Original filename, when the subject was uploaded rather than fetched. */
  readonly filename?: string | null;
  readonly title: string | null;
  /** Language declared on the root element, if any. */
  readonly lang: string | null;
  /** SHA-256 of the normalised document, used by the watcher to detect change. */
  readonly contentHash: string;
  readonly byteLength: number;
  readonly fetchedAt: string;
}

export interface AuditSummary {
  readonly total: number;
  readonly byImpact: Readonly<Record<Impact, number>>;
  readonly byLevel: Readonly<Record<ConformanceLevel, number>>;
}

export interface AuditReport {
  readonly id: string;
  readonly siteId: string | null;
  /**
   * Organisation that requested the audit. Every read endpoint scopes by it;
   * null only for internal runs (the self-audit, say) which are never served.
   */
  readonly organisationId: string | null;
  readonly status: AuditStatus;
  readonly target: ConformanceLevel;
  readonly subject: AuditSubject;
  readonly score: Score;
  readonly summary: AuditSummary;
  readonly criteria: readonly CriterionScore[];
  readonly rules: readonly RuleResult[];
  readonly findings: readonly Finding[];
  readonly engine: EngineInfo;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  /** Populated when `status === 'failed'`. */
  readonly error?: string;
}

export interface EngineInfo {
  readonly name: 'accessly-core';
  readonly version: string;
  readonly wcagVersion: '2.1';
  readonly rulesRun: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sites & the watcher
// ─────────────────────────────────────────────────────────────────────────────

export interface Organisation {
  readonly id: string;
  readonly name: string;
  readonly plan: SubscriptionPlan;
  readonly createdAt: string;
}

export const SUBSCRIPTION_PLANS = ['free', 'team', 'enterprise'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** A URL the organisation has registered for repeat auditing. */
export interface Site {
  readonly id: string;
  readonly organisationId: string;
  readonly url: string;
  readonly label: string;
  readonly target: ConformanceLevel;
  readonly createdAt: string;
  /** Most recent completed audit, if any. */
  readonly latestAuditId: string | null;
  readonly latestScore: number | null;
}

export const WATCH_INTERVALS = ['hourly', 'daily', 'weekly'] as const;
export type WatchInterval = (typeof WATCH_INTERVALS)[number];

export const WATCH_STATUSES = ['active', 'paused'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

/**
 * A standing instruction to re-audit a site on a schedule.
 *
 * The watcher exists to answer "did anything they shipped break accessibility?"
 * — so it hashes content on every poll and only spends a full audit when the
 * document actually changed, or when `auditUnchanged` is set.
 */
export interface Watch {
  readonly id: string;
  readonly siteId: string;
  readonly organisationId: string;
  readonly interval: WatchInterval;
  readonly status: WatchStatus;
  /** Content hash observed on the last successful poll. */
  readonly lastContentHash: string | null;
  readonly lastPolledAt: string | null;
  readonly nextPollAt: string;
  /** Re-audit even when the content hash is unchanged. Off by default. */
  readonly auditUnchanged: boolean;
  readonly createdAt: string;
}

export const WATCH_EVENT_KINDS = [
  'polled',
  'unchanged',
  'changed',
  'audited',
  'regressed',
  'improved',
  'poll_failed',
] as const;
export type WatchEventKind = (typeof WATCH_EVENT_KINDS)[number];

/** Append-only audit trail for a watch. This is the compliance evidence. */
export interface WatchEvent {
  readonly id: string;
  readonly watchId: string;
  readonly kind: WatchEventKind;
  readonly at: string;
  readonly auditId: string | null;
  readonly message: string;
  /** Score delta versus the previous audit, when the event produced one. */
  readonly scoreDelta: number | null;
}

/** Diff between two audits of the same site — what the watcher actually reports. */
export interface AuditDiff {
  readonly previousAuditId: string;
  readonly currentAuditId: string;
  readonly scoreDelta: number;
  /** Findings present now but not before. */
  readonly introduced: readonly Finding[];
  /** Findings present before but not now. */
  readonly resolved: readonly Finding[];
  readonly unchangedCount: number;
  /** Criteria that went from passing to failing. */
  readonly criteriaRegressed: readonly CriterionId[];
  readonly criteriaFixed: readonly CriterionId[];
}
