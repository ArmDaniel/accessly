/**
 * Journeys: accessibility monitoring from the user's perspective.
 *
 * Page-level auditing answers "is this markup correct". It cannot answer the
 * questions that actually decide whether someone can use a site, because those
 * are properties of a *sequence*: where did focus go when the dialog closed,
 * was the route change announced, did anything tell me the form submitted.
 * Those are precisely the criteria our static engine reports as `cantTell`.
 *
 * The design is adapted from OpenReplay's session replay. We borrow its shape —
 * a flat, appendable stream of numerically-typed messages, tracker-assigned
 * node ids, and interleaved timestamps rather than a timestamp per message —
 * because that shape is proven for recording a browser session cheaply and
 * replaying it faithfully.
 *
 * What we change is *what gets recorded*. OpenReplay captures DOM mutations to
 * reconstruct pixels. We capture the accessibility experience: focus movement,
 * live-region announcements, dialog transitions, route changes. The replay is
 * therefore not a video of the screen — it is a transcript of what a screen
 * reader user would have heard and where their focus was, which is the thing
 * you cannot reconstruct from a video and cannot infer from static markup.
 *
 * A deliberate privacy consequence: we never record input *values*, only that
 * a field was edited. A session replay of a checkout is a data-protection
 * liability; a transcript of focus and announcements is not.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The message protocol
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Message type ids.
 *
 * Numeric and stable, so a tracker deployed on a customer's site keeps working
 * against a newer server. Ranges are grouped by concern, leaving room to add
 * within a group without renumbering: 0–9 session, 10–19 structure, 20–39
 * experience, 40–49 verdicts.
 */
export const TraceMessageType = {
  /** Wall-clock reference. Emitted periodically; other messages carry offsets. */
  Timestamp: 0,
  SessionStart: 1,
  Navigated: 2,
  ViewportResized: 3,

  NodeAdded: 10,
  NodeRemoved: 11,
  NodeRenamed: 12,
  NodeStateChanged: 13,

  FocusMoved: 20,
  Announced: 21,
  DialogOpened: 22,
  DialogClosed: 23,
  InputEdited: 24,
  KeyPressed: 25,
  PointerActivated: 26,

  StepStarted: 30,
  StepEnded: 31,

  AuditSnapshot: 40,
} as const;

export type TraceMessageTypeId = (typeof TraceMessageType)[keyof typeof TraceMessageType];

/** How focus came to move. The distinction is what makes the trace diagnostic. */
export const FOCUS_CAUSES = ['keyboard', 'pointer', 'script', 'lost'] as const;
export type FocusCause = (typeof FOCUS_CAUSES)[number];

export const ANNOUNCEMENT_POLITENESS = ['polite', 'assertive'] as const;
export type AnnouncementPoliteness = (typeof ANNOUNCEMENT_POLITENESS)[number];

/**
 * One recorded message.
 *
 * `t` is the type id, `o` the millisecond offset from the last `Timestamp`, and
 * the rest are type-specific. Short keys because a trace of a long session is
 * thousands of these and it travels over the wire from a customer's browser.
 */
export interface TraceMessage {
  /** Type id. */
  readonly t: TraceMessageTypeId;
  /** Milliseconds since the session started. */
  readonly o: number;
  /** Node id, for messages that concern one. */
  readonly id?: number;
  /** Parent node id. */
  readonly p?: number;
  /** Index among siblings. */
  readonly i?: number;
  /** Accessible role. */
  readonly r?: string;
  /** Accessible name, announcement text, URL, or key name. */
  readonly v?: string;
  /** Secondary string: focus cause, politeness, state name. */
  readonly s?: string;
  /** Numeric payload: viewport width, score. */
  readonly n?: number;
  /** Secondary numeric: viewport height, failure count. */
  readonly m?: number;
  /** Boolean flag: modal, step success. */
  readonly b?: boolean;
}

/** A recorded session, as posted by the tracker. */
export interface JourneyTrace {
  readonly id: string;
  readonly journeyId: string | null;
  readonly organisationId: string | null;
  /** Tracker protocol version, so the server can refuse what it cannot read. */
  readonly version: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly url: string;
  readonly messages: readonly TraceMessage[];
  /**
   * Coarse client description. Deliberately not a full user-agent string: we
   * want "did this work with a keyboard" not "who is this person".
   */
  readonly client: {
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly prefersReducedMotion: boolean;
    readonly forcedColors: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Journey definitions — "things to monitor"
// ─────────────────────────────────────────────────────────────────────────────

export const STEP_ACTIONS = ['navigate', 'click', 'type', 'press', 'wait', 'assert'] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

/**
 * One step of a monitored flow.
 *
 * Declarative so a journey is data rather than code: it can be stored,
 * versioned, diffed between deploys, and — importantly — written by the
 * accessibility specialist rather than by whoever owns the test suite.
 */
export interface JourneyStep {
  readonly id: string;
  readonly label: string;
  readonly action: StepAction;
  /** CSS selector, URL, or key name, depending on the action. */
  readonly target?: string;
  /**
   * What must be true after this step, checked against the recorded trace.
   * These are the accessibility expectations, not functional ones.
   */
  readonly expect?: StepExpectation;
}

/**
 * What must be true after a step.
 *
 * Every field here is something the trace can actually settle. A selector-based
 * expectation ("focus must land inside #dialog") is deliberately absent: the
 * trace records accessible names and roles, not selectors, so we could only
 * ever have checked that focus moved *somewhere* — and reported a step as
 * satisfied while the defect it was written to catch went past. An expectation
 * we cannot enforce is worse than no expectation, because it looks like cover.
 */
export interface StepExpectation {
  /** Something must be announced; optionally matching this text. */
  readonly announces?: string | true;
  /** Focus must move at least once during the step. */
  readonly focusMoves?: boolean;
  /** The step must be completable without a pointer. */
  readonly keyboardOnly?: boolean;
  /** A dialog must open during the step. */
  readonly dialogOpen?: boolean;
}

export interface Journey {
  readonly id: string;
  readonly organisationId: string;
  readonly siteId: string | null;
  readonly name: string;
  readonly description: string;
  readonly startUrl: string;
  readonly steps: readonly JourneyStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reconstructed moment in the session.
 *
 * The player walks these. Each carries what a user could perceive at that
 * instant: where focus was, what had just been announced, what was on screen.
 */
export interface TimelineFrame {
  readonly index: number;
  readonly offsetMs: number;
  readonly kind: string;
  /** One line describing what happened, written for a person. */
  readonly summary: string;
  /** Accessible name of the focused element, or null when focus was lost. */
  readonly focus: string | null;
  readonly focusRole: string | null;
  readonly focusCause: FocusCause | null;
  /** Text announced at this moment, if any. */
  readonly announcement: string | null;
  readonly politeness: AnnouncementPoliteness | null;
  readonly url: string | null;
  /** Step this frame belongs to, when the journey defined steps. */
  readonly stepId: string | null;
  /** Findings raised at this frame. */
  readonly findingIds: readonly string[];
}

export interface JourneyReportSummary {
  readonly frames: number;
  readonly durationMs: number;
  readonly announcements: number;
  readonly focusMoves: number;
  /** Times focus ended up nowhere — the defect users notice most. */
  readonly focusLosses: number;
  readonly keyboardOnly: boolean;
}

export interface JourneyReport {
  readonly id: string;
  readonly traceId: string;
  readonly journeyId: string | null;
  readonly organisationId: string | null;
  readonly name: string;
  readonly startedAt: string;
  readonly summary: JourneyReportSummary;
  readonly timeline: readonly TimelineFrame[];
  /** Reuses the audit `Finding` shape so the report renderer is shared. */
  readonly findings: readonly JourneyFinding[];
  readonly steps: readonly StepOutcome[];
}

export interface StepOutcome {
  readonly stepId: string;
  readonly label: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

/**
 * A finding from a journey.
 *
 * Same essential shape as an audit finding — criterion, message, remediation —
 * but anchored to a moment rather than to an element, because that is what
 * makes it reproducible: "when you closed the dialog at 0:12".
 */
export interface JourneyFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleTitle: string;
  readonly criteria: readonly string[];
  readonly level: 'A' | 'AA' | 'AAA';
  readonly impact: 'critical' | 'serious' | 'moderate' | 'minor';
  readonly outcome: 'failed' | 'cantTell';
  readonly message: string;
  readonly remediation: string;
  readonly frameIndex: number;
  readonly offsetMs: number;
}

/** Current tracker protocol version. Bumped when message semantics change. */
export const TRACE_PROTOCOL_VERSION = 1;
