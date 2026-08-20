import { node, type AccessibleNode, type AccessibleTree, type TreeUnknown } from '@accessly/core';

/**
 * PDF adapter — structural, not a full renderer.
 *
 * This deliberately does not extract text or lay out pages. It answers the
 * questions that actually decide whether a PDF is accessible, all of which live
 * in the file's structure rather than its content:
 *
 *  - Is it **tagged**? An untagged PDF is a picture of a document. Nothing else
 *    matters until this is fixed, and it is the single most common failure.
 *  - Does it declare a **language** (`/Lang`)?
 *  - Does it have a **title** (`/Title` in the info dictionary or XMP), and is
 *    the viewer told to display it (`/DisplayDocTitle`)?
 *  - Are there **figures** in the structure tree, and do they carry `/Alt`?
 *
 * Those are the PDF/UA gates a procurement reviewer checks first, and they are
 * all reachable without a rendering engine.
 *
 * **The honesty constraint.** Modern PDFs put their cross-reference table and
 * often their whole object graph inside compressed streams. When that happens
 * this parser cannot see the catalogue, and it says so — an `unknown` on the
 * tree, which the rules turn into `cantTell`. It never reports "untagged"
 * merely because it could not find the tag. For an untagged PDF the difference
 * between "no structure tree" and "I could not read the structure tree" is the
 * difference between a true finding and a libel.
 */

const DECODER = new TextDecoder('latin1');

interface PdfFacts {
  readonly tagged: boolean | null;
  readonly lang: string | null;
  readonly title: string | null;
  readonly displayDocTitle: boolean | null;
  readonly pageCount: number | null;
  readonly figures: readonly { alt: string | null; page: number | null }[];
  readonly hasObjectStreams: boolean;
  readonly encrypted: boolean;
}

/** Decode a PDF string literal: `(text)` with escapes, or `<hex>`. */
function decodePdfString(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const hex = trimmed.slice(1, -1).replace(/\s+/g, '');
    // Cap before decoding: a multi-megabyte hex payload spread into
    // fromCharCode would overflow the call stack, and no legitimate PDF
    // metadata string is remotely this long.
    const capped = hex.length > 8192 ? hex.slice(0, 8192) : hex;
    const bytes: number[] = [];
    for (let i = 0; i + 1 < capped.length; i += 2) {
      bytes.push(Number.parseInt(capped.slice(i, i + 2), 16));
    }
    // UTF-16BE with a byte-order mark is how Acrobat writes non-ASCII titles.
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < bytes.length; i += 2) {
        out += String.fromCharCode(((bytes[i] as number) << 8) | (bytes[i + 1] as number));
      }
      return out;
    }
    // Chunked, not spread: `String.fromCharCode(...bytes)` dies at a few tens
    // of thousands of arguments.
    let out = '';
    for (let i = 0; i < bytes.length; i += 4096) {
      out += String.fromCharCode(...(bytes.slice(i, i + 4096) as number[]));
    }
    return out;
  }

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\([nrtbf()\\])/g, (_, char: string) => {
        const map: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          '(': '(',
          ')': ')',
          '\\': '\\',
        };
        return map[char] ?? char;
      })
      .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));
  }

  return trimmed;
}

function extractFacts(source: string): PdfFacts {
  const encrypted = /\/Encrypt\s+\d+\s+\d+\s+R/.test(source);
  const hasObjectStreams = /\/Type\s*\/ObjStm/.test(source) || /\/XRefStm/.test(source);

  /*
   * A tagged PDF has /MarkInfo << /Marked true >> and a /StructTreeRoot in the
   * catalogue. Either alone is a strong signal; both is definitive. Neither,
   * in a file whose objects we *can* read, means untagged.
   */
  const marked = /\/Marked\s+true/.test(source);
  const structTreeRoot = /\/StructTreeRoot\s+\d+\s+\d+\s+R/.test(source);
  const tagged = marked || structTreeRoot ? true : hasObjectStreams || encrypted ? null : false;

  const langMatch = /\/Lang\s*(\([^)]*\)|<[0-9A-Fa-f\s]*>)/.exec(source);
  const lang = langMatch ? decodePdfString(langMatch[1] as string).trim() : null;

  const titleMatch = /\/Title\s*(\([^)]*\)|<[0-9A-Fa-f\s]*>)/.exec(source);
  let title = titleMatch ? decodePdfString(titleMatch[1] as string).trim() : null;

  // XMP metadata carries the title too, and survives when the info dictionary
  // has been stripped.
  if (!title) {
    const xmp = /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(source);
    if (xmp) title = (xmp[1] as string).trim();
  }

  const displayMatch = /\/DisplayDocTitle\s+(true|false)/.exec(source);
  const displayDocTitle = displayMatch ? displayMatch[1] === 'true' : null;

  const pageMatches = source.match(/\/Type\s*\/Page[^s]/g);
  const countMatch = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(source);
  const pageCount = countMatch
    ? Number.parseInt(countMatch[1] as string, 10)
    : pageMatches
      ? pageMatches.length
      : null;

  /*
   * Figures in the structure tree: `/S /Figure` marks the element, and `/Alt`
   * on the same dictionary is its text alternative. Scanning for the pair is
   * enough to tell a described figure from an undescribed one without
   * reconstructing the whole tree.
   */
  const figures: { alt: string | null; page: number | null }[] = [];
  const figurePattern = /\/S\s*\/Figure([\s\S]{0,400}?)(?:endobj|>>\s*>>)/g;
  let figureMatch: RegExpExecArray | null;
  while ((figureMatch = figurePattern.exec(source)) !== null) {
    const body = figureMatch[1] as string;
    const alt = /\/Alt\s*(\([^)]*\)|<[0-9A-Fa-f\s]*>)/.exec(body);
    figures.push({
      alt: alt ? decodePdfString(alt[1] as string).trim() : null,
      page: null,
    });
  }

  return {
    tagged,
    lang: lang && lang.length > 0 ? lang : null,
    title: title && title.length > 0 ? title : null,
    displayDocTitle,
    pageCount,
    figures,
    hasObjectStreams,
    encrypted,
  };
}

export function parsePdf(bytes: Uint8Array): AccessibleTree {
  const source = DECODER.decode(bytes);
  const unknowns: TreeUnknown[] = [];

  if (!source.startsWith('%PDF-')) {
    return {
      mediaKind: 'pdf',
      title: null,
      lang: null,
      root: node({ role: 'document', name: null, locator: { path: 'Document' }, props: {} }),
      unknowns: [{ topic: 'structure-tree', reason: 'The file is not a PDF.' }],
      producer: 'accessly-pdf-adapter/1',
    };
  }

  const facts = extractFacts(source);

  if (facts.encrypted) {
    unknowns.push({
      topic: 'structure-tree',
      reason:
        'The PDF is encrypted, so its structure could not be read. Supply an unencrypted copy, or check it in Acrobat’s accessibility checker.',
    });
  } else if (facts.hasObjectStreams && facts.tagged === null) {
    unknowns.push({
      topic: 'structure-tree',
      reason:
        'This PDF stores its objects in compressed streams, which Accessly does not decompress. Whether it carries a structure tree could not be determined from the file alone.',
    });
  }

  if (!facts.lang && facts.tagged === null) {
    unknowns.push({
      topic: 'language',
      reason: 'The document catalogue could not be read, so a declared language may be present but hidden.',
    });
  }

  if (facts.tagged !== false) {
    unknowns.push({
      topic: 'reading-order',
      reason:
        'Reading order in a PDF is the order of the tag tree, which Accessly does not reconstruct. It can differ from the visual order without any visible sign.',
    });
  }

  /*
   * Page nodes exist so the report can name where a finding lives; their
   * content is not read either way. The cap keeps a pathological "PDF" from
   * allocating a node per claimed page — and when it bites, we say so, the
   * same as every other gap.
   */
  const MAX_PAGE_NODES = 500;
  const pageCount = facts.pageCount ?? 0;
  if (pageCount > MAX_PAGE_NODES) {
    unknowns.push({
      topic: 'page-count',
      reason: `The file declares ${pageCount} pages; only the first ${MAX_PAGE_NODES} were listed in the report.`,
    });
  }

  const pages: AccessibleNode[] = Array.from(
    { length: Math.min(pageCount, MAX_PAGE_NODES) },
    (_, index) =>
      node({
        role: 'page',
        name: null,
        locator: { path: `Page ${index + 1}`, page: index + 1 },
        props: { source: 'pdf' },
      }),
  );

  const figures: AccessibleNode[] = facts.figures.map((figure, index) =>
    node({
      role: 'image',
      name: figure.alt,
      locator: { path: `Figure ${index + 1}`, ...(figure.page ? { page: figure.page } : {}) },
      props: { source: 'pdf', decorative: false },
    }),
  );

  return {
    mediaKind: 'pdf',
    title: facts.title,
    lang: facts.lang,
    root: node({
      role: 'document',
      name: facts.title,
      ...(facts.lang ? { lang: facts.lang } : {}),
      locator: { path: 'Document' },
      props: {
        source: 'pdf',
        tagged: facts.tagged,
        displayDocTitle: facts.displayDocTitle,
        pageCount: facts.pageCount,
      },
      children: [...pages, ...figures],
    }),
    unknowns,
    producer: 'accessly-pdf-adapter/1',
  };
}
