import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docx, pdf, webvtt } from '../../../packages/media/test/fixtures.js';
import { createHarness, GOOD_PAGE, type Harness } from './helpers.js';

/**
 * Auditing uploaded documents over HTTP.
 *
 * The point of the format-neutral tree is that a PDF and a web page come back
 * as the same report, scored the same way — so most of what is asserted here is
 * sameness. The exceptions are the ones that matter: a format we cannot read is
 * refused with a reason, and a document whose structure is unreadable produces
 * `cantTell` rather than a guess.
 */

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ 'https://example.test/': GOOD_PAGE });
});

afterEach(async () => {
  await harness.app.close();
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

async function scan(bytes: Uint8Array, filename: string, extra: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/audits',
    payload: { source: 'media', filename, data: b64(bytes), ...extra },
  });
}

const GOOD_DOCX = docx({
  title: 'Quarterly accessibility report',
  language: 'en-GB',
  paragraphs: [
    { text: 'Quarterly accessibility report', style: 'Heading1' },
    { text: 'An introduction that says something.' },
    { text: 'Findings', style: 'Heading2' },
    { text: 'A chart of the results', imageAlt: 'Bar chart: 82% of pages passed.' },
  ],
  table: { headerRow: true, rows: [['Page', 'Score'], ['Home', '82']] },
});

describe('POST /v1/audits with a document', () => {
  it('returns the same report shape a page audit does', async () => {
    const response = await scan(GOOD_DOCX, 'report.docx');
    expect(response.statusCode).toBe(201);

    const report = response.json();
    expect(report.subject).toMatchObject({
      mediaKind: 'docx',
      filename: 'report.docx',
      title: 'Quarterly accessibility report',
      lang: 'en-GB',
    });
    expect(report.engine.wcagVersion).toBe('2.1');
    expect(report.score.value).toBeGreaterThan(0);
    expect(report.criteria.length).toBeGreaterThan(0);
  });

  it('finds no confirmed failures in a well-authored document', async () => {
    const report = (await scan(GOOD_DOCX, 'report.docx')).json();
    const failures = report.findings.filter((f: { outcome: string }) => f.outcome === 'failed');
    expect(failures).toEqual([]);
  });

  it('fails an image with no alt text and says where it is', async () => {
    const bytes = docx({
      title: 'Report',
      language: 'en',
      paragraphs: [
        { text: 'Report', style: 'Heading1' },
        { text: 'A chart', imageAlt: null },
      ],
    });

    const report = (await scan(bytes, 'report.docx')).json();
    const finding = report.findings.find(
      (f: { ruleId: string; outcome: string }) =>
        f.ruleId === 'media-image-alt' && f.outcome === 'failed',
    );

    expect(finding).toBeDefined();
    expect(finding.criteria).toContain('1.1.1');
    expect(finding.location.selector).toContain('Image');
  });

  it('fails a document that declares no language', async () => {
    // The properties were readable and simply do not name one, so this is a
    // real failure rather than something we could not tell.
    const bytes = docx({ title: 'Report', language: null, paragraphs: [{ text: 'Body text.' }] });
    const report = (await scan(bytes, 'report.docx')).json();

    const finding = report.findings.find((f: { ruleId: string }) => f.ruleId === 'media-has-language');
    expect(finding.outcome).toBe('failed');
  });

  it('sniffs the format from the bytes, not the extension', async () => {
    const response = await scan(GOOD_DOCX, 'report.pdf');
    expect(response.json().subject.mediaKind).toBe('docx');
  });

  it('reports cantTell for a PDF whose structure cannot be read', async () => {
    // Object streams hide the tagging state. Guessing "untagged" would fail a
    // document that may be perfectly tagged.
    const bytes = pdf({ tagged: true, title: 'Guide', lang: 'en', compressed: true });
    const report = (await scan(bytes, 'guide.pdf')).json();

    const undecided = report.findings.filter((f: { outcome: string }) => f.outcome === 'cantTell');
    expect(undecided.length).toBeGreaterThan(0);
    // And none of them was quietly turned into a failure.
    expect(
      report.findings.some(
        (f: { ruleId: string; outcome: string }) =>
          f.ruleId === 'media-reading-order' && f.outcome === 'failed',
      ),
    ).toBe(false);
  });

  it('audits a caption file against reading rate and cue timing', async () => {
    const bytes = webvtt([
      {
        start: '00:00:00.000',
        end: '00:00:01.000',
        text: 'This particular caption crams far too many words into a single second for anyone to read it',
      },
    ]);

    const report = (await scan(bytes, 'captions.vtt')).json();
    expect(report.subject.mediaKind).toBe('captions');
    expect(
      report.findings.some((f: { ruleId: string }) => f.ruleId === 'caption-reading-rate'),
    ).toBe(true);
  });

  it('never runs an HTML-only rule against a document', async () => {
    const report = (await scan(GOOD_DOCX, 'report.docx')).json();
    // A DOM rule cannot have an opinion about a Word file; running one would
    // mean scoring against checks that never applied.
    expect(report.rules.some((rule: { id: string }) => rule.id === 'img-alt')).toBe(false);
  });
});

describe('POST /v1/audits with a document — refusals', () => {
  it('refuses a file type it cannot read, and says why', async () => {
    const response = await scan(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'mystery.bin');

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().errors.filename[0]).toBeTruthy();
  });

  it('refuses an empty upload', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'media', filename: 'empty.pdf', data: '' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('refuses a filename carrying a path', async () => {
    const response = await scan(GOOD_DOCX, '../../etc/passwd');
    expect(response.statusCode).toBe(422);
    expect(response.json().errors.filename[0]).toMatch(/path/i);
  });

  it('refuses data that is not base64', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/audits',
      payload: { source: 'media', filename: 'report.docx', data: 'not base64!!' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('reports a site belonging to another organisation as missing', async () => {
    const site = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: { 'x-accessly-organisation': '00000000-0000-4000-8000-0000000000ff' },
      payload: { url: 'https://example.test/', label: 'Theirs' },
    });

    const response = await scan(GOOD_DOCX, 'report.docx', { siteId: site.json().id });
    expect(response.statusCode).toBe(404);
  });
});

describe('document audits and the rest of the platform', () => {
  it('is stored and listable alongside page audits', async () => {
    const created = (await scan(GOOD_DOCX, 'report.docx')).json();

    const list = await harness.app.inject({ method: 'GET', url: '/v1/audits' });
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(created.id);

    const fetched = await harness.app.inject({ method: 'GET', url: `/v1/audits/${created.id}` });
    expect(fetched.json().subject.filename).toBe('report.docx');
  });

  it('hashes the original bytes, so a re-upload of the same file is recognisable', async () => {
    const first = (await scan(GOOD_DOCX, 'report.docx')).json();
    const second = (await scan(GOOD_DOCX, 'report.docx')).json();

    expect(first.subject.contentHash).toBe(second.subject.contentHash);
    expect(first.id).not.toBe(second.id);
  });

  it('scopes a document audit to the calling organisation', async () => {
    const created = (await scan(GOOD_DOCX, 'report.docx')).json();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/audits/${created.id}`,
      headers: { 'x-accessly-organisation': '00000000-0000-4000-8000-0000000000ff' },
    });

    expect(response.statusCode).toBe(404);
  });
});
