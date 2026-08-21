import type { MediaKind } from '@accessly/contracts';
import type { NodeRule, Rule, TreeIssue, TreeRule } from '../engine/types.js';
import {
  findByRole,
  parentOf,
  textContent,
  unknownAbout,
  walk,
  type AccessibleNode,
} from '../tree/node.js';
import { PASS, SKIP } from './define.js';

/**
 * Format-neutral structural rules.
 *
 * These run against the accessibility tree, so the same rule audits a web page,
 * a Word document, a slide deck, a PDF and an EPUB. That is the whole point of
 * the tree: "this image has no alt text" is the same defect and the same
 * criterion regardless of which application produced the file, and writing it
 * five times would guarantee five subtly different verdicts.
 *
 * Where a format genuinely differs, the rule says so in its message rather than
 * forking — "slide" versus "page" is wording, not logic.
 */

const nodeRule = (rule: Omit<NodeRule, 'kind'>): NodeRule => ({ ...rule, kind: 'node' });
const treeRule = (rule: Omit<TreeRule, 'kind'>): TreeRule => ({ ...rule, kind: 'tree' });

/**
 * Every format that carries authored document structure.
 *
 * HTML is deliberately absent. The DOM rules already decide these criteria for
 * pages, and a tree rule that also ran there would report the same defect twice
 * under two rule ids — one failure wearing two hats, which inflates the counts
 * and gives the watcher two "new issues" for one regression.
 */
const DOCUMENT_FORMATS: readonly MediaKind[] = ['pdf', 'docx', 'pptx', 'xlsx', 'epub'];

/** Formats where a "page" is really a slide, so the wording should follow. */
function unitNoun(kind: MediaKind): string {
  if (kind === 'pptx') return 'slide';
  if (kind === 'xlsx') return 'sheet';
  if (kind === 'pdf') return 'page';
  return 'document';
}

/** Alt text that names the file rather than describing the content. */
const PLACEHOLDER_NAME =
  /^(image|picture|photo|graphic|img|figure|chart|diagram|screenshot|logo|untitled|placeholder)?[\s_-]*\d*$|\.(jpe?g|png|gif|svg|webp|emf|wmf|tiff?)$/i;

// ── 1.1.1 Non-text Content ───────────────────────────────────────────────────

const imageHasName = nodeRule({
  id: 'media-image-alt',
  title: 'Images have a text alternative',
  help: 'An image with no alternative text is announced as nothing at all, so whatever it conveys is simply missing for anyone who cannot see it.',
  criteria: ['1.1.1'],
  impact: 'critical',
  media: DOCUMENT_FORMATS,
  role: 'image',
  filter: (candidate) => candidate.props.decorative !== true,
  // HTML is excluded by DOCUMENT_FORMATS: it has its own, more precise rule,
  // which can tell alt="" from a missing attribute — the difference between
  // "deliberately decorative" and "forgotten".
  evaluate: (candidate) => {
    const name = candidate.name?.trim() ?? '';

    if (name.length === 0) {
      return {
        outcome: 'failed',
        message: `This image has no alternative text, so its content is unavailable to anyone using a screen reader.`,
        remediation:
          'Add alternative text describing what the image conveys in context. If it is purely decorative, mark it as such in the authoring tool so it is skipped rather than announced.',
      };
    }

    if (PLACEHOLDER_NAME.test(name)) {
      return {
        outcome: 'failed',
        message: `The alternative text "${name}" names the file or its type rather than describing the image.`,
        remediation: 'Replace it with a description of what the image shows, in the context of the surrounding text.',
        impact: 'serious',
      };
    }

    // A description that is only a few characters is very unlikely to convey
    // what an image shows, but it is not impossible ("€5", "Fig. 2").
    if (name.length < 4) {
      return {
        outcome: 'cantTell',
        message: `The alternative text "${name}" is very short. Check that it conveys everything the image does.`,
        remediation: 'If the image carries meaning, describe it. If it does not, mark it decorative.',
        impact: 'minor',
      };
    }

    return PASS;
  },
});

// ── 1.3.1 Info and Relationships ─────────────────────────────────────────────

/**
 * Tagging is the gate every other PDF check stands behind.
 *
 * An untagged PDF has no structure at all: no headings, no reading order, no
 * table relationships, no alternative text. A screen reader is left guessing at
 * glyph positions, which is why PDF/UA treats this as the first requirement and
 * why it must never be absent from a report. The adapter records `tagged` as
 * `null` rather than `false` when compression or encryption hid the catalogue,
 * and that distinction is carried through here — "untagged" and "we could not
 * look" are different verdicts.
 */
const pdfIsTagged = nodeRule({
  id: 'media-pdf-tagged',
  title: 'The PDF is tagged',
  help: 'An untagged PDF is a picture of a document. Assistive technology has no headings, no reading order and no table structure to work with, so nothing else about the file can be fixed until this is.',
  criteria: ['1.3.1'],
  impact: 'critical',
  media: ['pdf'],
  role: 'document',
  evaluate: (candidate) => {
    const tagged = candidate.props.tagged;

    if (tagged === true) return PASS;

    if (tagged === false) {
      return {
        outcome: 'failed',
        message:
          'This PDF is not tagged. It carries no structure tree, so a screen reader cannot identify headings, reading order, tables or images anywhere in the document.',
        remediation:
          'Re-export it from the source document with tagging enabled — "Create PDF/A" or "Document structure tags for accessibility" in Word, "Best for electronic distribution and accessibility" in the Acrobat plugin. Tagging an existing PDF by hand in Acrobat is possible but far slower than re-exporting.',
      };
    }

    return {
      outcome: 'cantTell',
      message:
        'Whether this PDF is tagged could not be determined — its catalogue is inside a compressed or encrypted stream that Accessly does not open.',
      remediation:
        'Check it with Acrobat’s accessibility checker, or supply an uncompressed copy. Do not assume it is tagged: this is the first thing to confirm.',
    };
  },
});

const headingsAreRealHeadings = treeRule({
  id: 'media-has-headings',
  title: 'Long documents use real headings',
  help: 'Headings are how a screen reader user skims. Text that merely looks like a heading — bigger, bold — is just a paragraph to assistive technology.',
  criteria: ['1.3.1', '2.4.10'],
  impact: 'serious',
  media: ['pdf', 'docx', 'pptx', 'epub'],
  evaluate: (context) => {
    const paragraphs = findByRole(context.tree.root, 'paragraph').filter(
      (p) => (p.text ?? '').length > 60,
    );
    if (paragraphs.length < 8) return { elementsTested: 1, issues: [] };

    const headings = findByRole(context.tree.root, 'heading');
    if (headings.length > 0) return { elementsTested: 1, issues: [] };

    const unknown = unknownAbout(context.tree, 'structure-tree');
    if (unknown) {
      return {
        elementsTested: 1,
        issues: [
          {
            node: null,
            outcome: 'cantTell',
            message: `This ${unitNoun(context.mediaKind)} has substantial text but its structure could not be read. ${unknown.reason}`,
            remediation: 'Confirm in the authoring tool that headings use real heading styles rather than manual formatting.',
          },
        ],
      };
    }

    return {
      elementsTested: 1,
      issues: [
        {
          node: null,
          outcome: 'failed',
          message: `This ${unitNoun(context.mediaKind)} has ${paragraphs.length} substantial paragraphs and no headings at all, so it cannot be navigated or skimmed.`,
          remediation:
            'Apply real heading styles in the authoring tool. Making text bold and large does not create a heading — it only looks like one.',
        },
      ],
    };
  },
});

const headingOrder = treeRule({
  id: 'media-heading-order',
  title: 'Heading levels are not skipped',
  help: 'Heading levels form an outline. Jumping from level 1 to level 3 implies a section that is not there.',
  criteria: ['1.3.1'],
  impact: 'moderate',
  media: DOCUMENT_FORMATS,
  evaluate: (context) => {
    const headings = findByRole(context.tree.root, 'heading').filter(
      (heading) => heading.level !== undefined,
    );

    const issues: TreeIssue[] = [];
    let previous = 0;

    for (const heading of headings) {
      const level = heading.level as number;
      if (previous > 0 && level > previous + 1) {
        issues.push({
          node: heading,
          outcome: 'failed',
          message: `This is a level ${level} heading but the previous one was level ${previous}, so ${level - previous - 1} level(s) are skipped.`,
          remediation: `Change it to level ${previous + 1}, or add the intermediate heading the outline implies.`,
        });
      }
      previous = level;
    }

    return { elementsTested: headings.length, issues };
  },
});

const tableHasHeaders = nodeRule({
  id: 'media-table-headers',
  title: 'Tables have header cells',
  help: 'Without header cells a screen reader cannot say which column or row a value belongs to, so a table of numbers becomes a list of numbers.',
  criteria: ['1.3.1'],
  impact: 'serious',
  media: ['pdf', 'docx', 'pptx', 'xlsx', 'epub'],
  role: 'table',
  evaluate: (candidate) => {
    const cells = findByRole(candidate, ['cell', 'columnheader', 'rowheader']);
    if (cells.length <= 1) return SKIP;

    const headers = findByRole(candidate, ['columnheader', 'rowheader']);
    if (headers.length > 0) return PASS;

    if (candidate.props.headerRowUnknown === true) {
      return {
        outcome: 'cantTell',
        message: 'No header cells were found, but this format does not always record them explicitly. Confirm the header row is marked as one.',
        remediation: 'In the authoring tool, mark the first row as a header row so it repeats and is announced with each cell.',
        impact: 'moderate',
      };
    }

    return {
      outcome: 'failed',
      message: `This table has ${cells.length} cells but no header cells, so the meaning of each value is lost.`,
      remediation:
        'Mark the header row (and header column, if there is one) as headers in the authoring tool. Bold text in the first row is not a header.',
    };
  },
});

/** A bullet or number typed as text at the start of a paragraph. */
const MANUAL_BULLET = /^\s*([-*•]|\d+[.)])\s+\S/;

const listsAreRealLists = nodeRule({
  id: 'media-list-structure',
  title: 'Lists are marked as lists',
  help: 'A real list is announced as "list, 5 items", which tells the user how much is coming. Dashes typed at the start of paragraphs are not.',
  criteria: ['1.3.1'],
  impact: 'moderate',
  media: ['pdf', 'docx', 'epub'],
  role: 'paragraph',
  /*
   * Only the characters people actually type as bullets. An em or en dash
   * opening a sentence — as this one does — is ordinary typography, and
   * treating it as a manual bullet reported a confirmed failure for correct
   * prose.
   */
  filter: (candidate) => MANUAL_BULLET.test(candidate.text ?? ''),
  evaluate: (candidate, context) => {
    const parent = parentOf(context.tree.root, candidate);
    if (parent && (parent.role === 'list' || parent.role === 'listitem')) return PASS;

    /*
     * A list has more than one item. One paragraph that happens to open with a
     * dash or a "1." is a sentence; several in the same document is somebody
     * typing a list by hand, which is the defect this rule exists to catch.
     */
    const alsoMatching = findByRole(context.tree.root, 'paragraph').filter((other) =>
      MANUAL_BULLET.test(other.text ?? ''),
    );
    if (alsoMatching.length < 2) return SKIP;

    return {
      outcome: 'failed',
      message: 'This paragraph starts with a bullet or number typed as text, so it looks like a list but is not marked as one.',
      remediation:
        'Use the list tool in the authoring application. Manually typed bullets are announced as ordinary paragraphs, and the reader is never told how many items there are.',
    };
  },
});

// ── 2.4.2 Page Titled ────────────────────────────────────────────────────────

const documentHasTitle = treeRule({
  id: 'media-has-title',
  title: 'The document has a title',
  help: 'The title is what assistive technology announces when the file opens, and what appears in a list of open documents. Without one, the user hears the filename.',
  criteria: ['2.4.2'],
  impact: 'serious',
  media: ['pdf', 'docx', 'pptx', 'xlsx', 'epub'],
  evaluate: (context) => {
    const title = context.tree.title?.trim() ?? '';

    if (title.length === 0) {
      return {
        elementsTested: 1,
        issues: [
          {
            node: null,
            outcome: 'failed',
            message: 'This document has no title in its properties, so it is announced by filename.',
            remediation:
              'Set the document title in the file properties. In Word and PowerPoint this is File → Info → Title; exporters carry it into the PDF.',
          },
        ],
      };
    }

    // A title that is just the filename is the default an exporter leaves
    // behind, and it tells the reader nothing they did not already know.
    if (/\.(docx?|pptx?|xlsx?|pdf|epub)$/i.test(title) || /^(untitled|document|presentation|slide\s*\d*|book)$/i.test(title)) {
      return {
        elementsTested: 1,
        issues: [
          {
            node: null,
            outcome: 'failed',
            message: `The document title "${title}" is a filename or a placeholder rather than a description of the content.`,
            remediation: 'Set a title that describes what the document is about.',
            impact: 'moderate',
          },
        ],
      };
    }

    return { elementsTested: 1, issues: [] };
  },
});

const slidesHaveTitles = nodeRule({
  id: 'media-slide-title',
  title: 'Every slide has a title',
  help: 'Slide titles are the only way to navigate a deck with a screen reader — they are what the slide list is built from.',
  criteria: ['2.4.2', '1.3.1'],
  impact: 'serious',
  media: ['pptx'],
  role: 'slide',
  evaluate: (candidate) => {
    const title = candidate.name?.trim() ?? '';
    if (title.length > 0) return PASS;

    const position = candidate.locator.page ?? '?';
    return {
      outcome: 'failed',
      message: `Slide ${position} has no title, so it cannot be identified when navigating the deck.`,
      remediation:
        'Add a title using the slide layout’s title placeholder. If the title should not be visible, keep the placeholder and move it off the slide area rather than deleting it.',
    };
  },
});

// ── 3.1.1 Language of Page ───────────────────────────────────────────────────

const documentHasLanguage = treeRule({
  id: 'media-has-language',
  title: 'The document declares its language',
  help: 'Without a language, a screen reader reads the text with whatever pronunciation rules it happens to be set to, which can make it incomprehensible.',
  criteria: ['3.1.1'],
  impact: 'serious',
  media: ['pdf', 'docx', 'pptx', 'xlsx', 'epub'],
  evaluate: (context) => {
    const lang = context.tree.lang?.trim() ?? '';

    if (lang.length === 0) {
      const unknown = unknownAbout(context.tree, 'language');
      if (unknown) {
        return {
          elementsTested: 1,
          issues: [
            {
              node: null,
              outcome: 'cantTell',
              message: `The document language could not be determined. ${unknown.reason}`,
              remediation: 'Check that a language is set in the document properties.',
              impact: 'moderate',
            },
          ],
        };
      }

      return {
        elementsTested: 1,
        issues: [
          {
            node: null,
            outcome: 'failed',
            message: 'This document does not declare a language.',
            remediation:
              'Set the document language in the authoring tool. For a PDF this is the /Lang entry, which exporters set from the source document’s language.',
          },
        ],
      };
    }

    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(lang)) {
      return {
        elementsTested: 1,
        issues: [
          {
            node: null,
            outcome: 'failed',
            message: `The declared language "${lang}" is not a valid BCP 47 language tag.`,
            remediation: 'Use a valid tag such as "en", "en-GB" or "ro-RO".',
          },
        ],
      };
    }

    return { elementsTested: 1, issues: [] };
  },
});

// ── 2.4.4 Link Purpose ───────────────────────────────────────────────────────

const NON_DESCRIPTIVE_LINK = new Set([
  'click here',
  'here',
  'read more',
  'more',
  'link',
  'this',
  'this link',
  'download',
  'see more',
  'learn more',
]);

const linkTextIsMeaningful = nodeRule({
  id: 'media-link-text',
  title: 'Link text describes its destination',
  help: 'A bare URL is read out character by character, and "click here" repeated through a document is a list of nothing.',
  criteria: ['2.4.4'],
  impact: 'moderate',
  media: ['pdf', 'docx', 'pptx', 'xlsx', 'epub'],
  role: 'link',
  evaluate: (candidate) => {
    const text = (candidate.name ?? candidate.text ?? '').trim();
    if (text.length === 0) {
      return {
        outcome: 'failed',
        message: 'This link has no text, so its destination cannot be determined.',
        remediation: 'Give the link text that names where it goes.',
      };
    }

    // A raw URL is technically descriptive but is read aloud one character at
    // a time, which is unusable for anything longer than a domain.
    if (/^https?:\/\/\S+$/i.test(text) && text.length > 30) {
      return {
        outcome: 'failed',
        message: 'This link shows its full URL as its text, which a screen reader reads out character by character.',
        remediation: 'Replace the visible text with a description of the destination, keeping the URL as the link target.',
        impact: 'minor',
      };
    }

    if (NON_DESCRIPTIVE_LINK.has(text.toLowerCase().replace(/[^a-z\s]/g, '').trim())) {
      return {
        outcome: 'cantTell',
        message: `The link text "${text}" does not describe its destination when read on its own.`,
        remediation: 'Rewrite it to name the destination. Surrounding context may satisfy 2.4.4, but not 2.4.9 at level AAA.',
        impact: 'minor',
      };
    }

    return PASS;
  },
});

// ── 1.2.x Time-based media ───────────────────────────────────────────────────

const videoHasCaptions = nodeRule({
  id: 'media-video-captions',
  title: 'Video has captions',
  help: 'Video with speech is unusable without captions for deaf and hard-of-hearing viewers.',
  criteria: ['1.2.2'],
  impact: 'critical',
  media: ['pptx', 'epub', 'video'],
  role: 'video',
  evaluate: (candidate) => {
    const tracks = findByRole(candidate, 'track');
    const hasCaptions = tracks.some((track) => track.props.kind === 'captions');
    if (hasCaptions) return PASS;

    if (tracks.length === 0 && candidate.props.tracksUnknown === true) {
      return {
        outcome: 'cantTell',
        message: 'No caption track could be detected for this video. Confirm captions are provided.',
        remediation: 'Attach a caption file, or use a player that carries captions with the video.',
      };
    }

    return {
      outcome: 'failed',
      message: 'This video has no caption track, so its spoken content is unavailable to anyone who cannot hear it.',
      remediation:
        'Add captions. Subtitles are a translation of dialogue and are not a substitute — captions also carry speaker changes and meaningful non-speech sound.',
    };
  },
});

// ── Reading order ────────────────────────────────────────────────────────────

const readingOrderKnown = treeRule({
  id: 'media-reading-order',
  title: 'The document has a determinate reading order',
  help: 'Assistive technology reads in the order the file records, not the order things appear on the page. When those differ, the document is read out scrambled.',
  criteria: ['1.3.2'],
  impact: 'serious',
  media: ['pdf', 'pptx'],
  detection: 'advisory',
  evaluate: (context) => {
    const unknown = unknownAbout(context.tree, 'reading-order');
    const units = findByRole(context.tree.root, ['page', 'slide']);

    if (unknown) {
      return {
        elementsTested: Math.max(units.length, 1),
        issues: [
          {
            node: null,
            outcome: 'cantTell',
            message: `The reading order could not be verified. ${unknown.reason}`,
            remediation:
              context.mediaKind === 'pptx'
                ? 'Check the selection pane on each slide: the reading order is the reverse of the listed order, and it is very easy to get wrong after moving shapes around.'
                : 'Check the tag tree order in a PDF editor against the visual order of the page.',
          },
        ],
      };
    }

    if (units.length === 0) return { elementsTested: 0, issues: [] };

    return {
      elementsTested: units.length,
      issues: [
        {
          node: null,
          outcome: 'cantTell',
          message: `Reading order was recorded for ${units.length} ${unitNoun(context.mediaKind)}(s), but whether it matches the visual order can only be confirmed by a person.`,
          remediation: 'Read the document with a screen reader, or step through the tag tree, and confirm the order makes sense.',
          impact: 'minor',
        },
      ],
    };
  },
});

// ── Text alternatives for charts and embedded objects ────────────────────────

const chartHasDescription = nodeRule({
  id: 'media-chart-description',
  title: 'Charts have a text description',
  help: 'A chart carries its meaning in its shape. Alt text naming it "Chart 1" leaves the reader with nothing but the title.',
  criteria: ['1.1.1'],
  impact: 'serious',
  media: ['docx', 'pptx', 'xlsx', 'epub', 'pdf'],
  role: 'figure',
  filter: (candidate) => candidate.props.chart === true,
  evaluate: (candidate) => {
    const description = (candidate.description ?? '').trim();
    const name = (candidate.name ?? '').trim();

    const remediation =
      'Describe the finding, not the format: "Sales fell 12% between Q1 and Q3, with the sharpest drop in July" rather than "bar chart of sales". Put the data in an adjacent table where you can.';

    if (description.length > 40) return PASS;
    if (name.length > 40) return PASS;

    if (description.length === 0 && name.length === 0) {
      return {
        outcome: 'failed',
        message: 'This chart has no description at all, so everything it shows is unavailable to anyone who cannot see it.',
        remediation,
      };
    }

    /*
     * Length cannot decide adequacy. "Sales fell 12% from Q1 to Q3" is 28
     * characters and says everything the chart does; failing it outright would
     * be reporting a defect we have not established.
     */
    return {
      outcome: 'cantTell',
      message: `The description of this chart ("${description || name}") is short for something that carries its meaning in its shape. Check that it conveys the trend or comparison rather than just naming the chart.`,
      remediation,
      impact: 'moderate',
    };
  },
});

// ── Sensory characteristics, format-neutral ──────────────────────────────────

const colourOnlyMeaning = nodeRule({
  id: 'media-colour-only',
  title: 'Meaning is not carried by colour alone',
  help: 'A key that says "rows in red need attention" is unusable for a colour-blind reader and invisible to a screen reader.',
  criteria: ['1.4.1'],
  impact: 'moderate',
  // It can only ever raise the question, never settle it, so it must not count
  // as coverage of 1.4.1.
  detection: 'advisory',
  media: ['docx', 'pptx', 'xlsx', 'pdf', 'epub'],
  role: ['paragraph', 'cell', 'caption'],
  filter: (candidate) =>
    /\b(shown|marked|indicated|highlighted|shaded|coloured|colored)\s+in\s+(red|green|blue|amber|orange|yellow|purple)\b|\b(red|green|blue|amber|orange|yellow)\s+(rows?|cells?|items?|entries|text|figures?)\b/i.test(
      candidate.text ?? '',
    ),
  /*
   * A phrase match cannot settle this. "The red items in the museum collection"
   * matches the same pattern as "red items need attention", and only one of
   * them is a defect — deciding which needs the document, not the sentence. So
   * this raises the question and leaves the answer to a person, the way every
   * other undecidable check in this file does.
   */
  evaluate: (candidate) => ({
    outcome: 'cantTell',
    message: `This text refers to colour ("${(candidate.text ?? '').trim().slice(0, 80)}"). If colour is the only thing conveying that meaning, it is unavailable to colour-blind readers and to anyone using a screen reader.`,
    remediation:
      'Check whether a second, non-colour cue is present — a symbol, a word in the cell, or a separate status column. If not, add one and refer to that instead.',
  }),
});

export const structureRules: readonly Rule[] = [
  imageHasName,
  pdfIsTagged,
  headingsAreRealHeadings,
  headingOrder,
  tableHasHeaders,
  listsAreRealLists,
  documentHasTitle,
  slidesHaveTitles,
  documentHasLanguage,
  linkTextIsMeaningful,
  videoHasCaptions,
  readingOrderKnown,
  chartHasDescription,
  colourOnlyMeaning,
];

/** Exported for tests that need to reason about the tree directly. */
export { walk, textContent, type AccessibleNode };
