import type { MediaKind } from '@accessly/contracts';
import { looksLikeZip, openArchive } from './zip.js';

/**
 * Work out what a file actually is.
 *
 * Extensions lie — a `.docx` that is really a `.doc`, a `.pdf` that is a
 * scanned image with a text layer bolted on. Sniffing the content first and
 * using the filename only as a tiebreaker means the report names the format we
 * genuinely parsed, which matters when the verdict is "this is not a tagged
 * PDF" and the customer insists it is.
 */

export interface DetectionResult {
  readonly kind: MediaKind | null;
  /** Why we concluded this — surfaced in the report's methodology section. */
  readonly reason: string;
}

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

function head(bytes: Uint8Array, length = 512): string {
  return TEXT_DECODER.decode(bytes.subarray(0, Math.min(length, bytes.length)));
}

function extensionOf(filename: string | null | undefined): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export function detectMediaKind(
  bytes: Uint8Array,
  filename?: string | null,
): DetectionResult {
  const extension = extensionOf(filename);

  if (bytes.length === 0) {
    return { kind: null, reason: 'The file is empty.' };
  }

  // PDF: %PDF- magic.
  if (head(bytes, 8).startsWith('%PDF-')) {
    return { kind: 'pdf', reason: 'The file begins with the %PDF- signature.' };
  }

  if (looksLikeZip(bytes)) {
    // Every OOXML and EPUB container is a ZIP; the entry names identify which.
    // Detection decompresses nothing but the tiny `mimetype` marker entry —
    // names come from the central directory — so even a bomb costs a scan, not
    // an inflation.
    try {
      const archive = openArchive(bytes, { include: (name) => name === 'mimetype' });

      if (archive.has('mimetype') && (archive.text('mimetype') ?? '').includes('epub')) {
        return { kind: 'epub', reason: 'The archive declares the EPUB mimetype.' };
      }
      if (archive.match((p) => p.startsWith('word/')).length > 0) {
        return { kind: 'docx', reason: 'The archive contains a word/ part.' };
      }
      if (archive.match((p) => p.startsWith('ppt/')).length > 0) {
        return { kind: 'pptx', reason: 'The archive contains a ppt/ part.' };
      }
      if (archive.match((p) => p.startsWith('xl/')).length > 0) {
        return { kind: 'xlsx', reason: 'The archive contains an xl/ part.' };
      }
      if (archive.match((p) => p.endsWith('.opf')).length > 0) {
        return { kind: 'epub', reason: 'The archive contains an OPF package document.' };
      }

      return {
        kind: null,
        reason: 'The file is a ZIP archive, but not one of the document formats Accessly reads.',
      };
    } catch {
      return { kind: null, reason: 'The file looks like a ZIP archive but could not be opened.' };
    }
  }

  const text = head(bytes, 2048);

  // WebVTT declares itself; SRT is recognised by its cue numbering and the
  // arrow between timestamps.
  if (/^﻿?WEBVTT/.test(text)) {
    return { kind: 'captions', reason: 'The file begins with the WEBVTT signature.' };
  }
  if (/^﻿?\d+\s*\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) {
    return { kind: 'captions', reason: 'The file uses SubRip cue formatting.' };
  }

  if (/<!doctype\s+html|<html[\s>]/i.test(text)) {
    return { kind: 'html', reason: 'The file contains an HTML document element.' };
  }

  // Container sniffing for media is out of scope; the extension is all we have,
  // and we say so rather than implying we inspected the stream.
  if (['.mp4', '.webm', '.mov'].includes(extension)) {
    return { kind: 'video', reason: `Identified from the ${extension} extension; the container was not inspected.` };
  }
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(extension)) {
    return { kind: 'audio', reason: `Identified from the ${extension} extension; the container was not inspected.` };
  }
  if (['.vtt', '.srt'].includes(extension)) {
    return { kind: 'captions', reason: `Identified from the ${extension} extension.` };
  }

  return {
    kind: null,
    reason: extension
      ? `Accessly does not recognise ${extension} files.`
      : 'The file format could not be identified from its contents.',
  };
}
