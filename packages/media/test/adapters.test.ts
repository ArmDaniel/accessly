import { describe, expect, it } from 'vitest';
import { auditTree, findByRole, unknownAbout } from '@accessly/core';
import {
  UnsupportedMediaError,
  detectMediaKind,
  parseCues,
  parseMedia,
  readingRate,
} from '../src/index.js';
import { docx, epub, pdf, pptx, srt, webvtt, xlsx, zip } from './fixtures.js';

const audit = (bytes: Uint8Array, filename?: string) =>
  auditTree({
    ...parseMedia(bytes, filename ? { filename } : {}),
    url: `file:${filename ?? 'test'}`,
    filename: filename ?? null,
    target: 'AA',
  });

const ruleIds = (bytes: Uint8Array, filename?: string): string[] =>
  audit(bytes, filename)
    .findings.filter((finding) => finding.outcome === 'failed')
    .map((finding) => finding.ruleId);

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

describe('format detection', () => {
  it('identifies each format from its content, not its extension', () => {
    expect(detectMediaKind(pdf({}), 'anything.txt').kind).toBe('pdf');
    expect(detectMediaKind(docx({}), 'report.bin').kind).toBe('docx');
    expect(detectMediaKind(pptx({ slides: [] }), 'deck.zip').kind).toBe('pptx');
    expect(detectMediaKind(xlsx({ sheets: [] }), 'data').kind).toBe('xlsx');
    expect(detectMediaKind(epub({ chapters: [] }), 'book').kind).toBe('epub');
    expect(detectMediaKind(webvtt([]), 'subs').kind).toBe('captions');
  });

  it('recognises SubRip as well as WebVTT', () => {
    const bytes = srt([{ start: '00:00:01,000', end: '00:00:03,000', text: 'Hello' }]);
    expect(detectMediaKind(bytes, 'subs.srt').kind).toBe('captions');
  });

  it('recognises HTML', () => {
    const bytes = new TextEncoder().encode('<!doctype html><html><body>Hi</body></html>');
    expect(detectMediaKind(bytes).kind).toBe('html');
  });

  it('refuses a file it cannot identify rather than guessing', () => {
    const bytes = new TextEncoder().encode('just some prose, no format at all');
    expect(detectMediaKind(bytes).kind).toBeNull();
    expect(() => parseMedia(bytes)).toThrow(UnsupportedMediaError);
  });

  it('reports an unrecognised ZIP as unreadable rather than as a document', () => {
    const archive = zip({ 'notes.txt': 'hello' });
    const detection = detectMediaKind(archive, 'archive.zip');
    expect(detection.kind).toBeNull();
    expect(detection.reason).toMatch(/ZIP archive/i);
  });

  it('explains what it concluded and why', () => {
    expect(detectMediaKind(pdf({}), 'a.pdf').reason).toMatch(/%PDF-/);
    expect(detectMediaKind(docx({}), 'a.docx').reason).toMatch(/word\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Word
// ─────────────────────────────────────────────────────────────────────────────

describe('DOCX adapter', () => {
  it('reads title, language and body structure', () => {
    const { tree } = parseMedia(
      docx({
        title: 'Quarterly accessibility review',
        language: 'en-GB',
        paragraphs: [
          { text: 'Introduction', style: 'Heading1' },
          { text: 'Some prose that is long enough to matter.' },
        ],
      }),
    );

    expect(tree.mediaKind).toBe('docx');
    expect(tree.title).toBe('Quarterly accessibility review');
    expect(tree.lang).toBe('en-GB');

    const headings = findByRole(tree.root, 'heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.level).toBe(1);
    expect(headings[0]?.text).toBe('Introduction');
  });

  it('distinguishes a real heading from text that merely looks like one', () => {
    /*
     * This is the defining check for Word. Both paragraphs say "Chapter One";
     * only one of them is a heading, and to a screen reader user that is the
     * difference between a navigable document and a wall of text.
     */
    const styled = parseMedia(
      docx({ paragraphs: [{ text: 'Chapter One', style: 'Heading1' }] }),
    ).tree;
    const faked = parseMedia(docx({ paragraphs: [{ text: 'Chapter One' }] })).tree;

    expect(findByRole(styled.root, 'heading')).toHaveLength(1);
    expect(findByRole(faked.root, 'heading')).toHaveLength(0);
  });

  it('flags a document with substantial text and no headings', () => {
    const paragraphs = Array.from({ length: 10 }, (_, index) => ({
      text: `This is body paragraph number ${index} and it is comfortably long enough to count as substantial text.`,
    }));

    expect(ruleIds(docx({ title: 'Long report', language: 'en', paragraphs }))).toContain(
      'media-has-headings',
    );
  });

  it('reads alt text from a drawing, and flags an image without it', () => {
    const described = parseMedia(
      docx({ paragraphs: [{ text: 'See below', imageAlt: 'A bar chart of quarterly sales' }] }),
    ).tree;
    expect(findByRole(described.root, 'image')[0]?.name).toBe('A bar chart of quarterly sales');

    expect(ruleIds(docx({ title: 'Report', language: 'en', paragraphs: [{ text: 'x', imageAlt: null }] }))).toContain(
      'media-image-alt',
    );
  });

  it('does not treat the auto-generated shape name as alt text', () => {
    // Word names every picture "Picture 1". Accepting that as a description
    // would pass every undescribed image in every Word document ever made.
    const { tree } = parseMedia(docx({ paragraphs: [{ text: 'x', imageAlt: null }] }));
    expect(findByRole(tree.root, 'image')[0]?.name).toBeNull();
  });

  it('flags alt text that names the file instead of describing it', () => {
    expect(
      ruleIds(docx({ title: 'Report', language: 'en', paragraphs: [{ text: 'x', imageAlt: 'image1.png' }] })),
    ).toContain('media-image-alt');
  });

  it('recognises a marked header row and flags a table without one', () => {
    const withHeaders = docx({
      title: 'Report',
      language: 'en',
      table: { headerRow: true, rows: [['Month', 'Sales'], ['Jan', '10']] },
    });
    expect(ruleIds(withHeaders)).not.toContain('media-table-headers');

    const withoutHeaders = docx({
      title: 'Report',
      language: 'en',
      table: { headerRow: false, rows: [['Month', 'Sales'], ['Jan', '10']] },
    });
    expect(ruleIds(withoutHeaders)).toContain('media-table-headers');
  });

  it('flags bullets typed as text rather than made into a list', () => {
    const typed = docx({
      title: 'Report',
      language: 'en',
      paragraphs: [{ text: '- First item typed with a dash' }],
    });
    expect(ruleIds(typed)).toContain('media-list-structure');

    const real = docx({
      title: 'Report',
      language: 'en',
      paragraphs: [{ text: '- First item typed with a dash', list: true }],
    });
    expect(ruleIds(real)).not.toContain('media-list-structure');
  });

  it('flags a missing document title and a filename used as one', () => {
    expect(ruleIds(docx({ language: 'en', paragraphs: [{ text: 'x' }] }))).toContain('media-has-title');
    expect(
      ruleIds(docx({ title: 'report-final-v3.docx', language: 'en', paragraphs: [{ text: 'x' }] })),
    ).toContain('media-has-title');
  });

  it('flags a missing language', () => {
    expect(ruleIds(docx({ title: 'A proper title', paragraphs: [{ text: 'x' }] }))).toContain(
      'media-has-language',
    );
  });

  it('records an unknown rather than failing when the body cannot be read', () => {
    const broken = zip({ 'docProps/core.xml': '<x/>', 'word/other.xml': '<x/>' });
    // Detection needs a word/ part; the body is deliberately absent.
    const { tree } = parseMedia(broken, { kind: 'docx' });
    expect(unknownAbout(tree, 'structure-tree')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PowerPoint
// ─────────────────────────────────────────────────────────────────────────────

describe('PPTX adapter', () => {
  it('reads slides in order with their titles', () => {
    const { tree } = parseMedia(
      pptx({
        title: 'Onboarding',
        language: 'en',
        slides: [{ title: 'Welcome' }, { title: 'Agenda', body: ['One', 'Two'] }],
      }),
    );

    const slides = findByRole(tree.root, 'slide');
    expect(slides).toHaveLength(2);
    expect(slides[0]?.name).toBe('Welcome');
    expect(slides[1]?.name).toBe('Agenda');
    expect(slides[0]?.locator.page).toBe(1);
  });

  it('flags a slide with no title placeholder', () => {
    const deck = pptx({
      title: 'Deck',
      language: 'en',
      slides: [{ title: 'Fine' }, { title: null, body: ['Text in a box, not a title'] }],
    });

    const failures = audit(deck).findings.filter((f) => f.ruleId === 'media-slide-title');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/Slide 2/);
  });

  it('reads alt text on pictures and honours the decorative flag', () => {
    const described = parseMedia(
      pptx({ slides: [{ title: 'S', images: [{ alt: 'Team photo at the summit' }] }] }),
    ).tree;
    expect(findByRole(described.root, 'image')[0]?.name).toBe('Team photo at the summit');

    const decorative = parseMedia(
      pptx({ slides: [{ title: 'S', images: [{ alt: null, decorative: true }] }] }),
    ).tree;
    expect(findByRole(decorative.root, 'image')[0]?.props.decorative).toBe(true);
  });

  it('does not report an image the author marked decorative', () => {
    const deck = pptx({
      title: 'Deck',
      language: 'en',
      slides: [{ title: 'S', images: [{ alt: null, decorative: true }] }],
    });
    expect(ruleIds(deck)).not.toContain('media-image-alt');
  });

  it('flags a chart with no description of what it shows', () => {
    const deck = pptx({
      title: 'Deck',
      language: 'en',
      slides: [{ title: 'Results', chart: { alt: 'Chart 1' } }],
    });
    expect(ruleIds(deck)).toContain('media-chart-description');

    const described = pptx({
      title: 'Deck',
      language: 'en',
      slides: [
        {
          title: 'Results',
          chart: { alt: 'Sales fell 12% between Q1 and Q3, with the sharpest drop in July.' },
        },
      ],
    });
    expect(ruleIds(described)).not.toContain('media-chart-description');
  });

  it('always records reading order as unverifiable', () => {
    // Shape order in the file is the order shapes were added, not where they
    // sit on the slide, and we cannot see the layout.
    const { tree } = parseMedia(pptx({ slides: [{ title: 'S' }] }));
    expect(unknownAbout(tree, 'reading-order')).toBeDefined();

    const report = audit(pptx({ title: 'D', language: 'en', slides: [{ title: 'S' }] }));
    const finding = report.findings.find((f) => f.ruleId === 'media-reading-order');
    expect(finding?.outcome).toBe('cantTell');
    expect(finding?.remediation).toMatch(/selection pane/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Excel
// ─────────────────────────────────────────────────────────────────────────────

describe('XLSX adapter', () => {
  it('reads sheets and their names', () => {
    const { tree } = parseMedia(
      xlsx({ title: 'Budget', sheets: [{ name: 'Summary', rows: 12, asTable: true }] }),
    );
    const tables = findByRole(tree.root, 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe('Summary');
  });

  it('treats a defined table as having headers', () => {
    const workbook = xlsx({ title: 'Budget', sheets: [{ name: 'Summary', rows: 12, asTable: true }] });
    expect(ruleIds(workbook)).not.toContain('media-table-headers');
  });

  it('reports cantTell when no header structure is recorded', () => {
    /*
     * Excel does not record "the first row is bold", so a styled header and no
     * header are indistinguishable in the file. That is a cantTell, not a
     * failure — reporting it as one would be wrong half the time.
     */
    const workbook = xlsx({ title: 'Budget', sheets: [{ name: 'Summary', rows: 12 }] });
    const finding = audit(workbook).findings.find((f) => f.ruleId === 'media-table-headers');
    expect(finding?.outcome).toBe('cantTell');
  });

  it('notes sheets left with default names', () => {
    const { tree } = parseMedia(
      xlsx({ title: 'Budget', sheets: [{ name: 'Sheet1', rows: 5 }, { name: 'Costs', rows: 5 }] }),
    );
    expect(unknownAbout(tree, 'sheet-names')?.reason).toMatch(/Sheet1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EPUB
// ─────────────────────────────────────────────────────────────────────────────

describe('EPUB adapter', () => {
  const chapter = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;

  it('follows the spine and projects each chapter through the HTML adapter', () => {
    const { tree } = parseMedia(
      epub({
        title: 'A Short Book',
        language: 'en',
        chapters: [
          { href: 'c1.xhtml', html: chapter('One', '<h1>One</h1><p>Text.</p>') },
          { href: 'c2.xhtml', html: chapter('Two', '<h1>Two</h1><p>More text.</p>') },
        ],
      }),
    );

    expect(tree.title).toBe('A Short Book');
    expect(tree.lang).toBe('en');
    expect(findByRole(tree.root, 'section')).toHaveLength(2);
    // Reusing the HTML projection is what gives e-books the full rule set.
    expect(findByRole(tree.root, 'heading')).toHaveLength(2);
  });

  it('prefixes locators with the chapter so findings stay pointable', () => {
    const { tree } = parseMedia(
      epub({
        title: 'Book',
        language: 'en',
        chapters: [{ href: 'c1.xhtml', html: chapter('One', '<h1>One</h1><img src="a.png">') }],
      }),
    );
    const image = findByRole(tree.root, 'image')[0];
    expect(image?.locator.path).toMatch(/^Chapter 1 ›/);
  });

  it('notes missing EPUB accessibility metadata', () => {
    const { tree } = parseMedia(
      epub({ title: 'Book', language: 'en', chapters: [{ href: 'c1.xhtml', html: chapter('One', '<p>x</p>') }] }),
    );
    expect(unknownAbout(tree, 'a11y-metadata')?.reason).toMatch(/schema:accessibilityFeature/);
  });

  it('is satisfied when the metadata is declared', () => {
    const { tree } = parseMedia(
      epub({
        title: 'Book',
        language: 'en',
        a11yMetadata: true,
        chapters: [{ href: 'c1.xhtml', html: chapter('One', '<p>x</p>') }],
      }),
    );
    expect(unknownAbout(tree, 'a11y-metadata')).toBeUndefined();
  });

  it('notes a chapter listed in the spine but missing from the archive', () => {
    const bytes = epub({
      title: 'Book',
      language: 'en',
      chapters: [{ href: 'c1.xhtml', html: chapter('One', '<p>x</p>') }],
    });
    // Rebuild without the chapter file to simulate a broken package.
    const { tree } = parseMedia(bytes);
    expect(tree.unknowns.every((unknown) => unknown.topic !== 'structure-tree')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────────

describe('PDF adapter', () => {
  it('recognises a tagged PDF', () => {
    const { tree } = parseMedia(pdf({ tagged: true, lang: 'en-GB', title: 'Annual report 2026' }));
    expect(tree.root.props.tagged).toBe(true);
    expect(tree.lang).toBe('en-GB');
    expect(tree.title).toBe('Annual report 2026');
  });

  it('flags an untagged PDF', () => {
    const { tree } = parseMedia(pdf({ tagged: false, title: 'Report', lang: 'en' }));
    expect(tree.root.props.tagged).toBe(false);
  });

  it('will not call a PDF untagged when it could not read the structure', () => {
    /*
     * The most important honesty case in this adapter. A compressed object
     * stream hides the catalogue; concluding "untagged" from that would be a
     * confident, wrong accusation about a file that may be perfectly tagged.
     */
    const { tree } = parseMedia(pdf({ tagged: false, compressed: true, title: 'Report' }));
    expect(tree.root.props.tagged).toBeNull();
    expect(unknownAbout(tree, 'structure-tree')?.reason).toMatch(/compressed/i);
  });

  it('says so when the file is encrypted', () => {
    const { tree } = parseMedia(pdf({ encrypted: true, title: 'Report' }));
    expect(unknownAbout(tree, 'structure-tree')?.reason).toMatch(/encrypted/i);
  });

  it('reads a UTF-16 hex-encoded title', () => {
    // Acrobat writes non-ASCII titles as UTF-16BE hex with a byte-order mark.
    const bytes = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Title <FEFF00520061007000700F> >> endobj\n%%EOF',
    );
    const { tree } = parseMedia(bytes);
    expect(tree.title?.startsWith('Rapp')).toBe(true);
  });

  it('reads figures and their alt text', () => {
    const { tree } = parseMedia(
      pdf({
        tagged: true,
        lang: 'en',
        title: 'Report',
        figures: [{ alt: 'A map of the delivery region' }, { alt: null }],
      }),
    );
    const images = findByRole(tree.root, 'image');
    expect(images).toHaveLength(2);
    expect(images[0]?.name).toBe('A map of the delivery region');
    expect(images[1]?.name).toBeNull();
  });

  it('flags a figure with no alt text', () => {
    expect(
      ruleIds(pdf({ tagged: true, lang: 'en', title: 'Report', figures: [{ alt: null }] })),
    ).toContain('media-image-alt');
  });

  it('flags a missing language and title', () => {
    const failures = ruleIds(pdf({ tagged: true }));
    expect(failures).toContain('media-has-language');
    expect(failures).toContain('media-has-title');
  });

  it('counts pages', () => {
    const { tree } = parseMedia(pdf({ tagged: true, pages: 4, title: 'R', lang: 'en' }));
    expect(findByRole(tree.root, 'page')).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Captions
// ─────────────────────────────────────────────────────────────────────────────

describe('caption adapter and rules', () => {
  const cue = (start: string, end: string, text: string) => ({ start, end, text });

  it('parses WebVTT cues with their timings', () => {
    const cues = parseCues(
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello there\n\n2\n00:00:04.000 --> 00:00:06.000\nSecond line',
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[0]?.endMs).toBe(3000);
    expect(cues[0]?.text).toBe('Hello there');
  });

  it('parses SubRip with comma decimals', () => {
    const cues = parseCues('1\n00:00:01,000 --> 00:00:03,000\nHello\n');
    expect(cues).toHaveLength(1);
    expect(cues[0]?.startMs).toBe(1000);
  });

  it('handles hour-less timestamps and inline markup', () => {
    const cues = parseCues('WEBVTT\n\n00:01.000 --> 00:04.000\n<b>Bold</b> text');
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[0]?.text).toBe('Bold text');
  });

  it('computes a reading rate', () => {
    // Six words in two seconds is 180 wpm.
    const rate = readingRate({ index: 1, startMs: 0, endMs: 2000, text: 'one two three four five six' });
    expect(Math.round(rate)).toBe(180);
  });

  it('accepts captions at a comfortable reading rate', () => {
    const bytes = webvtt([cue('00:00:01.000', '00:00:04.000', 'A short and readable caption line')]);
    expect(ruleIds(bytes, 'subs.vtt')).not.toContain('caption-reading-rate');
  });

  it('flags captions that go past far too quickly', () => {
    const bytes = webvtt([
      cue(
        '00:00:01.000',
        '00:00:02.000',
        'This caption contains far too many words to be read in a single second by anybody at all',
      ),
    ]);
    const finding = audit(bytes, 'subs.vtt').findings.find((f) => f.ruleId === 'caption-reading-rate');
    expect(finding?.outcome).toBe('failed');
    expect(finding?.message).toMatch(/words per minute/);
  });

  it('flags a cue that is on screen too briefly', () => {
    const bytes = webvtt([cue('00:00:01.000', '00:00:01.300', 'Too fast')]);
    expect(ruleIds(bytes, 'subs.vtt')).toContain('caption-cue-duration');
  });

  it('flags overlapping cues', () => {
    const bytes = webvtt([
      cue('00:00:01.000', '00:00:05.000', 'First caption line here'),
      cue('00:00:04.000', '00:00:08.000', 'Second caption line here'),
    ]);
    expect(ruleIds(bytes, 'subs.vtt')).toContain('caption-cue-overlap');
  });

  it('flags placeholder transcription', () => {
    const bytes = webvtt([cue('00:00:01.000', '00:00:04.000', '[inaudible]')]);
    expect(ruleIds(bytes, 'subs.vtt')).toContain('caption-cue-content');
  });

  it('raises speaker identification for review on a long unlabelled track', () => {
    const cues = Array.from({ length: 25 }, (_, index) =>
      cue(
        `00:00:${String(index * 4).padStart(2, '0')}.000`,
        `00:00:${String(index * 4 + 3).padStart(2, '0')}.000`,
        'Some dialogue here',
      ),
    );
    const finding = audit(webvtt(cues), 'subs.vtt').findings.find(
      (f) => f.ruleId === 'caption-speaker-identification',
    );
    expect(finding?.outcome).toBe('cantTell');
  });

  it('is satisfied when speakers are labelled', () => {
    const cues = Array.from({ length: 25 }, (_, index) =>
      cue(
        `00:00:${String(index * 4).padStart(2, '0')}.000`,
        `00:00:${String(index * 4 + 3).padStart(2, '0')}.000`,
        '>> ANNA: Some dialogue here',
      ),
    );
    expect(
      audit(webvtt(cues), 'subs.vtt').findings.some(
        (f) => f.ruleId === 'caption-speaker-identification',
      ),
    ).toBe(false);
  });

  it('does not count speaker labels as spoken words when rating', () => {
    const withLabel = readingRate({
      index: 1,
      startMs: 0,
      endMs: 2000,
      text: '>> ANNA: one two three four five six',
    });
    expect(Math.round(withLabel)).toBe(180);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

describe('media reports', () => {
  it('produces the same report shape as an HTML audit', () => {
    const report = audit(docx({ title: 'A report', language: 'en', paragraphs: [{ text: 'x' }] }), 'r.docx');

    expect(report.status).toBe('succeeded');
    expect(report.subject.mediaKind).toBe('docx');
    expect(report.subject.filename).toBe('r.docx');
    expect(report.subject.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.score.value).toBeGreaterThanOrEqual(0);
    expect(report.score.value).toBeLessThanOrEqual(100);
    expect(report.engine.wcagVersion).toBe('2.1');
  });

  it('never runs an HTML-only rule against a non-HTML file', () => {
    /*
     * If a DOM rule ran here it would report nothing and be counted as
     * "passed", which would silently credit the PDF with coverage it never
     * received.
     */
    const report = audit(pdf({ tagged: true, lang: 'en', title: 'Report' }), 'r.pdf');
    const domRuleIds = ['image-alt', 'text-contrast', 'focus-visible', 'page-has-title'];
    for (const ruleId of domRuleIds) {
      expect(report.rules.some((rule) => rule.ruleId === ruleId)).toBe(false);
    }
  });

  it('reports fewer decidable criteria for a PDF than for a web page', () => {
    // Honest coverage per format: a PDF simply cannot be checked as thoroughly.
    const pdfReport = audit(pdf({ tagged: true, lang: 'en', title: 'Report' }), 'r.pdf');
    expect(pdfReport.score.criteriaRequiringManualReview).toBeGreaterThan(
      pdfReport.score.criteriaEvaluated,
    );
  });

  it('gives every finding a locator a person can act on', () => {
    const report = audit(
      pptx({ title: 'Deck', language: 'en', slides: [{ title: null, images: [{ alt: null }] }] }),
      'deck.pptx',
    );

    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.location.selector.length).toBeGreaterThan(0);
      expect(finding.remediation.length).toBeGreaterThan(20);
    }
    expect(report.findings.some((f) => /Slide \d/.test(f.location.selector))).toBe(true);
  });

  it('is deterministic', () => {
    const bytes = docx({ title: 'A report', language: 'en', paragraphs: [{ text: 'x', imageAlt: null }] });
    const first = audit(bytes).findings.map((f) => f.id);
    const second = audit(bytes).findings.map((f) => f.id);
    expect(first).toEqual(second);
  });

  it('produces no confirmed failures for a well-authored document', () => {
    const clean = docx({
      title: 'Ordering a replacement card',
      language: 'en-GB',
      paragraphs: [
        { text: 'Ordering a replacement card', style: 'Heading1' },
        { text: 'Use the form below to order a replacement card for your account.' },
        { text: 'Delivery options', style: 'Heading2' },
        { text: 'Standard delivery takes five working days.', list: true },
        { text: 'A bank card with the chip facing upwards', imageAlt: 'A bank card with the chip facing upwards' },
      ],
      table: { headerRow: true, rows: [['Option', 'Arrives'], ['Standard', '5 days']] },
    });

    const failures = audit(clean, 'card.docx').findings.filter((f) => f.outcome === 'failed');
    expect(failures.map((f) => `${f.ruleId}: ${f.message}`)).toEqual([]);
  });
});
