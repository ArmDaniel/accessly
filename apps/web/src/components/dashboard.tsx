import { useRef, useState, type ReactNode } from 'react';
import type { Score, ScoreBand, WatchEventKind } from '@accessly/contracts';
import { Badge, Callout, Icon, icons } from './primitives.js';
import { useId } from '../a11y/hooks.js';

/** Shared pieces used by both dashboards. */

const BAND_LABEL: Record<ScoreBand, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
};

export function bandFor(value: number): ScoreBand {
  if (value >= 95) return 'excellent';
  if (value >= 85) return 'good';
  if (value >= 70) return 'fair';
  if (value >= 50) return 'poor';
  return 'critical';
}

/**
 * A score with its band spelled out.
 *
 * The band name is always rendered as text next to the number. Colour alone
 * would fail 1.4.1, and a bare number invites the reader to supply their own
 * threshold for "good".
 */
export function ScoreValue({ value }: { value: number | null }): React.JSX.Element {
  if (value === null) {
    return <span className="muted">Not scanned yet</span>;
  }
  const band = bandFor(value);
  return (
    <span className={`band-${band}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {value}
      <span className="muted" style={{ fontWeight: 400 }}>
        /100
      </span>{' '}
      <span style={{ fontWeight: 400 }}>{BAND_LABEL[band]}</span>
    </span>
  );
}

/** A score change, with the direction stated in words as well as a sign. */
export function ScoreDelta({ delta }: { delta: number | null }): React.JSX.Element {
  if (delta === null || delta === 0) {
    return <span className="muted">No change</span>;
  }
  const improved = delta > 0;
  return (
    <span className={improved ? 'band-excellent' : 'band-critical'} style={{ fontWeight: 700 }}>
      {improved ? '+' : ''}
      {delta}{' '}
      <span style={{ fontWeight: 400 }}>{improved ? 'improved' : 'regressed'}</span>
    </span>
  );
}

export function ConformanceBadge({ score }: { score: Score }): React.JSX.Element {
  if (score.conformsTo === null) {
    return (
      <Badge tone="danger" srPrefix="Conformance: ">
        Fails level A
      </Badge>
    );
  }
  return (
    <Badge tone="success" srPrefix="Conformance: ">
      No automated failures at {score.conformsTo}
    </Badge>
  );
}

const EVENT_TONE: Record<WatchEventKind, 'neutral' | 'success' | 'danger' | 'warning' | 'info'> = {
  polled: 'neutral',
  unchanged: 'neutral',
  changed: 'info',
  audited: 'info',
  regressed: 'danger',
  improved: 'success',
  poll_failed: 'warning',
};

const EVENT_LABEL: Record<WatchEventKind, string> = {
  polled: 'Checked',
  unchanged: 'Unchanged',
  changed: 'Content changed',
  audited: 'Audited',
  regressed: 'Regressed',
  improved: 'Improved',
  poll_failed: 'Check failed',
};

export function EventBadge({ kind }: { kind: WatchEventKind }): React.JSX.Element {
  return (
    <Badge tone={EVENT_TONE[kind]} srPrefix="Event: ">
      {EVENT_LABEL[kind]}
    </Badge>
  );
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRelative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const future = diff >= 0;
  const minutes = Math.round(diff / 60000);
  const absolute = Math.abs(minutes);

  // A timestamp seconds away rounds to zero minutes — "in 0 min" is noise.
  if (absolute < 1) return future ? 'in under a minute' : 'just now';
  if (absolute < 60) return future ? `in ${absolute} min` : `${absolute} min ago`;
  const hours = Math.round(absolute / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days} d` : `${days} d ago`;
}

/**
 * A destructive action behind an explicit confirmation.
 *
 * Not `window.confirm`: that is a browser modal we cannot label, style or test,
 * and its wording is not ours. This is a two-step inline control — the first
 * press replaces the button with a question and two clearly-named buttons, and
 * focus moves to the confirming one so a keyboard user is already on it.
 *
 * The question is also announced, so a screen reader user is not left pressing
 * "Delete" twice without knowing why nothing happened the first time.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  onConfirm: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const questionId = useId('confirm-question');

  if (!isConfirming) {
    return (
      <button
        type="button"
        ref={triggerRef}
        className="btn btn--sm btn--secondary"
        disabled={disabled}
        onClick={() => {
          setIsConfirming(true);
          window.setTimeout(() => confirmRef.current?.focus(), 0);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="cluster" role="group" aria-labelledby={questionId}>
      <span id={questionId} role="alert" style={{ fontWeight: 700 }}>
        {question}
      </span>
      <button
        type="button"
        ref={confirmRef}
        className="btn btn--sm btn--danger"
        onClick={() => {
          setIsConfirming(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => {
          setIsConfirming(false);
          window.setTimeout(() => triggerRef.current?.focus(), 0);
        }}
      >
        Cancel
      </button>
    </span>
  );
}

/**
 * A polite live region for the result of an action.
 *
 * Always rendered, never conditionally mounted. A live region that is inserted
 * into the DOM at the same moment its content appears is frequently missed by
 * screen readers — the region has to exist first for the change to be observed.
 */
export function ActionStatus({
  message,
  error,
}: {
  message: string;
  error: string;
}): React.JSX.Element {
  return (
    <>
      <div role="status" aria-live="polite" className="visually-hidden">
        {message}
      </div>
      {error ? (
        <div style={{ marginBottom: 'var(--a-space-4)' }}>
          <Callout tone="danger" title="That did not work" live="assertive">
            <p className="mb-0">{error}</p>
          </Callout>
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 'var(--a-space-4)' }} aria-hidden="true">
          {/* Visible echo of what the live region already announced. */}
          <Callout tone="success">
            <p className="mb-0">{message}</p>
          </Callout>
        </div>
      ) : null}
    </>
  );
}

/**
 * Loading, error and empty states.
 *
 * `busy` is announced politely rather than shown as a bare spinner, which
 * conveys nothing to anyone not looking at it.
 */
export function AsyncSection({
  status,
  error,
  isEmpty,
  emptyTitle,
  emptyBody,
  label,
  children,
}: {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <p role="status" aria-live="polite" className="visually-hidden">
        {status === 'loading' ? `Loading ${label}.` : ''}
        {status === 'ready' ? `${label} loaded.` : ''}
      </p>

      {status === 'loading' ? (
        <p className="muted">
          <span className="spinner" aria-hidden="true" /> Loading {label}…
        </p>
      ) : null}

      {status === 'error' ? (
        <Callout tone="danger" title={`Could not load ${label}`} live="assertive">
          <p className="mb-0">{error}</p>
        </Callout>
      ) : null}

      {status === 'ready' && isEmpty ? (
        <div className="card">
          <h3>{emptyTitle}</h3>
          {emptyBody}
        </div>
      ) : null}

      {status === 'ready' && !isEmpty ? children : null}
    </>
  );
}

export function StatCard({
  value,
  label,
  tone,
}: {
  value: ReactNode;
  label: string;
  tone?: ScoreBand;
}): React.JSX.Element {
  return (
    <li className="stat">
      <span className={`stat__value${tone ? ` band-${tone}` : ''}`}>{value}</span>
      <span className="stat__label">{label}</span>
    </li>
  );
}

export { Icon, icons };
