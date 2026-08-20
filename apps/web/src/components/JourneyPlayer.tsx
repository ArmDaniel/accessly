import { useCallback, useEffect, useRef, useState } from 'react';
import type { JourneyFinding, JourneyReport, TimelineFrame } from '@accessly/contracts';
import { Badge, Callout, Icon, icons, ScrollRegion } from './primitives.js';
import { useId } from '../a11y/hooks.js';

/**
 * The journey player.
 *
 * OpenReplay replays pixels. This replays the *experience*: where focus was,
 * what was announced, what opened and closed. That difference decides the whole
 * design — there is no video surface here, so the player is a transcript with a
 * position, and the position is the only thing playback moves.
 *
 * Which turns out to be the accessible design as well. A person who cannot see
 * a session recording can read this one, and the defects it reports are the
 * ones they experience. The player is not an accessible wrapper around an
 * inaccessible artefact; the artefact is text.
 *
 * Three decisions are worth naming:
 *
 *  - **Playback does not announce every frame.** A live region firing on each
 *    step would interrupt a screen reader continuously and make the recording
 *    unusable. While playing, the transcript updates silently and only the end
 *    of playback is announced; stepping by hand announces each frame, because
 *    then the user asked for it.
 *  - **The slider is a real `<input type="range">`.** It gets arrow keys,
 *    Home/End and Page Up/Down from the platform, and its value text names the
 *    moment rather than reading "frame 34 of 88".
 *  - **Playback honours reduced motion by never animating at all.** There is
 *    nothing to animate; a step is a state change.
 */

const KIND_LABEL: Record<string, string> = {
  'session-start': 'Session started',
  navigated: 'Navigation',
  focus: 'Focus moved',
  'focus-lost': 'Focus lost',
  announced: 'Announcement',
  'dialog-opened': 'Dialog opened',
  'dialog-closed': 'Dialog closed',
  input: 'Typing',
  key: 'Key press',
  pointer: 'Click',
  'step-start': 'Step started',
  'step-end': 'Step ended',
  audit: 'Page audit',
};

const KIND_TONE: Record<string, 'neutral' | 'success' | 'danger' | 'warning' | 'info'> = {
  'focus-lost': 'danger',
  announced: 'info',
  'dialog-opened': 'info',
  navigated: 'info',
  audit: 'neutral',
};

/** Longest gap the player will wait between frames, so a pause is not dead air. */
const MAX_GAP_MS = 1_500;

export function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function JourneyPlayer({ report }: { report: JourneyReport }): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  /** What the live region should say. Empty while playing, on purpose. */
  const [announcement, setAnnouncement] = useState('');

  const timelineId = useId('journey-timeline');
  const frameRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const frames = report.timeline;
  const total = frames.length;
  const frame = frames[index];

  const findingsById = new Map(report.findings.map((finding) => [finding.id, finding]));
  const currentFindings = (frame?.findingIds ?? [])
    .map((id) => findingsById.get(id))
    .filter((finding): finding is JourneyFinding => finding !== undefined);

  const describe = useCallback(
    (target: TimelineFrame | undefined): string =>
      target
        ? `${formatOffset(target.offsetMs)}. ${target.summary}${
            target.findingIds.length > 0 ? ` ${target.findingIds.length} issue found here.` : ''
          }`
        : '',
    [],
  );

  /** Move to a frame because the user asked; announce it. */
  const goTo = useCallback(
    (next: number): void => {
      const clamped = Math.max(0, Math.min(total - 1, next));
      setIndex(clamped);
      setIsPlaying(false);
      setAnnouncement(describe(frames[clamped]));
    },
    [describe, frames, total],
  );

  // Playback. The wait between frames is the real gap in the recording, capped
  // so that a session where the user paused to read does not stall the player.
  useEffect(() => {
    if (!isPlaying) return undefined;

    if (index >= total - 1) {
      setIsPlaying(false);
      setAnnouncement(`Playback finished at ${formatOffset(frames[total - 1]?.offsetMs ?? 0)}.`);
      return undefined;
    }

    const gap = Math.min(
      MAX_GAP_MS,
      Math.max(350, (frames[index + 1]?.offsetMs ?? 0) - (frames[index]?.offsetMs ?? 0)),
    );
    const timer = window.setTimeout(() => setIndex((current) => current + 1), gap);
    return () => window.clearTimeout(timer);
  }, [frames, index, isPlaying, total]);

  if (total === 0) {
    return (
      <Callout tone="info" title="Nothing was recorded">
        <p className="mb-0">
          This trace contains no events. The tracker may have been stopped before the page was
          used.
        </p>
      </Callout>
    );
  }

  return (
    <div className="player">
      <div className="cluster" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ marginBottom: 'var(--a-space-2)' }}>Replay</h3>
          <p className="muted mb-0">
            {total} recorded moment{total === 1 ? '' : 's'} over{' '}
            {formatOffset(report.summary.durationMs)}
            {report.summary.keyboardOnly ? ' — completed without a pointer' : ''}
          </p>
        </div>
      </div>

      {/* ── Transport ───────────────────────────────────────────────────── */}
      <div className="player__controls cluster" role="group" aria-label="Replay controls">
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        >
          Previous moment
        </button>

        <button
          type="button"
          className="btn btn--sm btn--primary"
          aria-pressed={isPlaying}
          onClick={() => {
            if (isPlaying) {
              setIsPlaying(false);
              setAnnouncement(`Paused at ${describe(frame)}`);
              return;
            }
            // Restarting from the end would otherwise stop immediately.
            if (index >= total - 1) setIndex(0);
            setAnnouncement('');
            setIsPlaying(true);
          }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          className="btn btn--sm btn--secondary"
          onClick={() => goTo(index + 1)}
          disabled={index >= total - 1}
        >
          Next moment
        </button>

        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            const next = frames.findIndex(
              (candidate) => candidate.index > index && candidate.findingIds.length > 0,
            );
            if (next === -1) {
              setAnnouncement('No further issues after this moment.');
              return;
            }
            goTo(next);
            window.setTimeout(() => frameRefs.current[next]?.focus(), 0);
          }}
          disabled={report.findings.length === 0}
        >
          <Icon path={icons.alert} size={16} />
          Next issue
        </button>
      </div>

      <div className="field" style={{ marginTop: 'var(--a-space-4)' }}>
        <label className="field__label" htmlFor={`${timelineId}-scrub`}>
          Position in the session
        </label>
        <input
          id={`${timelineId}-scrub`}
          className="player__scrub"
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={index}
          // The number alone means nothing; the moment does.
          aria-valuetext={`${formatOffset(frame?.offsetMs ?? 0)} — ${frame?.summary ?? ''}`}
          onChange={(event) => goTo(Number(event.target.value))}
        />
      </div>

      {/*
        Silent while playing. This is the single most important accessibility
        decision in the component: announcing 80 frames in sequence would make
        the recording unlistenable.
      */}
      <p
        role="status"
        aria-live="polite"
        // Named because a page can hold several status regions, and a screen
        // reader listing them should say which one is the replay.
        aria-label="Replay position"
        className="visually-hidden"
      >
        {announcement}
      </p>

      {/* ── The current moment ──────────────────────────────────────────── */}
      <div className="player__stage card" style={{ marginTop: 'var(--a-space-5)' }}>
        <p className="cluster" style={{ marginTop: 0 }}>
          <Badge tone={KIND_TONE[frame?.kind ?? ''] ?? 'neutral'} srPrefix="Event: ">
            {KIND_LABEL[frame?.kind ?? ''] ?? frame?.kind}
          </Badge>
          <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatOffset(frame?.offsetMs ?? 0)}
          </span>
          <span className="muted">
            Moment {index + 1} of {total}
          </span>
        </p>

        <p style={{ fontSize: 'var(--a-text-lg)', fontWeight: 600 }}>{frame?.summary}</p>

        <dl className="player__facts">
          <div>
            <dt>Focus</dt>
            <dd>{frame?.focus ?? <span className="band-critical">Nowhere — focus was lost</span>}</dd>
          </div>
          <div>
            <dt>Last announced</dt>
            <dd>{frame?.announcement ?? <span className="muted">Nothing</span>}</dd>
          </div>
          <div>
            <dt>Page</dt>
            <dd>{frame?.url ?? <span className="muted">Unknown</span>}</dd>
          </div>
          <div>
            <dt>Step</dt>
            <dd>{frame?.stepId ?? <span className="muted">Not part of a declared step</span>}</dd>
          </div>
        </dl>

        {currentFindings.length > 0 ? (
          <div style={{ marginTop: 'var(--a-space-4)' }}>
            {currentFindings.map((finding) => (
              <Callout
                key={finding.id}
                tone={finding.outcome === 'failed' ? 'danger' : 'warning'}
                title={finding.ruleTitle}
              >
                <p>{finding.message}</p>
                <p className="mb-0">
                  <strong>How to fix it:</strong> {finding.remediation}
                </p>
                <p className="mb-0 muted">
                  {finding.outcome === 'failed' ? 'Fails' : 'Needs a human decision on'} WCAG{' '}
                  {finding.criteria.join(', ')} (level {finding.level})
                </p>
              </Callout>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── The transcript ──────────────────────────────────────────────── */}
      <h4 id={timelineId} style={{ marginTop: 'var(--a-space-6)' }}>
        Full transcript
      </h4>
      <p className="muted">
        Every recorded moment, in order. This is the whole session as a screen-reader user
        experienced it.
      </p>

      <ScrollRegion label="Session transcript">
        <ol className="player__timeline" aria-labelledby={timelineId}>
          {frames.map((candidate) => {
            const isCurrent = candidate.index === index;
            return (
              <li key={candidate.index}>
                <button
                  type="button"
                  ref={(element) => {
                    frameRefs.current[candidate.index] = element;
                  }}
                  className={`player__frame${isCurrent ? ' player__frame--current' : ''}`}
                  // aria-current marks the playhead without relying on the
                  // highlight colour to carry it.
                  {...(isCurrent ? { 'aria-current': 'true' as const } : {})}
                  onClick={() => goTo(candidate.index)}
                >
                  <span className="player__frame-time">{formatOffset(candidate.offsetMs)}</span>
                  <span className="player__frame-summary">{candidate.summary}</span>
                  {candidate.findingIds.length > 0 ? (
                    <Badge tone="danger">
                      {candidate.findingIds.length} issue
                      {candidate.findingIds.length === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </ScrollRegion>
    </div>
  );
}
