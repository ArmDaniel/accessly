import { randomUUID } from 'node:crypto';
import type {
  Journey,
  JourneyFinding,
  JourneyReport,
  JourneyTrace,
  StepOutcome,
  TimelineFrame,
} from '@accessly/contracts';
import { reconstruct, type Session } from './timeline.js';
import { evaluateJourney } from './rules.js';

export interface AnalyseOptions {
  readonly trace: JourneyTrace;
  /** The definition this trace was recorded against, when there was one. */
  readonly journey?: Journey | null;
  readonly generateId?: () => string;
}

/**
 * Turn a recorded trace into a report.
 *
 * The output deliberately mirrors an audit report: a summary, findings with
 * criteria and remediation, and a navigable body. The difference is that the
 * body is a *timeline* rather than a document, because the defects here happen
 * at moments rather than at elements.
 */
export function analyseJourney(options: AnalyseOptions): JourneyReport {
  const generateId = options.generateId ?? randomUUID;
  const session = reconstruct(options.trace);
  const findings = evaluateJourney(session);

  // Attach findings to their frames, so the player can highlight the moment a
  // defect occurred rather than listing them separately.
  const byFrame = new Map<number, string[]>();
  for (const finding of findings) {
    const bucket = byFrame.get(finding.frameIndex) ?? [];
    bucket.push(finding.id);
    byFrame.set(finding.frameIndex, bucket);
  }

  const timeline: TimelineFrame[] = session.frames.map((frame) => ({
    ...frame,
    findingIds: byFrame.get(frame.index) ?? [],
  }));

  return {
    id: generateId(),
    traceId: options.trace.id,
    journeyId: options.trace.journeyId,
    organisationId: options.trace.organisationId,
    name: options.journey?.name ?? `Session on ${options.trace.url}`,
    startedAt: options.trace.startedAt,
    summary: summarise(session, findings),
    timeline,
    findings,
    steps: options.journey ? checkSteps(options.journey, session) : [],
  };
}

function summarise(session: Session, findings: readonly JourneyFinding[]): JourneyReport['summary'] {
  void findings;
  return {
    frames: session.frames.length,
    durationMs: session.durationMs,
    announcements: session.frames.filter((frame) => frame.kind === 'announced').length,
    focusMoves: session.frames.filter((frame) => frame.kind === 'focus').length,
    focusLosses: session.frames.filter((frame) => frame.kind === 'focus-lost').length,
    keyboardOnly: session.keyboardOnly,
  };
}

/**
 * Check each declared step against what the trace actually shows.
 *
 * This is where a journey definition earns its keep: the accessibility
 * specialist writes "after closing the dialog, focus must return to the trigger"
 * once, and every future recording is checked against it automatically.
 */
function checkSteps(journey: Journey, session: Session): StepOutcome[] {
  return journey.steps.map((step) => {
    const recorded = session.steps.find((candidate) => candidate.id === step.id);

    if (!recorded) {
      return {
        stepId: step.id,
        label: step.label,
        satisfied: false,
        detail: 'This step was never reached in the recording.',
      };
    }

    const frames = session.frames.slice(recorded.from, recorded.to + 1);
    const expectation = step.expect;

    if (!expectation) {
      return {
        stepId: step.id,
        label: step.label,
        satisfied: true,
        detail: `Completed in ${frames.length} recorded event(s).`,
      };
    }

    const problems: string[] = [];

    if (expectation.announces !== undefined) {
      const announcements = frames.filter((frame) => frame.kind === 'announced');
      if (announcements.length === 0) {
        problems.push('nothing was announced');
      } else if (typeof expectation.announces === 'string') {
        const wanted = expectation.announces.toLowerCase();
        const matched = announcements.some((frame) =>
          (frame.announcement ?? '').toLowerCase().includes(wanted),
        );
        if (!matched) {
          problems.push(`no announcement contained “${expectation.announces}”`);
        }
      }
    }

    if (expectation.focusMoves === true) {
      const moved = frames.some((frame) => frame.kind === 'focus');
      if (!moved) problems.push('focus never moved');
    }

    if (expectation.keyboardOnly === true) {
      const usedPointer = frames.some((frame) => frame.kind === 'pointer');
      if (usedPointer) problems.push('the step needed a pointer');
    }

    if (expectation.dialogOpen === true) {
      const opened = frames.some((frame) => frame.kind === 'dialog-opened');
      if (!opened) problems.push('no dialog opened');
    }

    return {
      stepId: step.id,
      label: step.label,
      satisfied: problems.length === 0,
      detail:
        problems.length === 0
          ? 'Every expectation was met.'
          : `Expectation not met: ${problems.join(', ')}.`,
    };
  });
}

export { reconstruct, evaluateJourney };
export type { Session };
