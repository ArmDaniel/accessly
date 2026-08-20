import { node, type AccessibleNode, type AccessibleTree, type TreeUnknown } from '@accessly/core';
import { allText, attr, findAll, findFirst, parseXml, type XmlNode } from '../xml.js';
import { openArchive, type Archive } from '../zip.js';

/**
 * PowerPoint adapter.
 *
 * Slides live at `ppt/slides/slideN.xml`, one file each. Within a slide every
 * visual is a shape (`p:sp`) or a picture (`p:pic`), each with non-visual
 * properties (`p:cNvPr`) carrying the name and the alt text.
 *
 * Two things make decks distinctively bad for accessibility, and both are
 * detectable here:
 *
 *  1. **Missing slide titles.** The title is the only handle a screen reader
 *     user has on a deck — it is what the slide list is built from. PowerPoint
 *     records it as the shape whose placeholder type is `title` or `ctrTitle`,
 *     so a deck where someone deleted the placeholder and typed a big text box
 *     instead has no titles at all, however it looks.
 *
 *  2. **Reading order.** Shapes are read in the order they appear in the XML,
 *     which is the order they were added — not the order they are laid out on
 *     screen. Moving a shape does not reorder it. We can record the order but
 *     cannot see the layout, so that stays a `cantTell`.
 */

const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

function slideNumber(path: string): number {
  const match = /slide(\d+)\.xml$/.exec(path);
  return match ? Number.parseInt(match[1] as string, 10) : 0;
}

/** Placeholder type of a shape, when it is a placeholder at all. */
function placeholderType(shape: XmlNode): string | null {
  const nvProps = findFirst(shape, 'nvSpPr');
  if (!nvProps) return null;
  const placeholder = findFirst(nvProps, 'ph');
  return placeholder ? (attr(placeholder, 'type') ?? 'body') : null;
}

function shapeName(shape: XmlNode): string | null {
  const properties = findFirst(shape, 'cNvPr');
  return properties ? attr(properties, 'name') : null;
}

function altText(shape: XmlNode): { alt: string | null; decorative: boolean } {
  const properties = findFirst(shape, 'cNvPr');
  if (!properties) return { alt: null, decorative: false };

  const descr = attr(properties, 'descr');
  // PowerPoint marks decorative images with a `decorative` extension; when
  // present it is an explicit author decision and must not be reported.
  const decorative = findAll(properties, 'decorative').length > 0;

  return { alt: descr && descr.trim().length > 0 ? descr.trim() : null, decorative };
}

function shapeText(shape: XmlNode): string {
  const body = findFirst(shape, 'txBody');
  return body ? allText(body) : '';
}

function parseSlide(xml: XmlNode, index: number): { slide: AccessibleNode; title: string | null } {
  const tree = findFirst(xml, 'spTree') ?? xml;
  const children: AccessibleNode[] = [];
  let title: string | null = null;
  let shapeIndex = 0;

  for (const element of tree.children) {
    const name = element.name.includes(':') ? element.name.split(':')[1] : element.name;

    if (name === 'sp') {
      shapeIndex += 1;
      const placeholder = placeholderType(element);
      const text = shapeText(element);

      if (placeholder && TITLE_PLACEHOLDERS.has(placeholder)) {
        title = text.trim().length > 0 ? text.trim() : null;
        continue;
      }

      if (text.trim().length === 0) continue;

      children.push(
        node({
          role: 'paragraph',
          name: null,
          text,
          locator: {
            path: `Slide ${index} › ${shapeName(element) ?? `Shape ${shapeIndex}`}`,
            page: index,
            snippet: text.slice(0, 80),
          },
          props: { source: 'pptx', placeholder, readingPosition: shapeIndex },
        }),
      );
      continue;
    }

    if (name === 'pic') {
      shapeIndex += 1;
      const { alt, decorative } = altText(element);

      /*
       * Real PowerPoint video is a `p:pic` wrapping an `a:videoFile` (or
       * `p:media`) relationship - there is no separate `p:video` element in
       * practice. Detect it here, inside the picture branch, or every embedded
       * video is silently audited as an image.
       */
      const isVideo =
        findAll(element, 'videoFile').length > 0 || findAll(element, 'media').length > 0;

      children.push(
        isVideo
          ? node({
              role: 'video',
              name: alt,
              locator: {
                path: `Slide ${index} > ${shapeName(element) ?? `Video ${shapeIndex}`}`,
                page: index,
              },
              props: { source: 'pptx', tracksUnknown: true, readingPosition: shapeIndex },
            })
          : node({
              role: 'image',
              name: alt,
              locator: {
                path: `Slide ${index} > ${shapeName(element) ?? `Picture ${shapeIndex}`}`,
                page: index,
              },
              props: { source: 'pptx', decorative, readingPosition: shapeIndex },
            }),
      );
      continue;
    }

    if (name === 'graphicFrame') {
      shapeIndex += 1;
      const isChart = findAll(element, 'chart').length > 0;
      const table = findFirst(element, 'tbl');

      if (table) {
        const rows = findAll(table, 'tr');
        const firstRowIsHeader = attr(findFirst(table, 'tblPr') ?? table, 'firstRow') === '1';

        children.push(
          node({
            role: 'table',
            name: shapeName(element),
            locator: { path: `Slide ${index} › Table`, page: index },
            props: { source: 'pptx', headerRowUnknown: !firstRowIsHeader },
            children: rows.map((row, rowIndex) =>
              node({
                role: 'row',
                name: null,
                locator: { path: `Slide ${index} › Table › Row ${rowIndex + 1}`, page: index },
                props: {},
                children: findAll(row, 'tc').map((cell, cellIndex) =>
                  node({
                    role: firstRowIsHeader && rowIndex === 0 ? 'columnheader' : 'cell',
                    name: null,
                    text: allText(cell),
                    locator: {
                      path: `Slide ${index} › Table › R${rowIndex + 1}C${cellIndex + 1}`,
                      page: index,
                    },
                    props: {},
                  }),
                ),
              }),
            ),
          }),
        );
        continue;
      }

      const { alt } = altText(element);
      children.push(
        node({
          role: 'figure',
          name: alt,
          description: alt,
          locator: {
            path: `Slide ${index} › ${shapeName(element) ?? 'Object'}`,
            page: index,
          },
          props: { source: 'pptx', chart: isChart, readingPosition: shapeIndex },
        }),
      );
      continue;
    }

  }

  return {
    slide: node({
      role: 'slide',
      name: title,
      locator: { path: `Slide ${index}`, page: index },
      props: { source: 'pptx', shapeCount: shapeIndex },
      children,
    }),
    title,
  };
}

function readCoreProperties(archive: Archive): { title: string | null; lang: string | null } {
  const core = archive.text('docProps/core.xml');
  const parsed = core ? parseXml(core) : null;
  const title = parsed ? (findFirst(parsed, 'title')?.text ?? null) : null;
  const language = parsed ? (findFirst(parsed, 'language')?.text ?? null) : null;
  return {
    title: title && title.trim().length > 0 ? title.trim() : null,
    lang: language && language.trim().length > 0 ? language.trim() : null,
  };
}

export function parsePptx(bytes: Uint8Array): AccessibleTree {
  // Slide XML and properties only: a real deck carries its fonts, images and
  // videos under ppt/media/, which dwarfs the XML and tells us nothing the
  // alt-text attributes don't.
  const archive = openArchive(bytes, {
    include: (name) =>
      name === '[Content_Types].xml' ||
      name.startsWith('ppt/slides/') ||
      name.startsWith('ppt/theme/') ||
      name.startsWith('docProps/'),
  });
  const unknowns: TreeUnknown[] = [];

  const slidePaths = archive
    .match((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .slice()
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slidePaths.length === 0) {
    return {
      mediaKind: 'pptx',
      title: null,
      lang: null,
      root: node({ role: 'document', name: null, locator: { path: 'Presentation' }, props: {} }),
      unknowns: [
        { topic: 'structure-tree', reason: 'No slide parts were found in the presentation.' },
      ],
      producer: 'accessly-pptx-adapter/1',
    };
  }

  if (archive.truncated) {
    unknowns.push({
      topic: 'archive-truncated',
      reason: 'The archive expands beyond Accessly\u2019s size limits, so some parts were not read.',
    });
  }

  const slides: AccessibleNode[] = [];
  for (const path of slidePaths) {
    const xml = archive.text(path);
    const parsed = xml ? parseXml(xml) : null;
    const index = slideNumber(path);

    if (!parsed) {
      unknowns.push({
        topic: 'structure-tree',
        reason: `Slide ${index} could not be parsed and was not audited.`,
      });
      continue;
    }

    slides.push(parseSlide(parsed, index).slide);
  }

  const { title, lang: coreLang } = readCoreProperties(archive);

  // PowerPoint records the language per run of text; the first one is a fair
  // proxy for the deck, and disagreement between runs is a 3.1.2 question we
  // do not currently pursue.
  let lang = coreLang;
  if (!lang) {
    for (const path of slidePaths) {
      const xml = archive.text(path);
      const parsed = xml ? parseXml(xml) : null;
      if (!parsed) continue;
      const found = findAll(parsed, 'rPr')
        .map((run) => attr(run, 'lang'))
        .find((value): value is string => value !== null && value.trim().length > 0);
      if (found) {
        lang = found;
        break;
      }
    }
  }

  unknowns.push({
    topic: 'reading-order',
    reason:
      'Shapes are read in the order they appear in the file, which is the order they were added rather than where they sit on the slide. Accessly cannot see the layout, so it cannot confirm the two agree.',
  });

  return {
    mediaKind: 'pptx',
    title,
    lang,
    root: node({
      role: 'document',
      name: title,
      ...(lang ? { lang } : {}),
      locator: { path: 'Presentation' },
      props: { source: 'pptx', slideCount: slides.length },
      children: slides,
    }),
    unknowns,
    producer: 'accessly-pptx-adapter/1',
  };
}
