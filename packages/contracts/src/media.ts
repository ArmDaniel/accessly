/**
 * Media formats Accessly can audit.
 *
 * Accessibility obligations do not stop at HTML. The European Accessibility Act
 * covers e-books, and procurement routinely asks for accessible PDFs and decks
 * — which is where most organisations are weakest, because their web team never
 * sees those files.
 *
 * Every kind here maps onto the same format-neutral accessibility tree, so one
 * rule set covers all of them. What differs per format is which rules can
 * *apply*, and that is reported honestly per audit rather than averaged away.
 */
export const MEDIA_KINDS = [
  'html',
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'epub',
  'captions',
  'video',
  'audio',
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Human labels, used in reports and in the UI. */
export const MEDIA_LABELS: Readonly<Record<MediaKind, string>> = {
  html: 'Web page',
  pdf: 'PDF document',
  docx: 'Word document',
  pptx: 'Slide deck',
  xlsx: 'Spreadsheet',
  epub: 'EPUB e-book',
  captions: 'Caption file',
  video: 'Video',
  audio: 'Audio',
};

/**
 * The standard a format is judged against.
 *
 * WCAG 2.1 is written for web content, and applying it to a PDF requires a
 * mapping. PDF/UA (ISO 14289) is that mapping, and EPUB Accessibility 1.1
 * likewise for e-books. Naming the applicable standard in the report is what
 * lets a customer hand it to an auditor without having to explain the
 * translation themselves.
 */
export const MEDIA_STANDARDS: Readonly<Record<MediaKind, readonly string[]>> = {
  html: ['WCAG 2.1', 'EN 301 549 §9'],
  pdf: ['WCAG 2.1', 'PDF/UA (ISO 14289-1)', 'EN 301 549 §10'],
  docx: ['WCAG 2.1', 'EN 301 549 §10'],
  pptx: ['WCAG 2.1', 'EN 301 549 §10'],
  xlsx: ['WCAG 2.1', 'EN 301 549 §10'],
  epub: ['WCAG 2.1', 'EPUB Accessibility 1.1', 'EN 301 549 §10'],
  captions: ['WCAG 2.1', 'EN 301 549 §7'],
  video: ['WCAG 2.1', 'EN 301 549 §7'],
  audio: ['WCAG 2.1', 'EN 301 549 §7'],
};

export function mediaLabel(kind: MediaKind): string {
  return MEDIA_LABELS[kind];
}

/** File extensions we accept for each kind, used by the upload control. */
export const MEDIA_EXTENSIONS: Readonly<Record<MediaKind, readonly string[]>> = {
  html: ['.html', '.htm', '.xhtml'],
  pdf: ['.pdf'],
  docx: ['.docx'],
  pptx: ['.pptx'],
  xlsx: ['.xlsx'],
  epub: ['.epub'],
  captions: ['.vtt', '.srt'],
  video: ['.mp4', '.webm'],
  audio: ['.mp3', '.wav', '.ogg'],
};

/** Every extension we will accept, for an `accept` attribute. */
export const ACCEPTED_EXTENSIONS: readonly string[] = Object.values(MEDIA_EXTENSIONS).flat();
