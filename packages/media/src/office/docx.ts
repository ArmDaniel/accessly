import { node, type AccessibleNode, type AccessibleTree, type TreeUnknown } from '@accessly/core';
import { allText, attr, findAll, findFirst, localName, parseXml, type XmlNode } from '../xml.js';
import { openArchive, type Archive } from '../zip.js';

/**
 * Word document adapter.
 *
 * A DOCX is an OPC package: `word/document.xml` holds the body, `docProps/`
 * holds the title and language, and images arrive as `w:drawing` elements whose
 * `wp:docPr` carries the alt text.
 *
 * The single most important thing this adapter gets right is distinguishing a
 * *real* heading from text that merely looks like one. Word records the former
 * as a paragraph with `w:pStyle` of `Heading1`…`Heading9`; the latter is just a
 * paragraph with a big font. To a screen reader they are worlds apart, and to
 * the person who wrote them they look identical — which is exactly why this
 * check is worth automating.
 */

const HEADING_STYLE = /^heading\s*([1-9])$/i;

function styleOf(paragraph: XmlNode): string | null {
  const properties = findFirst(paragraph, 'pPr');
  if (!properties) return null;
  const style = findFirst(properties, 'pStyle');
  return style ? attr(style, 'val') : null;
}

function headingLevel(paragraph: XmlNode): number | null {
  const style = styleOf(paragraph);
  if (!style) return null;

  const match = HEADING_STYLE.exec(style.replace(/[-_]/g, ' '));
  if (match) return Number.parseInt(match[1] as string, 10);

  // Word localises style names but keeps the id stable; `Heading1` is the id.
  const compact = /^Heading([1-9])$/.exec(style);
  return compact ? Number.parseInt(compact[1] as string, 10) : null;
}

function isListParagraph(paragraph: XmlNode): boolean {
  const properties = findFirst(paragraph, 'pPr');
  if (!properties) return false;
  return findFirst(properties, 'numPr') !== null;
}

function paragraphText(paragraph: XmlNode): string {
  // `w:t` holds the runs of text; everything else in a paragraph is formatting.
  return findAll(paragraph, 't')
    .map((run) => run.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Images: `wp:docPr` carries `descr` (alt text) and `title`. */
function imagesIn(paragraph: XmlNode, page: number): AccessibleNode[] {
  return findAll(paragraph, 'docPr').map((properties, index) => {
    const description = attr(properties, 'descr');
    const title = attr(properties, 'title');
    const name = attr(properties, 'name');
    const decorative = attr(properties, 'decorative') === '1';

    return node({
      role: 'image',
      // Word's `name` is an auto-generated shape name ("Picture 3"), never a
      // description — treating it as alt text would report a pass for an image
      // nobody has described.
      name: description ?? title ?? null,
      locator: {
        path: `Paragraph ${page} › Image ${index + 1}${name ? ` (${name})` : ''}`,
        page,
      },
      props: {
        decorative,
        shapeName: name,
        source: 'docx',
      },
    });
  });
}

function tableNode(table: XmlNode, index: number): AccessibleNode {
  const rows = findAll(table, 'tr');

  /*
   * Word marks a repeating header row with `w:tblHeader` on the row. That is
   * the only structural signal it records, so a table whose first row is merely
   * bold has no headers as far as assistive technology is concerned.
   */
  const children = rows.map((row, rowIndex) => {
    const properties = findFirst(row, 'trPr');
    const isHeader = properties !== null && findFirst(properties, 'tblHeader') !== null;

    const cells = findAll(row, 'tc').map((cell, cellIndex) =>
      node({
        role: isHeader ? 'columnheader' : 'cell',
        name: null,
        text: allText(cell),
        locator: {
          path: `Table ${index + 1} › Row ${rowIndex + 1} › Cell ${cellIndex + 1}`,
        },
        props: { source: 'docx' },
      }),
    );

    return node({
      role: 'row',
      name: null,
      locator: { path: `Table ${index + 1} › Row ${rowIndex + 1}` },
      props: { header: isHeader },
      children: cells,
    });
  });

  return node({
    role: 'table',
    name: null,
    locator: { path: `Table ${index + 1}` },
    props: { source: 'docx', rows: rows.length },
    children,
  });
}

function hyperlinksIn(paragraph: XmlNode, page: number): AccessibleNode[] {
  return findAll(paragraph, 'hyperlink').map((link, index) =>
    node({
      role: 'link',
      name: paragraphText(link) || null,
      text: paragraphText(link),
      locator: { path: `Paragraph ${page} › Link ${index + 1}`, page },
      props: { source: 'docx' },
    }),
  );
}

function readCoreProperties(archive: Archive): { title: string | null; lang: string | null } {
  const core = archive.text('docProps/core.xml');
  const parsedCore = core ? parseXml(core) : null;
  const title = parsedCore ? (findFirst(parsedCore, 'title')?.text ?? null) : null;
  const language = parsedCore ? (findFirst(parsedCore, 'language')?.text ?? null) : null;
  return {
    title: title && title.trim().length > 0 ? title.trim() : null,
    lang: language && language.trim().length > 0 ? language.trim() : null,
  };
}

/** The body language, which Word records on runs rather than on the document. */
function readBodyLanguage(document: XmlNode): string | null {
  const languages = findAll(document, 'lang')
    .map((element) => attr(element, 'val'))
    .filter((value): value is string => value !== null && value.trim().length > 0);
  return languages[0] ?? null;
}

export function parseDocx(bytes: Uint8Array): AccessibleTree {
  // Only the parts the adapter reads are decompressed - a real DOCX embeds its
  // images under word/media/, which is most of its bytes and none of our
  // business.
  const archive = openArchive(bytes, {
    include: (name) =>
      name === '[Content_Types].xml' ||
      name.startsWith('word/') ||
      name.startsWith('docProps/'),
  });
  const unknowns: TreeUnknown[] = [];

  const documentXml = archive.text('word/document.xml');
  const parsed = documentXml ? parseXml(documentXml) : null;

  if (archive.truncated) {
    unknowns.push({
      topic: 'archive-truncated',
      reason: 'The archive expands beyond Accessly\u2019s size limits, so some parts were not read.',
    });
  }

  if (!parsed) {
    return {
      mediaKind: 'docx',
      title: null,
      lang: null,
      root: node({ role: 'document', name: null, locator: { path: 'Document' }, props: {} }),
      unknowns: [
        {
          topic: 'structure-tree',
          reason: 'word/document.xml is missing or could not be parsed, so the document body was not read.',
        },
      ],
      producer: 'accessly-docx-adapter/1',
    };
  }

  const { title, lang: coreLang } = readCoreProperties(archive);
  const lang = coreLang ?? readBodyLanguage(parsed);

  const body = findFirst(parsed, 'body') ?? parsed;
  const children: AccessibleNode[] = [];
  let paragraphIndex = 0;
  let tableIndex = 0;

  /*
   * Walk the body's direct children in order. Reading order in a Word document
   * is document order, which is why a DOCX rarely has the reading-order
   * problems a PDF or a slide deck does.
   */
  for (const element of body.children) {
    const name = localName(element.name);

    if (name === 'p') {
      paragraphIndex += 1;
      const text = paragraphText(element);
      const level = headingLevel(element);
      const images = imagesIn(element, paragraphIndex);
      const links = hyperlinksIn(element, paragraphIndex);

      if (level !== null) {
        children.push(
          node({
            role: 'heading',
            name: text || null,
            text,
            level,
            locator: { path: `Heading (level ${level}) › “${text.slice(0, 40)}”`, page: paragraphIndex },
            props: { source: 'docx', style: styleOf(element) },
            children: [...images, ...links],
          }),
        );
        continue;
      }

      if (isListParagraph(element)) {
        children.push(
          node({
            role: 'listitem',
            name: null,
            text,
            locator: { path: `List item › “${text.slice(0, 40)}”`, page: paragraphIndex },
            props: { source: 'docx' },
            children: [...images, ...links],
          }),
        );
        continue;
      }

      if (text.length === 0 && images.length === 0 && links.length === 0) continue;

      children.push(
        node({
          role: 'paragraph',
          name: null,
          text,
          locator: { path: `Paragraph ${paragraphIndex}`, page: paragraphIndex, snippet: text.slice(0, 80) },
          props: { source: 'docx' },
          children: [...images, ...links],
        }),
      );
      continue;
    }

    if (name === 'tbl') {
      children.push(tableNode(element, tableIndex));
      tableIndex += 1;
    }
  }

  /*
   * Note what is deliberately *not* here: an `unknown` for a missing language.
   *
   * The document properties were readable and simply do not declare one, which
   * is a real defect the rule should fail on. Recording an unknown would
   * downgrade it to "we could not tell", and the whole point of that mechanism
   * is to distinguish absent from unreadable. Reaching for it here would blunt
   * it everywhere.
   */

  return {
    mediaKind: 'docx',
    title,
    lang,
    root: node({
      role: 'document',
      name: title,
      ...(lang ? { lang } : {}),
      locator: { path: 'Document' },
      props: { source: 'docx' },
      children,
    }),
    unknowns,
    producer: 'accessly-docx-adapter/1',
  };
}
