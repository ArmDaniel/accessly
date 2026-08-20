import { unzipSync, strFromU8, type UnzipFileInfo } from 'fflate';

/**
 * ZIP access for the container formats.
 *
 * DOCX, PPTX, XLSX and EPUB are all ZIP archives of XML. `fflate` is the one
 * dependency this package carries: it is small, has no dependencies of its own,
 * and its synchronous API keeps the adapters pure functions of their input,
 * which is what lets the engine stay free of I/O.
 *
 * Security note: this is untrusted-upload-facing code, and fflate does not
 * protect against zip bombs on its own. Every open is therefore budgeted —
 * a per-entry and a total uncompressed cap, checked against the *declared*
 * sizes in the central directory before a single byte is inflated, plus an
 * entry-count cap. Entries over budget are skipped rather than decompressed;
 * the archive reports `truncated` so the adapter can record an `unknown`
 * instead of quietly pretending the part was absent.
 */

export interface Archive {
  /** Every entry name in the archive, whether or not it was decompressed. */
  readonly names: readonly string[];
  /** True when entries were skipped because the budget was exhausted. */
  readonly truncated: boolean;
  /**
   * UTF-8 text of an entry, or null when the entry is absent *or was skipped
   * by the budget*. Callers treat both as "could not be read" and record an
   * unknown - never as "the file has no such part".
   */
  text(path: string): string | null;
  /** Does the archive contain an entry with this name? */
  has(path: string): boolean;
  /** Entries whose path matches a predicate, in archive order. */
  match(predicate: (path: string) => boolean): readonly string[];
}

export class ArchiveError extends Error {}

export interface ArchiveLimits {
  /**
   * Only decompress entries accepted by this predicate (names are still
   * collected for every entry). Adapters use it to skip the media/ trees a
   * real Office file embeds, which is most of the bytes in a real deck.
   */
  readonly include?: (name: string) => boolean;
  /** Per-entry uncompressed cap. Defaults to 20 MB. */
  readonly maxEntryBytes?: number;
  /** Total uncompressed cap across decompressed entries. Defaults to 100 MB. */
  readonly maxTotalBytes?: number;
  /** Cap on the number of entries enumerated. Defaults to 5000. */
  readonly maxEntries?: number;
}

const DEFAULT_MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 5000;

export function openArchive(bytes: Uint8Array, limits: ArchiveLimits = {}): Archive {
  const maxEntryBytes = limits.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const names: string[] = [];
  const include = limits.include ?? (() => true);
  let budget = maxTotalBytes;
  let truncated = false;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      // The filter sees every entry's central-directory record - including its
      // declared uncompressed size - before fflate inflates anything. Rejecting
      // here is what makes the budget real: a bomb is never decompressed, only
      // counted. (fflate allocates the output buffer at the declared size and
      // errors if the stream overflows it, so a lying header cannot exceed its
      // own declaration.)
      filter: (file: UnzipFileInfo) => {
        names.push(file.name);
        if (names.length > maxEntries) {
          truncated = true;
          return false;
        }
        if (!include(file.name)) return false;
        if (file.originalSize > maxEntryBytes || file.originalSize > budget) {
          truncated = true;
          return false;
        }
        budget -= file.originalSize;
        return true;
      },
    });
  } catch (error) {
    throw new ArchiveError(
      `The file could not be opened as a ZIP archive: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const nameSet = new Set(names);

  return {
    names,
    truncated,
    has: (path) => nameSet.has(path),
    text(path) {
      const entry = entries[path];
      if (!entry) return null;
      try {
        return strFromU8(entry);
      } catch {
        // A binary entry read as text is a caller error, not a corrupt file.
        return null;
      }
    },
    match(predicate) {
      return names.filter(predicate);
    },
  };
}

/** True when the bytes begin with the ZIP local-file-header signature. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
