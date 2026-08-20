import type { MediaKind } from '@accessly/contracts';
import {
  hashBytes,
  parseDocument,
  treeFromDocument,
  type AccessibleTree,
} from '@accessly/core';
import { detectMediaKind, type DetectionResult } from './detect.js';
import { parseDocx } from './office/docx.js';
import { parsePptx } from './office/pptx.js';
import { parseXlsx } from './office/xlsx.js';
import { parseEpub } from './epub.js';
import { parsePdf } from './pdf.js';
import { parseCaptions } from './captions.js';
import { node } from '@accessly/core';

/**
 * The adapter registry.
 *
 * One entry point: bytes in, accessibility tree out. Everything downstream —
 * the rules, the scoring, the report, the watcher's diff — is already
 * format-neutral, so adding a format means adding an adapter here and nothing
 * else.
 */

export class UnsupportedMediaError extends Error {
  constructor(
    message: string,
    readonly detection: DetectionResult,
  ) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

export interface ParseOptions {
  readonly filename?: string | null;
  /** Override detection. Used when the caller already knows the format. */
  readonly kind?: MediaKind;
}

export interface ParsedMedia {
  readonly tree: AccessibleTree;
  readonly kind: MediaKind;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly detection: DetectionResult;
}

const TEXT = new TextDecoder('utf-8');

export function parseMedia(bytes: Uint8Array, options: ParseOptions = {}): ParsedMedia {
  const detection = options.kind
    ? { kind: options.kind, reason: 'The format was supplied by the caller.' }
    : detectMediaKind(bytes, options.filename);

  if (!detection.kind) {
    throw new UnsupportedMediaError(
      'Accessly cannot read that file type.',
      detection,
    );
  }

  const tree = buildTree(detection.kind, bytes, options.filename ?? null);

  return {
    tree,
    kind: detection.kind,
    contentHash: hashBytes(bytes),
    byteLength: bytes.byteLength,
    detection,
  };
}

function buildTree(kind: MediaKind, bytes: Uint8Array, filename: string | null): AccessibleTree {
  switch (kind) {
    case 'html':
      return treeFromDocument(parseDocument(TEXT.decode(bytes)).document);
    case 'docx':
      return parseDocx(bytes);
    case 'pptx':
      return parsePptx(bytes);
    case 'xlsx':
      return parseXlsx(bytes);
    case 'epub':
      return parseEpub(bytes);
    case 'pdf':
      return parsePdf(bytes);
    case 'captions':
      return parseCaptions(TEXT.decode(bytes), filename);
    case 'video':
    case 'audio':
      return mediaShell(kind, filename);
  }
}

/**
 * A stand-in tree for a raw media file.
 *
 * We do not decode video or audio containers, and pretending otherwise would be
 * the sort of guess this product exists to avoid. What we can say is that a
 * media file was submitted and that its accompanying tracks are the thing that
 * needs checking — so the tree records exactly that, and the rules turn it into
 * a review prompt rather than a verdict.
 */
function mediaShell(kind: 'video' | 'audio', filename: string | null): AccessibleTree {
  return {
    mediaKind: kind,
    title: filename,
    lang: null,
    root: node({
      role: 'document',
      name: filename,
      locator: { path: filename ?? 'Media file' },
      props: { source: kind },
      children: [
        node({
          role: kind === 'video' ? 'video' : 'audio',
          name: filename,
          locator: { path: filename ?? 'Media file' },
          props: { tracksUnknown: true, source: kind },
        }),
      ],
    }),
    unknowns: [
      {
        topic: 'media-tracks',
        reason:
          'Accessly does not decode media containers. Submit the caption or description track alongside the file, or audit the page that embeds it.',
      },
    ],
    producer: `accessly-${kind}-adapter/1`,
  };
}

export { detectMediaKind, type DetectionResult } from './detect.js';
export { parseDocx } from './office/docx.js';
export { parsePptx } from './office/pptx.js';
export { parseXlsx } from './office/xlsx.js';
export { parseEpub } from './epub.js';
export { parsePdf } from './pdf.js';
export { parseCaptions, parseCues, readingRate, wordsIn, type Cue } from './captions.js';
export { openArchive, looksLikeZip, ArchiveError, type Archive } from './zip.js';
export { parseXml, findAll, findFirst, attr, allText, type XmlNode } from './xml.js';
