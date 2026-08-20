import { createHash } from 'node:crypto';
import { getCriterion, type JourneyFinding, type TimelineFrame } from '@accessly/contracts';
import type { Session } from './timeline.js';

/**
 * Journey rules — the checks that only a recorded session can make.
 *
 * Every rule here targets a criterion the static engine reports as `cantTell`,
 * because deciding it needs the page to have been *operated*. That is the whole
 * argument for journeys: 2.4.3 Focus Order is not a property of markup, it is a
 * property of what happens when you press Tab.
 *
 * These are the defects users actually complain about. "I closed the dialog and
 * my screen reader started reading the page from the top again" is a focus-loss
 * bug, invisible to every static checker, and immediately obvious in a trace.
 */

export interface JourneyRule {
  readonly id: string;
  readonly title: string;
  readonly help: string;
  readonly criteria: readonly string[];
  readonly impact: JourneyFinding['impact'];
  readonly evaluate: (session: Session) => readonly RawFinding[];
}

interface RawFinding {
  readonly frameIndex: number;
  readonly outcome: 'failed' | 'cantTell';
  readonly message: string;
  readonly remediation: string;
  readonly impact?: JourneyFinding['impact'];
}

/** How long after an action a user reasonably expects to be told something. */
const ANNOUNCE_WINDOW_MS = 1500;

const rule = (definition: JourneyRule): JourneyRule => definition;

// ── 2.4.3 Focus Order ────────────────────────────────────────────────────────

const focusNotLost = rule({
  id: 'journey-focus-not-lost',
  title: 'Focus is never lost',
  help: 'When focus falls back to the document, a keyboard user is returned to the top of the page and a screen reader user loses their place entirely.',
  criteria: ['2.4.3'],
  impact: 'critical',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    for (const frame of session.frames) {
      if (frame.kind !== 'focus-lost') continue;

      // What preceded the loss is the diagnosis. A dialog closing is the
      // classic cause: the focused element was removed and nothing caught it.
      const previous = session.frames
        .slice(0, frame.index)
        .reverse()
        .find((candidate) => candidate.kind !== 'focus-lost');

      const cause =
        previous?.kind === 'dialog-closed'
          ? 'This happened when a dialog closed, which usually means focus was not returned to whatever opened it.'
          : previous?.kind === 'navigated'
            ? 'This happened after a navigation, which usually means the new view never took focus.'
            : 'The element that had focus was probably removed from the page while it was focused.';

      findings.push({
        frameIndex: frame.index,
        outcome: 'failed',
        message: `Focus was lost ${formatOffset(frame.offsetMs)} into the session. ${cause}`,
        remediation:
          'Move focus deliberately whenever the focused element goes away — back to the control that opened a dialog, or to the heading of the new view.',
      });
    }

    return findings;
  },
});

const dialogTakesFocus = rule({
  id: 'journey-dialog-takes-focus',
  title: 'Opening a dialog moves focus into it',
  help: 'A dialog that appears without taking focus is invisible to a screen reader user — the page carries on reading behind it.',
  criteria: ['2.4.3', '4.1.2'],
  impact: 'serious',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    for (const frame of session.frames) {
      if (frame.kind !== 'dialog-opened') continue;

      const following = session.frames
        .slice(frame.index + 1)
        .filter((candidate) => candidate.offsetMs - frame.offsetMs <= ANNOUNCE_WINDOW_MS);

      const tookFocus = following.some((candidate) => candidate.kind === 'focus');
      if (tookFocus) continue;

      findings.push({
        frameIndex: frame.index,
        outcome: 'failed',
        message: `A dialog opened ${formatOffset(frame.offsetMs)} into the session but focus did not move into it.`,
        remediation:
          'Move focus to the dialog when it opens — to its heading, or to the first control inside it — and mark the rest of the page inert while it is open.',
      });
    }

    return findings;
  },
});

// ── 2.1.2 No Keyboard Trap ───────────────────────────────────────────────────

const noKeyboardTrap = rule({
  id: 'journey-keyboard-trap',
  title: 'Keyboard focus is never trapped',
  help: 'A component that will not let focus leave strands the user with no way out but reloading the page.',
  criteria: ['2.1.2'],
  impact: 'critical',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    /*
     * The signature of a trap: repeated Tab presses that keep landing on the
     * same small set of elements. A modal dialog cycling three controls is
     * correct behaviour, so this only fires when the cycle is short *and* the
     * user kept pressing — the sign of someone trying to get out.
     */
    const tabs = session.frames.filter(
      (frame) => frame.kind === 'key' && /^Tab$/i.test(frame.summary.replace('Pressed ', '').replace('.', '')),
    );
    if (tabs.length < 6) return findings;

    for (let start = 0; start + 6 <= tabs.length; start += 1) {
      const window = tabs.slice(start, start + 6);
      const first = window[0];
      const last = window[window.length - 1];
      if (!first || !last) continue;

      const focusesBetween = session.frames
        .slice(first.index, last.index + 1)
        .filter((frame) => frame.kind === 'focus')
        .map((frame) => frame.focus ?? '(none)');

      const distinct = new Set(focusesBetween);
      if (focusesBetween.length >= 5 && distinct.size <= 2) {
        const anyDialogOpen = session.frames
          .slice(0, first.index)
          .some((frame) => frame.kind === 'dialog-opened');

        findings.push({
          frameIndex: first.index,
          outcome: anyDialogOpen ? 'cantTell' : 'failed',
          message: anyDialogOpen
            ? `Six Tab presses ${formatOffset(first.offsetMs)} in cycled between only ${distinct.size} element(s) while a dialog was open. That may be correct focus containment, or a trap.`
            : `Six Tab presses ${formatOffset(first.offsetMs)} into the session cycled between only ${distinct.size} element(s), with no dialog open — focus could not move on.`,
          remediation:
            'Make sure Tab and Shift+Tab can always leave a component. Inside a modal, containment is correct, but Escape must close it and return focus.',
        });
        break;
      }
    }

    return findings;
  },
});

// ── 4.1.3 Status Messages ────────────────────────────────────────────────────

const routeChangeAnnounced = rule({
  id: 'journey-route-announced',
  title: 'Navigation is announced',
  help: 'A single-page app fires no page load, so nothing tells a screen reader the content changed. The user is left on a page that silently became a different one.',
  criteria: ['4.1.3', '2.4.2'],
  impact: 'serious',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    for (const frame of session.frames) {
      if (frame.kind !== 'navigated') continue;

      const following = session.frames
        .slice(frame.index + 1)
        .filter((candidate) => candidate.offsetMs - frame.offsetMs <= ANNOUNCE_WINDOW_MS);

      const announced = following.some((candidate) => candidate.kind === 'announced');
      const focusMoved = following.some((candidate) => candidate.kind === 'focus');

      if (announced || focusMoved) continue;

      findings.push({
        frameIndex: frame.index,
        outcome: 'failed',
        message: `The view changed to ${frame.url ?? 'a new page'} ${formatOffset(frame.offsetMs)} in, but nothing was announced and focus did not move.`,
        remediation:
          'On navigation, update the document title, move focus to the new view’s heading, and announce the page name in a polite live region.',
      });
    }

    return findings;
  },
});

const actionsAreAcknowledged = rule({
  id: 'journey-action-acknowledged',
  title: 'Actions tell the user what happened',
  help: 'A button that acts silently leaves anyone not watching the screen unsure whether it worked, so they press it again.',
  criteria: ['4.1.3'],
  impact: 'moderate',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    const activations = session.frames.filter(
      (frame) => frame.kind === 'pointer' || (frame.kind === 'key' && /Enter|Space/i.test(frame.summary)),
    );

    for (const frame of activations) {
      const following = session.frames
        .slice(frame.index + 1)
        .filter((candidate) => candidate.offsetMs - frame.offsetMs <= ANNOUNCE_WINDOW_MS);

      const somethingHappened = following.some((candidate) =>
        ['announced', 'navigated', 'dialog-opened', 'dialog-closed', 'focus'].includes(candidate.kind),
      );
      if (somethingHappened) continue;

      findings.push({
        frameIndex: frame.index,
        outcome: 'cantTell',
        message: `Activating a control ${formatOffset(frame.offsetMs)} in produced no announcement, no navigation and no focus change within ${ANNOUNCE_WINDOW_MS / 1000}s.`,
        remediation:
          'If the action changed something, say so in a live region. If it changed nothing visible, check that is intended.',
        impact: 'minor',
      });
    }

    return findings;
  },
});

const assertiveNotOverused = rule({
  id: 'journey-assertive-overuse',
  title: 'Assertive announcements are rare',
  help: 'An assertive live region interrupts the screen reader mid-sentence. Several in a row make the page impossible to listen to.',
  criteria: ['4.1.3'],
  impact: 'moderate',
  evaluate: (session) => {
    const assertive = session.frames.filter(
      (frame) => frame.kind === 'announced' && frame.politeness === 'assertive',
    );
    if (assertive.length < 3) return [];

    const first = assertive[0];
    if (!first) return [];

    const windowMs = (assertive[assertive.length - 1]?.offsetMs ?? 0) - first.offsetMs;
    if (windowMs > 10_000) return [];

    return [
      {
        frameIndex: first.index,
        outcome: 'failed',
        message: `${assertive.length} assertive announcements were made within ${Math.round(windowMs / 1000)} seconds, each interrupting whatever the screen reader was saying.`,
        remediation:
          'Use aria-live="polite" for everything except genuinely time-critical messages such as a session about to expire.',
      },
    ];
  },
});

// ── 2.1.1 Keyboard ───────────────────────────────────────────────────────────

const reachableByKeyboard = rule({
  id: 'journey-keyboard-reachable',
  title: 'Every control used was reachable by keyboard',
  help: 'A control that only responds to a mouse excludes keyboard and switch users completely.',
  criteria: ['2.1.1'],
  impact: 'critical',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    for (const frame of session.frames) {
      if (frame.kind !== 'pointer') continue;

      /*
       * A pointer activation is only suspicious when the target never received
       * focus. Browsers focus most controls on click, so an element clicked
       * without any focus event around it is one that cannot be tabbed to.
       */
      const nearby = session.frames.filter(
        (candidate) =>
          candidate.kind === 'focus' && Math.abs(candidate.offsetMs - frame.offsetMs) <= 300,
      );
      if (nearby.length > 0) continue;

      findings.push({
        frameIndex: frame.index,
        outcome: 'cantTell',
        message: `A control was clicked ${formatOffset(frame.offsetMs)} in without ever receiving focus, which suggests it cannot be reached with the keyboard.`,
        remediation:
          'Check the control can be tabbed to and activated with Enter or Space. If it is a div with a click handler, make it a button.',
      });
    }

    return findings;
  },
});

// ── 3.2.2 On Input ───────────────────────────────────────────────────────────

const typingDoesNotNavigate = rule({
  id: 'journey-typing-no-context-change',
  title: 'Typing does not change context',
  help: 'A page that navigates while the user is still typing takes the form away mid-sentence.',
  criteria: ['3.2.2'],
  impact: 'serious',
  evaluate: (session) => {
    const findings: RawFinding[] = [];

    for (const frame of session.frames) {
      if (frame.kind !== 'input') continue;

      const immediate = session.frames
        .slice(frame.index + 1)
        .filter((candidate) => candidate.offsetMs - frame.offsetMs <= 400);

      const navigated = immediate.find((candidate) => candidate.kind === 'navigated');
      if (!navigated) continue;

      findings.push({
        frameIndex: navigated.index,
        outcome: 'failed',
        message: `The page navigated ${navigated.offsetMs - frame.offsetMs}ms after the user typed, without any explicit action from them.`,
        remediation:
          'Require an explicit submit. Changing context on input is exactly what 3.2.2 prohibits.',
      });
    }

    return findings;
  },
});

export const journeyRules: readonly JourneyRule[] = [
  focusNotLost,
  dialogTakesFocus,
  noKeyboardTrap,
  routeChangeAnnounced,
  actionsAreAcknowledged,
  assertiveNotOverused,
  reachableByKeyboard,
  typingDoesNotNavigate,
];

function formatOffset(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}

/** Deterministic id, so the same defect in two runs is recognised as one. */
function findingId(ruleId: string, frameIndex: number, message: string): string {
  return createHash('sha256').update(`${ruleId}:${frameIndex}:${message}`).digest('hex').slice(0, 16);
}

/** Run every journey rule and return findings in timeline order. */
export function evaluateJourney(session: Session): JourneyFinding[] {
  const findings: JourneyFinding[] = [];

  for (const journeyRule of journeyRules) {
    let raw: readonly RawFinding[] = [];
    try {
      raw = journeyRule.evaluate(session);
    } catch {
      // A failing rule must not lose the rest of the analysis.
      continue;
    }

    for (const item of raw) {
      const frame: TimelineFrame | undefined = session.frames[item.frameIndex];
      findings.push({
        id: findingId(journeyRule.id, item.frameIndex, item.message),
        ruleId: journeyRule.id,
        ruleTitle: journeyRule.title,
        criteria: journeyRule.criteria,
        level: strictestLevel(journeyRule.criteria),
        impact: item.impact ?? journeyRule.impact,
        outcome: item.outcome,
        message: item.message,
        remediation: item.remediation,
        frameIndex: item.frameIndex,
        offsetMs: frame?.offsetMs ?? 0,
      });
    }
  }

  return findings.sort((a, b) => a.offsetMs - b.offsetMs);
}

function strictestLevel(criteria: readonly string[]): 'A' | 'AA' | 'AAA' {
  let level: 'A' | 'AA' | 'AAA' = 'AAA';
  for (const id of criteria) {
    const criterionLevel = getCriterion(id).level;
    if (criterionLevel === 'A') return 'A';
    if (criterionLevel === 'AA') level = 'AA';
  }
  return level;
}
