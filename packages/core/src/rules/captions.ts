import type { NodeRule, Rule, TreeIssue, TreeRule } from '../engine/types.js';
import { findByRole } from '../tree/node.js';
import { PASS, SKIP } from './define.js';

/**
 * Caption quality rules.
 *
 * WCAG 1.2.2 says captions are "provided". It does not say they must be
 * *usable*, because a criterion cannot easily quantify that — but a caption
 * track running at 400 words per minute satisfies the letter of 1.2.2 and
 * fails every viewer who depends on it.
 *
 * So these rules measure the properties that decide whether a caption file
 * works: reading rate, cue duration, overlap, and whether the transcript was
 * actually finished. Rates come from broadcast subtitling practice — the BBC's
 * guidelines put comfortable reading at up to 160–180 words per minute — which
 * is stated in the messages so a customer can see where the threshold comes
 * from rather than being handed a number.
 */

const nodeRule = (rule: Omit<NodeRule, 'kind'>): NodeRule => ({ ...rule, kind: 'node' });
const treeRule = (rule: Omit<TreeRule, 'kind'>): TreeRule => ({ ...rule, kind: 'tree' });

/** Comfortable adult reading speed for on-screen text, words per minute. */
const COMFORTABLE_WPM = 180;
/** Above this, a viewer cannot read the caption and watch the picture. */
const EXCESSIVE_WPM = 240;
/** Minimum time a cue must remain on screen to be readable at all. */
const MIN_CUE_MS = 800;

const cueReadingRate = nodeRule({
  id: 'caption-reading-rate',
  title: 'Captions can be read in the time they are shown',
  help: 'A caption that flashes past faster than anyone can read it is present but useless — the viewer is watching text disappear instead of watching the programme.',
  criteria: ['1.2.2'],
  impact: 'serious',
  media: ['captions'],
  role: 'cue',
  filter: (cue) => (cue.props.words as number) > 2,
  evaluate: (cue) => {
    const rate = cue.props.readingRate as number;
    if (rate < 0) {
      return {
        outcome: 'failed',
        message: 'This cue has no duration — its start and end times are the same, so it never appears.',
        remediation: 'Give the cue an end time at least 0.8 seconds after its start.',
      };
    }

    if (rate <= COMFORTABLE_WPM) return PASS;

    if (rate > EXCESSIVE_WPM) {
      return {
        outcome: 'failed',
        message: `This cue runs at about ${rate} words per minute, well beyond the ~180 wpm that broadcast subtitling treats as comfortable reading.`,
        remediation:
          'Split the cue across more of the timeline, or edit the text down. Condensing what is said is standard subtitling practice and is preferable to text nobody can read.',
      };
    }

    return {
      outcome: 'cantTell',
      message: `This cue runs at about ${rate} words per minute, above the ~180 wpm comfortable reading rate but not extreme.`,
      remediation: 'Consider splitting it. Whether it reads comfortably depends on the vocabulary and on the picture underneath.',
      impact: 'minor',
    };
  },
});

const cueDuration = nodeRule({
  id: 'caption-cue-duration',
  title: 'Captions stay on screen long enough to read',
  help: 'Below about eight tenths of a second, a caption registers as a flicker rather than as text.',
  criteria: ['1.2.2'],
  impact: 'moderate',
  media: ['captions'],
  role: 'cue',
  filter: (cue) => (cue.props.empty as boolean) !== true,
  evaluate: (cue) => {
    const duration = cue.props.durationMs as number;
    if (duration >= MIN_CUE_MS) return PASS;

    return {
      outcome: 'failed',
      message: `This cue is on screen for only ${duration} ms, below the ${MIN_CUE_MS} ms minimum for readable text.`,
      remediation: 'Extend the cue, or merge it with the one beside it.',
    };
  },
});

const cueContent = nodeRule({
  id: 'caption-cue-content',
  title: 'Captions are not empty or placeholder text',
  help: '"[inaudible]" scattered through a track is an unfinished transcript, and an empty cue is a gap where speech was.',
  criteria: ['1.2.2'],
  impact: 'serious',
  media: ['captions'],
  role: 'cue',
  evaluate: (cue) => {
    if (cue.props.empty === true) {
      return {
        outcome: 'failed',
        message: 'This cue has a timing but no text.',
        remediation: 'Add the caption text, or remove the empty cue.',
      };
    }

    if (cue.props.placeholder === true) {
      return {
        outcome: 'failed',
        message: `This cue is a placeholder ("${(cue.text ?? '').trim()}") rather than a transcription.`,
        remediation:
          'Transcribe the audio. If a passage is genuinely inaudible, say so specifically rather than leaving a marker — and check whether the source audio can be improved.',
        impact: 'moderate',
      };
    }

    return PASS;
  },
});

const cueOverlap = treeRule({
  id: 'caption-cue-overlap',
  title: 'Caption cues do not overlap',
  help: 'Two cues on screen at once render over each other, and neither can be read.',
  criteria: ['1.2.2'],
  impact: 'serious',
  media: ['captions'],
  evaluate: (context) => {
    const cues = findByRole(context.tree.root, 'cue');
    const issues: TreeIssue[] = [];

    for (let index = 1; index < cues.length; index += 1) {
      const previous = cues[index - 1];
      const current = cues[index];
      if (!previous || !current) continue;

      const previousEnd = previous.props.endMs as number;
      const currentStart = current.props.startMs as number;

      if (currentStart < previousEnd) {
        issues.push({
          node: current,
          outcome: 'failed',
          message: `This cue starts before the previous one ends, so both are on screen together for ${previousEnd - currentStart} ms.`,
          remediation: 'Adjust the timings so cues do not overlap.',
        });
      }
    }

    return { elementsTested: cues.length, issues };
  },
});

const trackHasSpeakers = treeRule({
  id: 'caption-speaker-identification',
  title: 'Captions identify who is speaking',
  help: 'With more than one speaker, captions that never say who is talking leave the viewer guessing at the whole conversation.',
  criteria: ['1.2.2'],
  impact: 'moderate',
  media: ['captions'],
  detection: 'advisory',
  evaluate: (context) => {
    const tracks = findByRole(context.tree.root, 'track');
    const track = tracks[0];
    if (!track) return { elementsTested: 0, issues: [] };

    if (track.props.hasSpeakerLabels === true) return { elementsTested: 1, issues: [] };
    if ((track.props.cues as number) <= 20) return { elementsTested: 1, issues: [] };

    return {
      elementsTested: 1,
      issues: [
        {
          node: track,
          outcome: 'cantTell',
          message: `None of the ${track.props.cues} cues identify a speaker. Accessly cannot hear the audio, so it cannot tell whether more than one person speaks.`,
          remediation:
            'If there are multiple speakers, label them — ">> ANNA:" or a WebVTT <v Anna> voice span. If it is a single narrator, no labels are needed.',
        },
      ],
    };
  },
});

const trackIsSynchronised = treeRule({
  id: 'caption-track-coverage',
  title: 'Captions cover the whole programme',
  help: 'A track that stops halfway leaves the rest of the content uncaptioned, which is the same as having no captions for that part.',
  criteria: ['1.2.2'],
  impact: 'serious',
  media: ['captions'],
  detection: 'advisory',
  evaluate: (context) => {
    const cues = findByRole(context.tree.root, 'cue');
    if (cues.length < 2) return { elementsTested: cues.length, issues: [] };

    const issues: TreeIssue[] = [];

    /*
     * A long silent gap is not necessarily a defect — programmes have music and
     * pauses. But a gap of more than a minute in the middle of a track is worth
     * a human look, because it is equally likely to be the point where the
     * captioner stopped.
     */
    for (let index = 1; index < cues.length; index += 1) {
      const previous = cues[index - 1];
      const current = cues[index];
      if (!previous || !current) continue;

      const gapMs = (current.props.startMs as number) - (previous.props.endMs as number);
      if (gapMs > 60_000) {
        issues.push({
          node: current,
          outcome: 'cantTell',
          message: `There is a ${Math.round(gapMs / 1000)} second gap with no captions before this cue.`,
          remediation:
            'Check whether that stretch is genuinely silent. If anything is said, or there is meaningful sound, it needs captioning.',
          impact: 'minor',
        });
      }
    }

    return { elementsTested: cues.length, issues };
  },
});

export const captionRules: readonly Rule[] = [
  cueReadingRate,
  cueDuration,
  cueContent,
  cueOverlap,
  trackHasSpeakers,
  trackIsSynchronised,
];

export { SKIP };
