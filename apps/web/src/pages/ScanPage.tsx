import { useRef, useState } from 'react';
import {
  ACCEPTED_EXTENSIONS,
  MEDIA_LABELS,
  type AuditReport,
  type ConformanceLevel,
} from '@accessly/contracts';
import { Page } from '../components/Page.js';
import { Callout, Field, Icon, icons } from '../components/primitives.js';
import { ReportView } from '../components/ReportView.js';
import { ApiError, api, toBase64 } from '../lib/api.js';

type Source = 'url' | 'inline' | 'media';

/** 5 MB, matching the API's ceiling — caught here so the upload never starts. */
const MAX_FILE_BYTES = 5_000_000;

/**
 * The scanner.
 *
 * Form accessibility here is the part most products get wrong, so it is worth
 * being explicit about what this does:
 *
 *  - Validation runs on submit, never on blur. Validating a field the moment
 *    focus leaves it means a screen reader user tabbing through a form is
 *    interrupted by errors for fields they have not filled in yet.
 *  - Errors are announced once, as a summary in an alert region, and each
 *    message is also wired to its field with aria-describedby.
 *  - On failure, focus moves to the error summary; on success, to the report
 *    heading. Focus always lands where the new information is.
 *  - The submit button never disappears while loading. Its label changes and
 *    aria-busy is set, so it stays where the user left their focus.
 */
export function ScanPage(): React.JSX.Element {
  const [source, setSource] = useState<Source>('url');
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<ConformanceLevel>('AA');

  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const errorRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLHeadingElement | null>(null);

  const fail = (message: string, field: string | null = null): void => {
    setFormError(message);
    setFieldError(field);
    // Let React paint the alert before moving focus into it, otherwise the
    // element does not exist yet and the focus call is a no-op.
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldError(null);

    if (source === 'url' && url.trim().length === 0) {
      fail('Enter the address of the page you want to scan.', 'Enter a URL.');
      return;
    }
    if (source === 'inline' && html.trim().length === 0) {
      fail('Paste the HTML you want to scan.', 'Paste some HTML.');
      return;
    }
    if (source === 'media' && !file) {
      fail('Choose the document you want to scan.', 'Choose a file.');
      return;
    }
    if (source === 'media' && file && file.size > MAX_FILE_BYTES) {
      // Checked before reading it: there is no point encoding five megabytes
      // only for the API to refuse them.
      fail(
        `${file.name} is ${Math.round(file.size / 1_000_000)} MB. The limit is 5 MB.`,
        'That file is too large.',
      );
      return;
    }

    setIsRunning(true);
    try {
      const result = await api.createAudit(
        source === 'url'
          ? { source: 'url', url: url.trim(), target, siteId: null }
          : source === 'inline'
            ? { source: 'inline', html, target, siteId: null }
            : {
                source: 'media',
                filename: (file as File).name,
                data: await toBase64(await (file as File).arrayBuffer()),
                target,
                siteId: null,
              },
      );
      setReport(result);
      window.setTimeout(() => resultRef.current?.focus(), 0);
    } catch (error) {
      if (error instanceof ApiError) {
        // Only read the field message for the source actually in use —
        // surfacing the html error on the URL input (or vice versa) points
        // the user at a field that may not even be rendered.
        const field =
          source === 'url'
            ? (error.fieldErrors('url')[0] ?? null)
            : source === 'inline'
              ? (error.fieldErrors('html')[0] ?? null)
              : (error.fieldErrors('filename')[0] ?? error.fieldErrors('data')[0] ?? null);
        fail(error.detail ? `${error.problem.title} ${error.detail}` : error.problem.title, field);
      } else {
        fail('The scan could not be completed. Please try again.');
      }
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Page
      title="Scan a page"
      heading="Scan a page for accessibility issues"
      eyebrow="Free, no account needed"
      lede="Give us a URL, or paste your markup. We check it against every WCAG 2.1 success criterion automation can reach, and tell you plainly which ones it cannot."
    >
      <div className="section section--tight">
        <div className="container container--narrow">
          <form onSubmit={onSubmit} noValidate>
            {/*
              noValidate turns off the browser's own bubbles. They are not
              announced consistently, cannot be styled, and vanish on scroll —
              our own messages are more reliable and stay on screen.
            */}

            {formError ? (
              <div
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                style={{ marginBottom: 'var(--a-space-5)' }}
              >
                <Callout tone="danger" title="We could not run that scan">
                  <p className="mb-0">{formError}</p>
                </Callout>
              </div>
            ) : null}

            <fieldset className="fieldset">
              <legend>What would you like to scan?</legend>
              <div className="radio-row">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="source"
                    value="url"
                    checked={source === 'url'}
                    onChange={() => {
                      setSource('url');
                      // Stale errors must not follow the user across modes:
                      // an error read for the URL field is wrong for the
                      // textarea and vice versa.
                      setFormError(null);
                      setFieldError(null);
                    }}
                  />
                  A published page
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="source"
                    value="inline"
                    checked={source === 'inline'}
                    onChange={() => {
                      setSource('inline');
                      setFormError(null);
                      setFieldError(null);
                    }}
                  />
                  HTML I paste in
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="source"
                    value="media"
                    checked={source === 'media'}
                    onChange={() => {
                      setSource('media');
                      setFormError(null);
                      setFieldError(null);
                    }}
                  />
                  A document or media file
                </label>
              </div>
            </fieldset>

            {source === 'url' ? (
              <Field
                label="Page address"
                hint="A full URL, including https://. We fetch the page as it is served — we do not run your JavaScript."
                error={fieldError}
                required
              >
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    type="url"
                    name="url"
                    // Not a personal-data field, so no autocomplete token
                    // applies; inputmode and spellcheck are the useful hints.
                    inputMode="url"
                    spellCheck={false}
                    placeholder="https://example.eu/checkout"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                )}
              </Field>
            ) : source === 'media' ? (
              <Field
                label="Document"
                hint={`PDF, Word, PowerPoint, Excel, EPUB or a caption file (WebVTT, SRT). Up to 5 MB. We read its structure — headings, alt text, tables, reading order — and never its contents beyond that.`}
                error={fieldError}
                required
              >
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    type="file"
                    name="file"
                    // A hint, not a gate: the API sniffs the bytes, because an
                    // extension is the least reliable thing about a file.
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setFieldError(null);
                    }}
                  />
                )}
              </Field>
            ) : (
              <Field
                label="HTML source"
                hint="Paste the rendered HTML of the page. Nothing is stored beyond the report you get back."
                error={fieldError}
                required
              >
                {(props) => (
                  <textarea
                    {...props}
                    className="textarea"
                    name="html"
                    spellCheck={false}
                    placeholder="<!doctype html>&#10;<html lang=&quot;en&quot;>…"
                    value={html}
                    onChange={(event) => setHtml(event.target.value)}
                  />
                )}
              </Field>
            )}

            <fieldset className="fieldset">
              <legend>Conformance level to test against</legend>
              <p className="field__hint" style={{ marginTop: 0 }}>
                Level AA is what the European Accessibility Act and most procurement rules
                require. Level A alone is rarely sufficient.
              </p>
              <div className="radio-row">
                {(['A', 'AA', 'AAA'] as const).map((level) => (
                  <label key={level} className="radio-option">
                    <input
                      type="radio"
                      name="target"
                      value={level}
                      checked={target === level}
                      onChange={() => setTarget(level)}
                    />
                    Level {level}
                    {level === 'AA' ? <span className="muted"> (recommended)</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>

            <button type="submit" className="btn btn--primary" aria-busy={isRunning}>
              {isRunning ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Scanning…
                </>
              ) : (
                <>
                  Run the scan
                  <Icon path={icons.arrowRight} size={18} />
                </>
              )}
            </button>

            {/*
              A separate polite region for progress. The button's own label
              changes too, but a screen reader user who has moved focus away
              would otherwise never learn the scan finished.
            */}
            <p role="status" aria-live="polite" className="visually-hidden">
              {isRunning ? 'Scanning the page. This usually takes a moment.' : ''}
            </p>
          </form>
        </div>
      </div>

      {report ? (
        <div className="section">
          <div className="container">
            <div
              className="cluster no-print"
              style={{ justifyContent: 'space-between', marginBottom: 'var(--a-space-5)' }}
            >
              <h2 ref={resultRef} tabIndex={-1} style={{ margin: 0 }}>
                Report for {report.subject.filename ?? report.subject.title ?? report.subject.url}
                {report.subject.mediaKind && report.subject.mediaKind !== 'html' ? (
                  <span className="muted"> — {MEDIA_LABELS[report.subject.mediaKind]}</span>
                ) : null}
              </h2>
              <button type="button" className="btn btn--secondary" onClick={() => window.print()}>
                <Icon path={icons.document} size={18} />
                Print or save as PDF
              </button>
            </div>

            {/* Printed copies need the context the on-screen header carried. */}
            <div className="print-only" hidden>
              <h1>Accessly accessibility report</h1>
              <p>
                {report.subject.url} — WCAG 2.1 level {report.target}
              </p>
            </div>

            <ReportView report={report} />
          </div>
        </div>
      ) : null}
    </Page>
  );
}
