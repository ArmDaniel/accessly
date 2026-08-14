import { useState, type ReactNode } from 'react';
import { useId } from '../a11y/hooks.js';

/**
 * Shared primitives.
 *
 * Each of these exists because the accessible version of the pattern is longer
 * than the inaccessible one, and anything longer gets skipped under deadline.
 * Making the accessible version the *only* version available is the point.
 */

// ── Icons ────────────────────────────────────────────────────────────────────

/**
 * Icons are decorative by default.
 *
 * `aria-hidden` plus `focusable="false"` is the pair that actually works: the
 * second is required because IE/Edge legacy put SVGs in the tab order, and it
 * remains harmless everywhere else. An icon that carries meaning must be given
 * a `label`, which turns it into `role="img"` with a name.
 */
export function Icon({
  path,
  label,
  size = 20,
}: {
  path: string;
  label?: string;
  size?: number;
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export const icons = {
  check: 'M20 6 9 17l-5-5',
  chevronDown: 'm6 9 6 6 6-6',
  alert: 'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  eye: 'M2 12s3.64-7 10-7 10 7 10 7-3.64 7-10 7-10-7-10-7zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  keyboard: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm3 4h.01M11 10h.01M15 10h.01M8 14h8',
  radar: 'M12 2a10 10 0 1 0 10 10M12 12l6-6M12 7a5 5 0 1 0 5 5',
  document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M9 14h6M9 18h4',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
} as const;

// ── Callout ──────────────────────────────────────────────────────────────────

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

const CALLOUT_ICON: Record<CalloutTone, string> = {
  info: icons.info,
  success: icons.check,
  warning: icons.alert,
  danger: icons.alert,
};

/**
 * The icon carries an accessible label naming the tone, so the meaning that is
 * conveyed visually by colour is also available as text (WCAG 1.4.1).
 */
export function Callout({
  tone = 'info',
  title,
  children,
  live,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
  /** Render as a live region — for messages that appear after page load. */
  live?: 'polite' | 'assertive';
}): React.JSX.Element {
  return (
    <div
      className={`callout callout--${tone}`}
      {...(live
        ? { role: tone === 'danger' ? 'alert' : 'status', 'aria-live': live }
        : {})}
    >
      <span className="callout__icon">
        <Icon path={CALLOUT_ICON[tone]} label={tone === 'danger' ? 'Error' : tone} />
      </span>
      <div className="callout__body">
        {title ? <p className="callout__title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

// ── Disclosure ───────────────────────────────────────────────────────────────

/**
 * An expand/collapse section.
 *
 * Built on a real `<button>` with `aria-expanded` and `aria-controls`, not a
 * clickable div: the button gives us Enter/Space, focusability and the correct
 * role for free, and getting any one of those wrong breaks the whole pattern.
 *
 * The panel stays in the DOM but is `hidden` when collapsed, so browser
 * find-in-page and assistive-technology "read all" behave predictably.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  badge,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = useId('disclosure-panel');
  const triggerId = useId('disclosure-trigger');

  return (
    <div className="disclosure">
      <h3 style={{ margin: 0, font: 'inherit' }}>
        <button
          type="button"
          id={triggerId}
          className="disclosure__trigger"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
        >
          <span>{summary}</span>
          {badge}
          <span className="disclosure__marker">
            <Icon path={icons.chevronDown} />
          </span>
        </button>
      </h3>
      <div id={panelId} role="region" aria-labelledby={triggerId} className="disclosure__panel" hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}

// ── Form field ───────────────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  /** Rendered under the label and wired up with aria-describedby. */
  hint?: string;
  /** Rendered as an error and wired up with aria-describedby + aria-invalid. */
  error?: string | null;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    required: boolean;
  }) => ReactNode;
}

/**
 * A labelled field.
 *
 * The render-prop shape exists so the control cannot be rendered without the
 * ids that connect it to its label, hint and error. Passing them by hand is
 * where these associations get dropped.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: FieldProps): React.JSX.Element {
  const id = useId('field');
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}{' '}
        {required ? (
          // Spelled out rather than an asterisk, which is meaningless on its own.
          <span className="field__required">(required)</span>
        ) : (
          <span className="field__required">(optional)</span>
        )}
      </label>

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {children({
        id,
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
        'aria-invalid': error ? true : undefined,
        required,
      })}

      {error ? (
        <p className="field__error" id={errorId}>
          <Icon path={icons.alert} size={16} label="Error" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

// ── Scrollable region ────────────────────────────────────────────────────────

/**
 * A horizontally scrollable container.
 *
 * A scroll container that is not focusable cannot be scrolled with the
 * keyboard at all — the content is simply unreachable. `tabindex="0"` plus a
 * labelled `role="region"` fixes that and explains what the region is when
 * focus lands on it.
 */
export function ScrollRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

export function Badge({
  tone = 'neutral',
  children,
  srPrefix,
}: {
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info';
  children: ReactNode;
  /** Context read only by assistive technology, e.g. "Conformance level: ". */
  srPrefix?: string;
}): React.JSX.Element {
  return (
    <span className={`badge badge--${tone}`}>
      {srPrefix ? <span className="visually-hidden">{srPrefix}</span> : null}
      {children}
    </span>
  );
}

// ── External link ────────────────────────────────────────────────────────────

/**
 * Opening a new tab is announced in the link text, not just with an icon —
 * WCAG 3.2.5. `rel="noreferrer"` is a security measure, unrelated but free.
 */
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <span className="visually-hidden"> (opens in a new window)</span>{' '}
      <Icon path={icons.external} size={14} />
    </a>
  );
}

export { useId };
