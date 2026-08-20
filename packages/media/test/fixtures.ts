import { zipSync, strToU8 } from 'fflate';

/**
 * Minimal but structurally real fixtures.
 *
 * Built rather than checked in as binaries, for three reasons: a test that
 * constructs the exact XML it is asserting on documents what the adapter cares
 * about; a reviewer can see the difference between a passing and failing
 * fixture in the diff; and there are no opaque blobs in the repository that
 * nobody dares regenerate.
 *
 * The parts are trimmed to what the adapters read. They are not complete
 * OOXML packages and would not open in Word — that is deliberate, because the
 * adapters must not depend on parts they do not need.
 */

export function zip(entries: Record<string, string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(entries)) {
    encoded[path] = strToU8(content);
  }
  return zipSync(encoded);
}

const coreProps = (title: string | null, language: string | null): string => `<?xml version="1.0"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  ${title === null ? '' : `<dc:title>${title}</dc:title>`}
  ${language === null ? '' : `<dc:language>${language}</dc:language>`}
</cp:coreProperties>`;

// ── DOCX ─────────────────────────────────────────────────────────────────────

export interface DocxParagraph {
  text: string;
  /** `Heading1`…`Heading9`, or omitted for body text. */
  style?: string;
  /** Render as a numbered/bulleted list item. */
  list?: boolean;
  /** Add an image with this alt text; empty string means "no alt". */
  imageAlt?: string | null;
  link?: { text: string };
}

export function docx(options: {
  title?: string | null;
  language?: string | null;
  paragraphs?: DocxParagraph[];
  table?: { headerRow: boolean; rows: string[][] };
}): Uint8Array {
  const paragraphs = (options.paragraphs ?? [])
    .map((paragraph) => {
      const properties = [
        paragraph.style ? `<w:pStyle w:val="${paragraph.style}"/>` : '',
        paragraph.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
      ].join('');

      const image =
        paragraph.imageAlt === undefined
          ? ''
          : `<w:drawing><wp:inline><wp:docPr id="1" name="Picture 1"${
              paragraph.imageAlt === null || paragraph.imageAlt === ''
                ? ''
                : ` descr="${paragraph.imageAlt}"`
            }/></wp:inline></w:drawing>`;

      const link = paragraph.link
        ? `<w:hyperlink r:id="rId1"><w:r><w:t>${paragraph.link.text}</w:t></w:r></w:hyperlink>`
        : '';

      return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}<w:r><w:t>${paragraph.text}</w:t></w:r>${image}${link}</w:p>`;
    })
    .join('');

  const table = options.table
    ? `<w:tbl>${options.table.rows
        .map(
          (row, rowIndex) =>
            `<w:tr>${
              options.table?.headerRow && rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
            }${row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
        )
        .join('')}</w:tbl>`
    : '';

  return zip({
    'docProps/core.xml': coreProps(options.title ?? null, options.language ?? null),
    'word/document.xml': `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${paragraphs}${table}</w:body>
</w:document>`,
  });
}

// ── PPTX ─────────────────────────────────────────────────────────────────────

export interface Slide {
  title?: string | null;
  body?: string[];
  images?: { alt: string | null; decorative?: boolean }[];
  chart?: { alt: string | null };
}

export function pptx(options: {
  title?: string | null;
  language?: string | null;
  slides: Slide[];
}): Uint8Array {
  const entries: Record<string, string> = {
    'docProps/core.xml': coreProps(options.title ?? null, options.language ?? null),
    // Present in every real package, and what format detection keys on.
    'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation/>',
  };

  options.slides.forEach((slide, index) => {
    const shapes: string[] = [];

    if (slide.title !== null && slide.title !== undefined) {
      shapes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
          `<p:txBody><a:p><a:r><a:t>${slide.title}</a:t></a:r></a:p></p:txBody></p:sp>`,
      );
    }

    for (const [bodyIndex, text] of (slide.body ?? []).entries()) {
      shapes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${10 + bodyIndex}" name="Content ${bodyIndex + 1}"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>` +
          `<p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`,
      );
    }

    for (const [imageIndex, image] of (slide.images ?? []).entries()) {
      shapes.push(
        `<p:pic><p:nvPicPr><p:cNvPr id="${20 + imageIndex}" name="Picture ${imageIndex + 1}"` +
          `${image.alt ? ` descr="${image.alt}"` : ''}>` +
          `${image.decorative ? '<adec:decorative val="1"/>' : ''}</p:cNvPr></p:nvPicPr></p:pic>`,
      );
    }

    if (slide.chart) {
      shapes.push(
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="30" name="Chart 1"` +
          `${slide.chart.alt ? ` descr="${slide.chart.alt}"` : ''}/></p:nvGraphicFramePr>` +
          `<a:graphic><a:graphicData><c:chart/></a:graphicData></a:graphic></p:graphicFrame>`,
      );
    }

    entries[`ppt/slides/slide${index + 1}.xml`] = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative">
  <p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld>
</p:sld>`;
  });

  return zip(entries);
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

export function xlsx(options: {
  title?: string | null;
  sheets: { name: string; rows: number; asTable?: boolean; autoFilter?: boolean }[];
}): Uint8Array {
  const entries: Record<string, string> = {
    'docProps/core.xml': coreProps(options.title ?? null, null),
    'xl/workbook.xml': `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>${options.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')}</sheets>
</workbook>`,
  };

  options.sheets.forEach((sheet, index) => {
    const rows = Array.from(
      { length: sheet.rows },
      (_, rowIndex) => `<row r="${rowIndex + 1}"><c><v>1</v></c></row>`,
    ).join('');

    entries[`xl/worksheets/sheet${index + 1}.xml`] = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows}</sheetData>
  ${sheet.autoFilter ? '<autoFilter ref="A1:B10"/>' : ''}
</worksheet>`;

    if (sheet.asTable) {
      entries[`xl/tables/table${index + 1}.xml`] = `<?xml version="1.0"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  displayName="${sheet.name}Table" ref="A1:B10" headerRowCount="1"/>`;
    }
  });

  return zip(entries);
}

// ── EPUB ─────────────────────────────────────────────────────────────────────

export function epub(options: {
  title?: string | null;
  language?: string | null;
  chapters: { href: string; html: string }[];
  a11yMetadata?: boolean;
}): Uint8Array {
  const manifest = options.chapters
    .map((chapter, index) => `<item id="c${index}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
    .join('');
  const spine = options.chapters.map((_, index) => `<itemref idref="c${index}"/>`).join('');

  const a11y = options.a11yMetadata
    ? `<meta property="schema:accessibilityFeature">structuralNavigation</meta>
       <meta property="schema:accessibilitySummary">Fully navigable.</meta>
       <meta property="schema:accessMode">textual</meta>
       <meta property="schema:accessibilityHazard">none</meta>`
    : '';

  const entries: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${options.title === null || options.title === undefined ? '' : `<dc:title>${options.title}</dc:title>`}
    ${options.language === null || options.language === undefined ? '' : `<dc:language>${options.language}</dc:language>`}
    ${a11y}
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`,
  };

  for (const chapter of options.chapters) {
    entries[`OEBPS/${chapter.href}`] = chapter.html;
  }

  return zip(entries);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export function pdf(options: {
  tagged?: boolean;
  lang?: string | null;
  title?: string | null;
  displayDocTitle?: boolean;
  pages?: number;
  figures?: { alt: string | null }[];
  compressed?: boolean;
  encrypted?: boolean;
}): Uint8Array {
  const parts: string[] = ['%PDF-1.7'];

  const catalogEntries = [
    '/Type /Catalog',
    options.tagged ? '/MarkInfo << /Marked true >>' : '',
    options.tagged ? '/StructTreeRoot 10 0 R' : '',
    options.lang ? `/Lang (${options.lang})` : '',
    options.displayDocTitle !== undefined
      ? `/ViewerPreferences << /DisplayDocTitle ${options.displayDocTitle} >>`
      : '',
  ].filter((entry) => entry.length > 0);

  parts.push(`1 0 obj << ${catalogEntries.join(' ')} >> endobj`);

  if (options.title) {
    parts.push(`2 0 obj << /Title (${options.title}) >> endobj`);
  }

  const pageCount = options.pages ?? 1;
  parts.push(`3 0 obj << /Type /Pages /Count ${pageCount} >> endobj`);
  for (let index = 0; index < pageCount; index += 1) {
    parts.push(`${4 + index} 0 obj << /Type /Page /Parent 3 0 R >> endobj`);
  }

  for (const [index, figure] of (options.figures ?? []).entries()) {
    parts.push(
      `${50 + index} 0 obj << /S /Figure ${figure.alt ? `/Alt (${figure.alt})` : ''} >> endobj`,
    );
  }

  if (options.compressed) parts.push('90 0 obj << /Type /ObjStm /N 4 >> stream endstream endobj');
  if (options.encrypted) parts.push('trailer << /Encrypt 99 0 R >>');

  parts.push('%%EOF');
  return strToU8(parts.join('\n'));
}

// ── Captions ─────────────────────────────────────────────────────────────────

export interface CueSpec {
  start: string;
  end: string;
  text: string;
}

export function webvtt(cues: CueSpec[]): Uint8Array {
  const body = cues
    .map((cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}`)
    .join('\n\n');
  return strToU8(`WEBVTT\n\n${body}\n`);
}

export function srt(cues: CueSpec[]): Uint8Array {
  const body = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${cue.start.replace('.', ',')} --> ${cue.end.replace('.', ',')}\n${cue.text}`,
    )
    .join('\n\n');
  return strToU8(`${body}\n`);
}
