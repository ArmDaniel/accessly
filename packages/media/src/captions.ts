import { node, type AccessibleNode, type AccessibleTree, type TreeUnknown } from '@accessly/core';

/**
 * Caption file adapter (WebVTT and SubRip).
 *
 * Captions are the one place where "the file exists" is routinely mistaken for
 * "the requirement is met". A caption track that runs at 400 words per minute,
 * or that never identifies who is speaking, technically exists and is still
 * unusable. Those are measurable properties of the file, so they are worth
 * checking rather than waving through.
 *
 * What we measure:
 *  - **Reading rate.** Broadcast practice puts comfortable reading at roughly
 *    160–180 wpm; the BBC guidelines cap at 180. Above that a viewer cannot
 *    read the caption and watch the picture.
 *  - **Cue duration.** Under about a second is unreadable no matter how short.
 *  - **Overlaps and ordering.** Cues that overlap render on top of each other.
 *  - **Speaker identification.** Multi-speaker content without speaker labels
 *    is ambiguous to anyone relying on the captions.
 *  - **Empty and placeholder cues.** `[inaudible]` throughout is a transcript
 *    that was never finished.
 */

export interface Cue {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

const TIMESTAMP =
  /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toMs(hours: string | undefined, minutes: string, seconds: string, millis: string): number {
  return (
    Number.parseInt(hours ?? '0', 10) * 3_600_000 +
    Number.parseInt(minutes, 10) * 60_000 +
    Number.parseInt(seconds, 10) * 1000 +
    Number.parseInt(millis.padEnd(3, '0'), 10)
  );
}

export function parseCues(source: string): Cue[] {
  const normalised = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const blocks = normalised.split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    const timingLine = lines.find((line) => TIMESTAMP.test(line));
    if (!timingLine) continue;

    const match = TIMESTAMP.exec(timingLine);
    if (!match) continue;

    const startMs = toMs(match[1], match[2] as string, match[3] as string, match[4] as string);
    const endMs = toMs(match[5], match[6] as string, match[7] as string, match[8] as string);

    const textLines = lines.slice(lines.indexOf(timingLine) + 1);

    cues.push({
      index: cues.length + 1,
      startMs,
      endMs,
      // Strip WebVTT inline markup so word counts reflect spoken words.
      text: textLines.join(' ').replace(/<[^>]+>/g, '').trim(),
    });
  }

  return cues;
}

export function wordsIn(text: string): number {
  // Speaker labels are not spoken words and must not inflate the rate — a cue
  // is not harder to read because the speaker is named.
  const spoken = text
    .replace(/^\s*(?:>>|[-–])?\s*[A-Z][A-Z\s.'-]{1,24}:/gm, '')
    .replace(/<v[^>]*>/g, '');
  return spoken.split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word)).length;
}

/** Words per minute for a cue. Zero-length cues report Infinity. */
export function readingRate(cue: Cue): number {
  const seconds = (cue.endMs - cue.startMs) / 1000;
  if (seconds <= 0) return Number.POSITIVE_INFINITY;
  return (wordsIn(cue.text) / seconds) * 60;
}

const PLACEHOLDER_CUE = /^\s*[[(]?\s*(inaudible|unintelligible|indistinct|no audio|silence|\.{3}|…)\s*[\])]?\s*$/i;

/** A speaker label: `>> NAME:`, `NAME:`, or a WebVTT `<v Name>` voice span. */
const SPEAKER_LABEL = /(^|\n)\s*(>>|-)?\s*[A-Z][A-Za-z\s.'-]{1,24}:|<v[\s.]/;

export function parseCaptions(source: string, filename?: string | null): AccessibleTree {
  const unknowns: TreeUnknown[] = [];
  const cues = parseCues(source);
  const isWebVtt = /^﻿?WEBVTT/.test(source);

  if (cues.length === 0) {
    return {
      mediaKind: 'captions',
      title: filename ?? null,
      lang: null,
      root: node({ role: 'document', name: filename ?? null, locator: { path: 'Caption file' }, props: {} }),
      unknowns: [
        {
          topic: 'structure-tree',
          reason: 'No cues could be read from this file, so it may be empty or in an unrecognised format.',
        },
      ],
      producer: 'accessly-captions-adapter/1',
    };
  }

  const hasSpeakerLabels = cues.some((cue) => SPEAKER_LABEL.test(cue.text));
  const totalWords = cues.reduce((sum, cue) => sum + wordsIn(cue.text), 0);

  /*
   * We cannot hear the audio, so we cannot know whether it has one speaker or
   * six. A long caption file with no labels at all is a strong signal, but it
   * stays a `cantTell` because a single-narrator recording legitimately has
   * none.
   */
  if (!hasSpeakerLabels && cues.length > 20) {
    unknowns.push({
      topic: 'speakers',
      reason: `None of the ${cues.length} cues identify a speaker. If more than one person speaks, viewers relying on captions cannot tell who is talking.`,
    });
  }

  // WebVTT carries no language of its own; it is declared by the <track> that
  // references it, which we cannot see from the file alone.
  unknowns.push({
    topic: 'language',
    reason: 'Caption files do not declare their own language — it comes from the track element that references them.',
  });

  const children: AccessibleNode[] = cues.map((cue) => {
    const rate = readingRate(cue);
    const durationMs = cue.endMs - cue.startMs;

    return node({
      role: 'cue',
      name: null,
      text: cue.text,
      locator: {
        path: `Cue ${cue.index} (${formatTime(cue.startMs)})`,
        page: cue.index,
        snippet: cue.text.slice(0, 80),
      },
      props: {
        startMs: cue.startMs,
        endMs: cue.endMs,
        durationMs,
        words: wordsIn(cue.text),
        readingRate: Number.isFinite(rate) ? Math.round(rate) : -1,
        placeholder: PLACEHOLDER_CUE.test(cue.text),
        empty: cue.text.trim().length === 0,
        source: 'captions',
      },
    });
  });

  const track = node({
    role: 'track',
    name: filename ?? null,
    locator: { path: 'Caption track' },
    props: {
      kind: 'captions',
      format: isWebVtt ? 'webvtt' : 'subrip',
      cues: cues.length,
      words: totalWords,
      hasSpeakerLabels,
      durationMs: (cues[cues.length - 1]?.endMs ?? 0) - (cues[0]?.startMs ?? 0),
    },
    children,
  });

  return {
    mediaKind: 'captions',
    title: filename ?? null,
    lang: null,
    root: node({
      role: 'document',
      name: filename ?? null,
      locator: { path: 'Caption file' },
      props: { source: 'captions' },
      children: [track],
    }),
    unknowns,
    producer: 'accessly-captions-adapter/1',
  };
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
