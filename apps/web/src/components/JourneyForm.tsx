import { useRef, useState } from 'react';
import { STEP_ACTIONS, type CreateJourneyInput, type StepAction } from '@accessly/contracts';
import { Callout, Field, Icon, icons, useId } from './primitives.js';

/**
 * Authoring a journey.
 *
 * This is the form that turns "after the dialog closes, focus must return to
 * the button that opened it" from a thing an accessibility specialist knows
 * into a thing the platform checks on every recording. So the audience is a
 * specialist, not a developer: no JSON, no selectors-as-code, and the
 * expectations are phrased as the sentences a person would actually say.
 *
 * A repeating group of fieldsets is one of the harder accessible patterns, and
 * the parts that are easy to get wrong are handled deliberately:
 *
 *  - **Each step is a `<fieldset>` with a numbered `<legend>`.** Without one,
 *    the ninth "Label" field on the page is indistinguishable from the second.
 *  - **Adding a step moves focus into it**, because otherwise focus stays on
 *    the Add button and a screen reader user has no idea anything appeared.
 *  - **Removing a step moves focus somewhere deliberate** — the step that took
 *    its place, or the Add button — rather than letting it fall to the body.
 *  - **Both are announced** in a live region, since the visual change is
 *    off-screen for anyone using magnification.
 *  - **Ids are derived from the label** and only revealed when the derivation
 *    would collide. An id is a machine concern; making everyone invent one is
 *    how you get `step1`, `step1b`, `step1b-final`.
 */

export interface JourneyFormProps {
  readonly onSubmit: (input: CreateJourneyInput) => Promise<void>;
  readonly onCancel: () => void;
  readonly isBusy: boolean;
}

interface DraftStep {
  /** React identity. Never sent; a step's `id` is free to change under it. */
  readonly key: string;
  id: string;
  label: string;
  action: StepAction;
  target: string;
  announces: boolean;
  announcesText: string;
  focusMoves: boolean;
  keyboardOnly: boolean;
  dialogOpen: boolean;
}

const ACTION_LABEL: Record<StepAction, string> = {
  navigate: 'Go to a page',
  click: 'Activate a control',
  type: 'Type into a field',
  press: 'Press a key',
  wait: 'Wait for something',
  assert: 'Check something',
};

let draftCounter = 0;

function newStep(): DraftStep {
  draftCounter += 1;
  return {
    key: `draft-${draftCounter}`,
    id: '',
    label: '',
    action: 'click',
    target: '',
    announces: false,
    announcesText: '',
    focusMoves: false,
    keyboardOnly: false,
    dialogOpen: false,
  };
}

/** A stable, readable id derived from the label. */
export function slugify(label: string, fallback: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length > 0 ? slug : fallback;
}

/** The id each step will be saved under, with collisions made unique. */
export function resolveIds(steps: readonly DraftStep[]): string[] {
  const used = new Set<string>();
  return steps.map((step, index) => {
    const base = step.id.trim().length > 0 ? step.id.trim() : slugify(step.label, `step-${index + 1}`);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    // Two steps genuinely called "Open the basket" is a reasonable thing to
    // write; silently dropping one of them is not.
    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) suffix += 1;
    const unique = `${base}-${suffix}`;
    used.add(unique);
    return unique;
  });
}

export function JourneyForm({ onSubmit, onCancel, isBusy }: JourneyFormProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([newStep()]);

  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');

  const errorRef = useRef<HTMLDivElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const stepLabelRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const formId = useId('journey-form');

  const patchStep = (key: string, patch: Partial<DraftStep>): void => {
    setSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    );
  };

  const addStep = (): void => {
    const step = newStep();
    setSteps((current) => [...current, step]);
    setAnnouncement(`Step ${steps.length + 1} added.`);
    // Focus has to follow, or the new fields simply do not exist for anyone
    // who is not looking at the screen.
    window.setTimeout(() => stepLabelRefs.current[step.key]?.focus(), 0);
  };

  const removeStep = (key: string): void => {
    const index = steps.findIndex((step) => step.key === key);
    const remaining = steps.filter((step) => step.key !== key);
    setSteps(remaining);
    setAnnouncement(`Step ${index + 1} removed. ${remaining.length} step(s) remain.`);

    // Focus the step that took its place, the one before it, or the Add button
    // — in that order. Anything else drops focus to the top of the document.
    const next = remaining[index] ?? remaining[index - 1];
    window.setTimeout(() => {
      if (next) stepLabelRefs.current[next.key]?.focus();
      else addRef.current?.focus();
    }, 0);
  };

  const fail = (message: string, fields: Record<string, string> = {}): void => {
    setFormError(message);
    setFieldErrors(fields);
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const problems: Record<string, string> = {};
    if (name.trim().length === 0) problems.name = 'Give this journey a name.';
    if (startUrl.trim().length === 0) problems.startUrl = 'Enter the address the journey starts at.';

    const unlabelled = steps.find((step) => step.label.trim().length === 0);
    if (unlabelled) problems[`step-${unlabelled.key}`] = 'Describe what happens in this step.';

    if (Object.keys(problems).length > 0) {
      fail(
        `This journey could not be saved. Check ${Object.keys(problems).length} field(s) below.`,
        problems,
      );
      return;
    }

    const ids = resolveIds(steps);

    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        startUrl: startUrl.trim(),
        siteId: null,
        steps: steps.map((step, index) => {
          const expect = {
            ...(step.announces
              ? { announces: step.announcesText.trim().length > 0 ? step.announcesText.trim() : (true as const) }
              : {}),
            ...(step.focusMoves ? { focusMoves: true } : {}),
            ...(step.keyboardOnly ? { keyboardOnly: true } : {}),
            ...(step.dialogOpen ? { dialogOpen: true } : {}),
          };

          return {
            id: ids[index] as string,
            label: step.label.trim(),
            action: step.action,
            ...(step.target.trim().length > 0 ? { target: step.target.trim() } : {}),
            // An empty expectation object would read as "checked and passed"
            // in the report. Absent means "nothing declared", which is true.
            ...(Object.keys(expect).length > 0 ? { expect } : {}),
          };
        }),
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : 'This journey could not be saved.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby={`${formId}-heading`}>
      <h3 id={`${formId}-heading`}>Define a journey</h3>
      <p className="muted">
        A journey is what you want checked on every recording. Describe the flow, then say what
        must be true after each step — those expectations are what turn a recording into a
        pass or a fail.
      </p>

      {formError ? (
        <div ref={errorRef} tabIndex={-1} role="alert" style={{ marginBottom: 'var(--a-space-5)' }}>
          <Callout tone="danger" title="This journey could not be saved">
            <p className="mb-0">{formError}</p>
          </Callout>
        </div>
      ) : null}

      {/* Always mounted, so the change is observed when it arrives. */}
      <p role="status" aria-live="polite" aria-label="Step changes" className="visually-hidden">
        {announcement}
      </p>

      <Field label="Name" hint="What this flow is called, e.g. “Checkout as a guest”." error={fieldErrors.name ?? null} required>
        {(props) => (
          <input
            {...props}
            className="input"
            // `journeyName`, not `name`: this is the flow's name, not the
            // user's, and 1.3.5 only governs fields about the user. Our own
            // engine flags a bare `name="name"`, correctly.
            name="journeyName"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>

      <Field
        label="Start address"
        hint="Where the journey begins. Recordings are matched against this."
        error={fieldErrors.startUrl ?? null}
        required
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="url"
            name="startUrl"
            inputMode="url"
            spellCheck={false}
            placeholder="https://example.eu/basket"
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
          />
        )}
      </Field>

      <Field label="Description" hint="Optional. Why this flow matters, for whoever reads the report.">
        {(props) => (
          <input
            {...props}
            className="input"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>

      <h4>Steps</h4>
      <p className="muted">
        A journey with no steps still gets checked against every journey rule. Steps add
        expectations of your own on top.
      </p>

      {steps.map((step, index) => (
        <fieldset key={step.key} className="fieldset">
          {/* Numbered, because "Label" nine times over is not navigable. */}
          <legend>
            Step {index + 1}
            {step.label.trim().length > 0 ? `: ${step.label.trim()}` : ''}
          </legend>

          <Field
            label="What happens"
            hint="Written for a person: “Open the basket”, “Close the confirmation dialog”."
            error={fieldErrors[`step-${step.key}`] ?? null}
            required
          >
            {(props) => (
              <input
                {...props}
                ref={(element) => {
                  stepLabelRefs.current[step.key] = element;
                }}
                className="input"
                value={step.label}
                onChange={(event) => patchStep(step.key, { label: event.target.value })}
              />
            )}
          </Field>

          <Field label="Action" hint="How the step is performed.">
            {(props) => (
              <select
                {...props}
                className="select"
                value={step.action}
                onChange={(event) =>
                  patchStep(step.key, { action: event.target.value as StepAction })
                }
              >
                {STEP_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {ACTION_LABEL[action]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Target"
            hint="Optional. A control name, a URL or a key — whatever identifies what the step acts on."
          >
            {(props) => (
              <input
                {...props}
                className="input"
                value={step.target}
                onChange={(event) => patchStep(step.key, { target: event.target.value })}
              />
            )}
          </Field>

          <fieldset className="fieldset">
            <legend>What must be true afterwards</legend>
            <p className="field__hint" style={{ marginTop: 0 }}>
              Leave these unticked to check the step against the journey rules only.
            </p>

            <div className="radio-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label className="radio-option">
                <input
                  type="checkbox"
                  checked={step.announces}
                  onChange={(event) => patchStep(step.key, { announces: event.target.checked })}
                />
                Something is announced
              </label>

              {step.announces ? (
                <Field
                  label="Announcement must contain"
                  hint="Optional. Leave empty to accept any announcement."
                >
                  {(props) => (
                    <input
                      {...props}
                      className="input"
                      value={step.announcesText}
                      placeholder="basket"
                      onChange={(event) => patchStep(step.key, { announcesText: event.target.value })}
                    />
                  )}
                </Field>
              ) : null}

              <label className="radio-option">
                <input
                  type="checkbox"
                  checked={step.focusMoves}
                  onChange={(event) => patchStep(step.key, { focusMoves: event.target.checked })}
                />
                Focus moves
              </label>

              <label className="radio-option">
                <input
                  type="checkbox"
                  checked={step.keyboardOnly}
                  onChange={(event) => patchStep(step.key, { keyboardOnly: event.target.checked })}
                />
                Completable without a pointer
              </label>

              <label className="radio-option">
                <input
                  type="checkbox"
                  checked={step.dialogOpen}
                  onChange={(event) => patchStep(step.key, { dialogOpen: event.target.checked })}
                />
                A dialog opens
              </label>
            </div>
          </fieldset>

          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => removeStep(step.key)}
            disabled={steps.length === 1}
          >
            Remove
            {/* Names the step, so a list of buttons is not eight "Remove"s. */}
            <span className="visually-hidden"> step {index + 1}</span>
          </button>
        </fieldset>
      ))}

      <div className="cluster">
        <button type="button" ref={addRef} className="btn btn--sm btn--secondary" onClick={addStep}>
          <Icon path={icons.arrowRight} size={16} />
          Add a step
        </button>
      </div>

      <div className="cluster" style={{ marginTop: 'var(--a-space-6)' }}>
        <button type="submit" className="btn btn--primary" aria-busy={isBusy}>
          {isBusy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save this journey'
          )}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
