import {
  TraceMessageType,
  type FocusCause,
  type AnnouncementPoliteness,
  type JourneyTrace,
  type TimelineFrame,
  type TraceMessage,
} from '@accessly/contracts';

/**
 * Rebuild a session from its message stream.
 *
 * This is the counterpart to OpenReplay's replayer, and it works the same way:
 * maintain a *mirror* — a map from the tracker's numeric node ids to what we
 * know about those nodes — then walk the messages in order, applying each to
 * the mirror and emitting a frame for anything a user would have perceived.
 *
 * The mirror is what makes a trace compact. The tracker sends `FocusMoved(id)`,
 * not `FocusMoved("Close dialog button, role button")`, because it already told
 * us that node's name when it was added. Losing the mirror would mean either a
 * much fatter trace or a report full of "focus moved to node 47".
 */

interface MirrorNode {
  readonly id: number;
  role: string;
  name: string;
  parent: number | null;
  /** Position among siblings when added — the recorded document order. */
  index: number;
  removed: boolean;
  state: Record<string, string>;
}

export interface Session {
  readonly frames: readonly TimelineFrame[];
  readonly nodes: ReadonlyMap<number, MirrorNode>;
  readonly durationMs: number;
  readonly startUrl: string;
  /** True when no pointer activation was recorded — a keyboard-only run. */
  readonly keyboardOnly: boolean;
  /** Steps in the order they were entered, with their frame ranges. */
  readonly steps: readonly { id: string; label: string; from: number; to: number }[];
}

const describe = (node: MirrorNode | undefined): string => {
  if (!node) return 'an unknown element';
  const name = node.name.trim();
  if (name.length === 0) return `an unnamed ${node.role}`;
  return `${node.role} “${name}”`;
};

/**
 * Reconstruct the session.
 *
 * Deliberately tolerant: a trace can be truncated by a browser closing
 * mid-session, and a partial journey still carries real findings. A message
 * referring to an unknown node is recorded rather than discarded, because
 * "focus moved somewhere we never saw" is itself diagnostic.
 */
export function reconstruct(trace: JourneyTrace): Session {
  const nodes = new Map<number, MirrorNode>();
  const frames: TimelineFrame[] = [];
  const steps: { id: string; label: string; from: number; to: number }[] = [];

  let currentUrl = trace.url;
  let currentStep: string | null = null;
  let focusedId: number | null = null;
  let sawPointer = false;
  let lastOffset = 0;

  const push = (
    message: TraceMessage,
    kind: string,
    summary: string,
    extra: Partial<TimelineFrame> = {},
  ): void => {
    const focused = focusedId === null ? undefined : nodes.get(focusedId);
    frames.push({
      index: frames.length,
      offsetMs: message.o,
      kind,
      summary,
      focus: focused ? focused.name || `(unnamed ${focused.role})` : null,
      focusRole: focused ? focused.role : null,
      focusCause: null,
      announcement: null,
      politeness: null,
      url: currentUrl,
      stepId: currentStep,
      findingIds: [],
      ...extra,
    });
  };

  for (const message of trace.messages) {
    lastOffset = Math.max(lastOffset, message.o);

    switch (message.t) {
      case TraceMessageType.SessionStart: {
        currentUrl = message.v ?? trace.url;
        push(message, 'session-start', `Session started on ${currentUrl}.`);
        break;
      }

      case TraceMessageType.Navigated: {
        currentUrl = message.v ?? currentUrl;
        push(message, 'navigated', `Navigated to ${currentUrl}.`);
        break;
      }

      case TraceMessageType.NodeAdded: {
        if (message.id === undefined) break;
        nodes.set(message.id, {
          id: message.id,
          role: message.r ?? 'generic',
          name: message.v ?? '',
          parent: message.p ?? null,
          index: message.i ?? 0,
          removed: false,
          state: {},
        });
        break;
      }

      case TraceMessageType.NodeRemoved: {
        if (message.id === undefined) break;
        const existing = nodes.get(message.id);
        if (existing) existing.removed = true;
        break;
      }

      case TraceMessageType.NodeRenamed: {
        if (message.id === undefined) break;
        const existing = nodes.get(message.id);
        if (existing) existing.name = message.v ?? '';
        break;
      }

      case TraceMessageType.NodeStateChanged: {
        if (message.id === undefined || !message.s) break;
        const existing = nodes.get(message.id);
        if (existing) existing.state[message.s] = message.v ?? '';
        break;
      }

      case TraceMessageType.FocusMoved: {
        const cause = (message.s ?? 'script') as FocusCause;
        focusedId = message.id ?? null;

        // `lost` is the case worth naming precisely: focus fell back to the
        // document body, which is what happens when a control disappears while
        // focused, and it is the defect keyboard users report most often.
        if (cause === 'lost' || message.id === undefined) {
          focusedId = null;
          push(message, 'focus-lost', 'Focus was lost — it returned to the document.', {
            focusCause: 'lost',
            focus: null,
            focusRole: null,
          });
          break;
        }

        const target = nodes.get(message.id);
        push(message, 'focus', `Focus moved to ${describe(target)} (by ${cause}).`, {
          focusCause: cause,
        });
        break;
      }

      case TraceMessageType.Announced: {
        const politeness = (message.s ?? 'polite') as AnnouncementPoliteness;
        push(message, 'announced', `Announced: “${message.v ?? ''}”.`, {
          announcement: message.v ?? '',
          politeness,
        });
        break;
      }

      case TraceMessageType.DialogOpened: {
        const target = message.id === undefined ? undefined : nodes.get(message.id);
        push(
          message,
          'dialog-opened',
          `A ${message.b ? 'modal ' : ''}dialog opened: ${describe(target)}.`,
        );
        break;
      }

      case TraceMessageType.DialogClosed: {
        const target = message.id === undefined ? undefined : nodes.get(message.id);
        push(message, 'dialog-closed', `The dialog closed: ${describe(target)}.`);
        break;
      }

      case TraceMessageType.InputEdited: {
        const target = message.id === undefined ? undefined : nodes.get(message.id);
        // The value is never recorded — only that editing happened.
        push(message, 'input', `The user typed into ${describe(target)}.`);
        break;
      }

      case TraceMessageType.KeyPressed: {
        push(message, 'key', `Pressed ${message.v ?? 'a key'}.`);
        break;
      }

      case TraceMessageType.PointerActivated: {
        sawPointer = true;
        const target = message.id === undefined ? undefined : nodes.get(message.id);
        push(message, 'pointer', `Clicked ${describe(target)}.`);
        break;
      }

      case TraceMessageType.StepStarted: {
        currentStep = message.v ?? null;
        steps.push({
          id: message.v ?? `step-${steps.length + 1}`,
          label: message.s ?? message.v ?? `Step ${steps.length + 1}`,
          from: frames.length,
          to: frames.length,
        });
        push(message, 'step-start', `Step started: ${message.s ?? message.v ?? ''}.`);
        break;
      }

      case TraceMessageType.StepEnded: {
        const step = steps[steps.length - 1];
        if (step) step.to = frames.length;
        push(message, 'step-end', `Step ended: ${message.s ?? message.v ?? ''}.`);
        currentStep = null;
        break;
      }

      case TraceMessageType.AuditSnapshot: {
        push(
          message,
          'audit',
          `Page audited: score ${message.n ?? '?'}/100, ${message.m ?? 0} failure(s).`,
        );
        break;
      }

      default:
        break;
    }
  }

  const lastStep = steps[steps.length - 1];
  if (lastStep && lastStep.to === lastStep.from) lastStep.to = frames.length;

  return {
    frames,
    nodes,
    durationMs: Math.max(trace.durationMs, lastOffset),
    startUrl: trace.url,
    keyboardOnly: !sawPointer,
    steps,
  };
}

/** The node the mirror believes was focused at a given frame. */
export function focusAt(session: Session, frameIndex: number): string | null {
  return session.frames[frameIndex]?.focus ?? null;
}
