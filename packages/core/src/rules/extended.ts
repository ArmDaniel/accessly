import { visibleText } from '../dom/accname.js';
import { isVisible, tagOf } from '../dom/aria.js';
import { scriptText, styleText } from '../dom/collect.js';
import { safeBody } from '../dom/parse.js';
import type { DocumentIssue, Rule } from '../engine/types.js';
import { documentRule, elementRule, PASS, SKIP } from './define.js';

/**
 * Rules closing the remaining level A and AA gaps.
 *
 * Several of these are deliberately `advisory`: they raise a question the
 * markup cannot answer. Keyboard traps, pointer gestures and flashing content
 * are properties of a *running* page, not of its source, and a static analyser
 * that claims otherwise is guessing. Marking them advisory means they appear as
 * review prompts and are excluded from both coverage and the score — see
 * `RuleDetection` in engine/types.ts.
 */

const visible = isVisible;

// ── 1.3.2 Meaningful Sequence ────────────────────────────────────────────────

const meaningfulSequence = documentRule({
  id: 'meaningful-sequence',
  title: 'Visual order matches document order',
  help: 'CSS that reorders content makes a sighted user and a screen reader user read the page in different orders, and the keyboard tab sequence follows the DOM, not the screen.',
  criteria: ['1.3.2'],
  impact: 'serious',
  techniques: ['C27', 'F1'],
  evaluate: (context) => {
    const issues: DocumentIssue[] = [];
    const css = styleText(context.document);

    // `order` and the reverse flex/grid directions detach visual order from
    // DOM order. That is exactly the failure 1.3.2 describes.
    //
    // The lookbehind (not `(?:^|;)`) matters: anchoring on `;` alone misses
    // `order` as the *first* declaration in a block, and anchoring on nothing
    // at all would match `border` — the lookbehind rejects a preceding word
    // character, which is exactly the distinction.
    const reorderingRules = [
      ...css.matchAll(/([^{}]+)\{[^}]*(?:flex-direction\s*:\s*\w+-reverse|(?<![\w-])order\s*:\s*-?[1-9])/g),
    ];

    for (const match of reorderingRules.slice(0, 10)) {
      issues.push({
        element: null,
        outcome: 'failed',
        message: `The rule "${(match[1] ?? '').trim().slice(0, 60)}" reorders content visually, so the reading order on screen no longer matches the document order.`,
        remediation:
          'Reorder the elements in the HTML instead. Keyboard focus follows the DOM, so visual reordering leaves the tab sequence jumping around the screen.',
      });
    }

    const inlineReordered = Array.from(context.document.querySelectorAll('[style]')).filter(
      (element) =>
        /(?<![\w-])order\s*:\s*-?[1-9]|flex-direction\s*:\s*\w+-reverse/.test(
          (element.getAttribute('style') ?? '').toLowerCase(),
        ),
    );

    for (const element of inlineReordered) {
      issues.push({
        element,
        outcome: 'failed',
        message: 'This element is moved out of document order by CSS, so its visual position does not match where it falls in the reading and tab order.',
        remediation: 'Move the element in the HTML rather than repositioning it with order or a reversed flex direction.',
      });
    }

    return { elementsTested: 1, issues };
  },
});

// ── 1.3.3 Sensory Characteristics ────────────────────────────────────────────

/**
 * Instructions that depend on seeing the page.
 *
 * "Click the green button on the right" is useless to someone who cannot see
 * colour, shape or position. The pattern is narrow on purpose: it needs both an
 * instruction verb and a purely sensory referent, so ordinary prose that merely
 * mentions a colour does not trip it.
 */
/*
 * Both patterns require an action verb *and* a control noun *and* a purely
 * sensory qualifier. All three are necessary to avoid the obvious false
 * positive: "use the form below" is a perfectly ordinary sentence, and a rule
 * that flags it trains people to ignore this check entirely.
 */
const CONTROL_NOUN = '(?:button|link|icon|tab|checkbox|control|menu item)';

const SENSORY_INSTRUCTION = new RegExp(
  `\\b(?:click|select|choose|press|tap|activate)\\b[^.!?]{0,30}\\b${CONTROL_NOUN}\\b[^.!?]{0,20}\\b(?:on the (?:right|left)|to the (?:right|left)|at the (?:top|bottom)|in the (?:top|bottom)(?: |-)(?:right|left))\\b`,
  'i',
);

const SHAPE_INSTRUCTION = new RegExp(
  `\\b(?:click|select|choose|press|tap|activate)\\b[^.!?]{0,20}\\b(?:round|square|circular|rectangular|triangular)\\s+${CONTROL_NOUN}\\b`,
  'i',
);

const COLOUR_ONLY_INSTRUCTION = new RegExp(
  `\\b(?:click|select|choose|press|tap|activate)\\b[^.!?]{0,20}\\b(?:red|green|blue|yellow|orange|purple)\\s+${CONTROL_NOUN}\\b`,
  'i',
);

const sensoryCharacteristics = elementRule({
  id: 'sensory-characteristics',
  title: 'Instructions do not rely on shape, colour or position alone',
  help: '"Press the green button on the right" tells a screen reader user nothing, and tells a colour-blind user very little.',
  criteria: ['1.3.3'],
  impact: 'moderate',
  techniques: ['G96', 'F14', 'F26'],
  selector: 'p, li, label, legend, td, th, dd, figcaption',
  filter: visible,
  evaluate: (element) => {
    const text = visibleText(element);
    if (text.length === 0 || text.length > 400) return SKIP;

    const positional = SENSORY_INSTRUCTION.test(text) || SHAPE_INSTRUCTION.test(text);
    const colourOnly = COLOUR_ONLY_INSTRUCTION.test(text);
    if (!positional && !colourOnly) return PASS;

    return {
      outcome: 'failed',
      message: colourOnly
        ? 'This instruction identifies a control by its colour, which is not available to everyone reading the page.'
        : 'This instruction identifies a control by its position or shape, which is meaningless to a screen reader user and changes at different window sizes.',
      remediation:
        'Name the control as well: "select Save (the green button on the right)". The sensory description can stay — it just cannot be the only way to identify the target.',
    };
  },
});

// ── 1.3.4 Orientation ────────────────────────────────────────────────────────

const orientationLock = documentRule({
  id: 'orientation-not-locked',
  title: 'Content is not locked to one orientation',
  help: 'A user with a wheelchair-mounted device cannot rotate their screen. Locking to landscape or portrait makes the page unusable for them.',
  criteria: ['1.3.4'],
  impact: 'serious',
  evaluate: (context) => {
    const css = styleText(context.document);
    const issues: DocumentIssue[] = [];

    // Rotating the whole page inside an orientation media query is the classic
    // "please turn your device" implementation.
    if (/@media[^{]*orientation\s*:\s*(portrait|landscape)[^{]*\{[^}]*transform\s*:\s*[^;}]*rotate/i.test(css)) {
      issues.push({
        element: null,
        outcome: 'failed',
        message: 'A media query rotates the content when the device orientation changes, which forces a single orientation on the user.',
        remediation:
          'Let the layout reflow in both orientations instead of rotating it. Only lock orientation where it is essential, such as a piano keyboard.',
      });
    }

    const lockScript = scriptText(context.document);

    if (/screen\.orientation\.lock\s*\(|lockOrientation\s*\(/.test(lockScript)) {
      issues.push({
        element: null,
        outcome: 'failed',
        message: 'This page calls the Screen Orientation lock API, preventing the user from viewing it in their preferred orientation.',
        remediation: 'Remove the orientation lock unless a specific orientation is essential to the activity.',
      });
    }

    return { elementsTested: 1, issues };
  },
});

// ── 1.4.12 Text Spacing ──────────────────────────────────────────────────────

const textSpacing = documentRule({
  id: 'text-spacing-overridable',
  title: 'Users can override text spacing',
  help: 'People with dyslexia often increase line and letter spacing to read at all. Spacing declared with !important cannot be overridden by their stylesheet.',
  criteria: ['1.4.12'],
  impact: 'serious',
  techniques: ['C36', 'C35'],
  evaluate: (context) => {
    const css = styleText(context.document);
    const issues: DocumentIssue[] = [];

    const locked = [
      ...css.matchAll(/([^{}]+)\{[^}]*(line-height|letter-spacing|word-spacing)\s*:[^;}]*!important/gi),
    ];

    for (const match of locked.slice(0, 10)) {
      issues.push({
        element: null,
        outcome: 'failed',
        message: `"${(match[1] ?? '').trim().slice(0, 60)}" sets ${match[2]} with !important, so a user stylesheet cannot increase it.`,
        remediation:
          'Remove !important from text spacing declarations. A user who needs wider spacing must be able to apply it without the page fighting back.',
      });
    }

    // A fixed pixel height on a text container clips the text the moment the
    // user increases line height.
    const fixedHeight = Array.from(context.document.querySelectorAll('[style]')).filter((element) => {
      const style = (element.getAttribute('style') ?? '').toLowerCase();
      if (!/(?:^|;)\s*height\s*:\s*\d+px/.test(style)) return false;
      if (/overflow\s*:\s*(auto|scroll|visible)/.test(style)) return false;
      return visible(element) && visibleText(element).length > 0;
    });

    for (const element of fixedHeight.slice(0, 10)) {
      issues.push({
        element,
        outcome: 'failed',
        message: 'This element contains text but has a fixed pixel height, so the text is clipped as soon as the user increases line or letter spacing.',
        remediation: 'Use min-height instead of height, so the container grows with its content.',
        impact: 'moderate',
      });
    }

    return { elementsTested: 1, issues };
  },
});

// ── 1.4.13 Content on Hover or Focus ─────────────────────────────────────────

const hoverContent = elementRule({
  id: 'hover-content-dismissable',
  title: 'Content shown on hover can be dismissed and reached',
  help: 'A tooltip that disappears when you move towards it is unusable with a screen magnifier, and one that cannot be dismissed obscures whatever is underneath.',
  criteria: ['1.4.13'],
  impact: 'moderate',
  detection: 'advisory',
  selector: '[title]',
  filter: (element) => {
    if (!visible(element)) return false;
    // A title on a form control or link is a naming problem, handled elsewhere.
    return !['input', 'select', 'textarea', 'a', 'button', 'iframe'].includes(tagOf(element));
  },
  evaluate: () => ({
    outcome: 'cantTell',
    message:
      'This element uses a title attribute, which browsers show as a hover tooltip that cannot be dismissed with Escape, cannot be hovered over, and never appears for keyboard or touch users.',
    remediation:
      'Replace the title with visible text, or with a tooltip you control that stays visible while the pointer moves onto it and closes on Escape.',
    impact: 'minor',
  }),
});

// ── 2.1.2 No Keyboard Trap ───────────────────────────────────────────────────

const keyboardTrap = documentRule({
  id: 'keyboard-trap-risk',
  title: 'Keyboard focus can always leave a component',
  help: 'A component that traps focus leaves a keyboard user stuck, with no way out except reloading the page.',
  criteria: ['2.1.2'],
  impact: 'critical',
  detection: 'advisory',
  techniques: ['G21', 'F10'],
  evaluate: (context) => {
    const candidates = Array.from(
      context.document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]'),
    ).filter(visible);

    const embedded = Array.from(context.document.querySelectorAll('iframe, object, embed'));

    const issues: DocumentIssue[] = [];

    for (const element of candidates) {
      issues.push({
        element,
        outcome: 'cantTell',
        message:
          'This is a modal component. Whether focus is correctly trapped inside it while open, and released when it closes, can only be established by operating it with a keyboard.',
        remediation:
          'Check by hand: Tab must cycle within the dialog, Escape must close it, and focus must return to whatever opened it. Mark the rest of the page inert while it is open.',
        impact: 'moderate',
      });
    }

    for (const element of embedded.slice(0, 5)) {
      issues.push({
        element,
        outcome: 'cantTell',
        message: `Focus moves into this <${tagOf(element)}>, and whether it can move back out depends on content Accessly cannot see.`,
        remediation: 'Tab into the embedded content and confirm you can Tab back out of it without using the mouse.',
        impact: 'minor',
      });
    }

    return { elementsTested: candidates.length + embedded.length, issues };
  },
});

// ── 2.1.4 Character Key Shortcuts ────────────────────────────────────────────

const characterKeyShortcuts = documentRule({
  id: 'character-key-shortcuts',
  title: 'Single-character shortcuts can be turned off or remapped',
  help: 'A speech-input user dictating text will trigger every single-letter shortcut on the page by accident.',
  criteria: ['2.1.4'],
  impact: 'moderate',
  detection: 'advisory',
  evaluate: (context) => {
    const inlineScript = scriptText(context.document);

    const handlers = Array.from(context.document.querySelectorAll('[onkeydown], [onkeypress], [onkeyup]'));

    // A handler that compares event.key against a single printable character
    // and does not check a modifier is the shape 2.1.4 is about.
    const looksLikeSingleKey =
      /\.key\s*===?\s*['"][a-z0-9]['"]/i.test(inlineScript) ||
      /keyCode\s*===?\s*(?:3[2-6]|4[0-9]|5[0-7]|6[5-9]|[78]\d|9[7-9]|1[012]\d)/.test(inlineScript);
    const checksModifier = /(ctrlKey|altKey|metaKey|shiftKey)/.test(inlineScript);

    if (!looksLikeSingleKey && handlers.length === 0) {
      return { elementsTested: 0, issues: [] };
    }

    return {
      elementsTested: handlers.length + (looksLikeSingleKey ? 1 : 0),
      issues: [
        {
          element: null,
          outcome: 'cantTell',
          message: looksLikeSingleKey && !checksModifier
            ? 'This page appears to bind single-character keyboard shortcuts without requiring a modifier key.'
            : 'This page handles keyboard events directly. If any shortcut is a single character with no modifier, it must be switchable or remappable.',
          remediation:
            'Require a modifier key, let the user turn shortcuts off, or only activate them while the relevant control has focus.',
          impact: 'minor',
        },
      ],
    };
  },
});

// ── 2.3.1 Three Flashes or Below Threshold ───────────────────────────────────

const flashingContent = documentRule({
  id: 'flashing-content',
  title: 'Nothing flashes more than three times a second',
  help: 'Flashing above three times per second can trigger a seizure. This is the one accessibility failure that can put someone in hospital.',
  criteria: ['2.3.1'],
  impact: 'critical',
  detection: 'advisory',
  evaluate: (context) => {
    const css = styleText(context.document);
    const issues: DocumentIssue[] = [];

    // An infinite animation faster than ~3Hz on a visual property is the
    // pattern worth a human look. Whether it actually flashes depends on the
    // keyframes' contrast, which we cannot evaluate.
    for (const match of [...css.matchAll(/animation[^;}]*?(\d*\.?\d+)m?s[^;}]*infinite/gi)].slice(0, 5)) {
      const raw = match[1] ?? '';
      const isMilliseconds = /\dms/.test(match[0]);
      const seconds = isMilliseconds ? Number.parseFloat(raw) / 1000 : Number.parseFloat(raw);
      if (!Number.isFinite(seconds) || seconds > 0.333) continue;

      issues.push({
        element: null,
        outcome: 'cantTell',
        message: `An infinite animation repeats every ${seconds}s, which is faster than three times per second. If it changes brightness or colour substantially, it is a seizure risk.`,
        remediation:
          'Slow the animation below three cycles per second, or reduce the contrast between its states. Honour prefers-reduced-motion either way.',
      });
    }

    return { elementsTested: 1, issues };
  },
});

// ── 2.4.5 Multiple Ways ──────────────────────────────────────────────────────

const multipleWays = documentRule({
  id: 'multiple-ways',
  title: 'There is more than one way to reach a page',
  help: 'Some people navigate by search, others by browsing. Offering only one route excludes whichever group does not think the way the designer does.',
  criteria: ['2.4.5'],
  impact: 'moderate',
  detection: 'advisory',
  techniques: ['G125', 'G161'],
  evaluate: (context) => {
    const doc = context.document;
    if (!safeBody(doc)) return { elementsTested: 0, issues: [] };

    const hasSearch =
      doc.querySelector('[role="search"], search, input[type="search"]') !== null;
    const hasSitemap = Array.from(doc.querySelectorAll('a[href]')).some((link) =>
      /sitemap|site map|a-z|index/i.test(`${link.textContent ?? ''} ${link.getAttribute('href') ?? ''}`),
    );
    const navCount = doc.querySelectorAll('nav, [role="navigation"]').length;

    const ways = [hasSearch, hasSitemap, navCount > 0].filter(Boolean).length;
    if (ways >= 2) return { elementsTested: 1, issues: [] };

    return {
      elementsTested: 1,
      issues: [
        {
          element: null,
          outcome: 'cantTell',
          message: `This page offers ${ways === 0 ? 'no' : 'only one'} way of locating other pages. 2.4.5 is a site-wide requirement, so it cannot be settled from a single page.`,
          remediation:
            'Provide at least two of: site search, a sitemap, or a navigation menu — unless this page is a step in a process, which is exempt.',
          impact: 'minor',
        },
      ],
    };
  },
});

// ── 2.5.4 Motion Actuation ───────────────────────────────────────────────────

const motionActuation = documentRule({
  id: 'motion-actuation',
  title: 'Motion-triggered actions have a conventional alternative',
  help: 'Shake-to-undo is unusable for someone whose device is mounted to a wheelchair, and can be triggered accidentally by anyone with a tremor.',
  criteria: ['2.5.4'],
  impact: 'moderate',
  detection: 'advisory',
  evaluate: (context) => {
    const scripts = scriptText(context.document);

    const usesMotion =
      /devicemotion|deviceorientation|DeviceMotionEvent|DeviceOrientationEvent/i.test(scripts) ||
      context.document.querySelector('[ondevicemotion], [ondeviceorientation]') !== null;

    if (!usesMotion) return { elementsTested: 0, issues: [] };

    return {
      elementsTested: 1,
      issues: [
        {
          element: null,
          outcome: 'cantTell',
          message: 'This page responds to device motion or orientation. Any action triggered that way must also be available through a normal control, and must be possible to switch off.',
          remediation:
            'Add a button that performs the same action, and a setting to disable motion actuation. Motion-only interaction is exempt only where the motion is essential.',
        },
      ],
    };
  },
});

// ── 2.5.1 Pointer Gestures ───────────────────────────────────────────────────

const pointerGestures = documentRule({
  id: 'pointer-gestures',
  title: 'Multipoint and path-based gestures have a simple alternative',
  help: 'Pinch, swipe and drag are impossible for someone using a head pointer, a switch, or one finger. Every such gesture needs a single-tap equivalent.',
  criteria: ['2.5.1'],
  impact: 'serious',
  detection: 'advisory',
  evaluate: (context) => {
    const scripts = scriptText(context.document);

    const markup = context.document.querySelectorAll(
      '[ontouchmove], [onpointermove], [draggable="true"], [ongesturestart], [ongesturechange]',
    );

    // A path-based gesture is implemented by tracking movement between a down
    // and an up event; a multipoint one by reading `touches.length`.
    const tracksMovement =
      /touchmove|pointermove|gesturestart|gesturechange|\.touches\s*\[|touches\.length/i.test(scripts);
    const usesDragApi = /dragstart|dragend|\bondrop\b/i.test(scripts);

    if (markup.length === 0 && !tracksMovement && !usesDragApi) {
      return { elementsTested: 0, issues: [] };
    }

    const issues: DocumentIssue[] = [
      {
        element: markup[0] ?? null,
        outcome: 'cantTell',
        message:
          'This page tracks pointer movement or drag operations, which suggests a swipe, drag or pinch gesture. Whether a single-pointer alternative exists cannot be determined from the markup.',
        remediation:
          'Provide a way to do the same thing with a single tap or click — arrow buttons beside a carousel, a numeric input beside a slider, a menu command beside a drag handle. The gesture can stay; it just cannot be the only route.',
      },
    ];

    return { elementsTested: markup.length + 1, issues };
  },
});

// ── 1.2.4 Captions (Live) ────────────────────────────────────────────────────

const liveCaptions = elementRule({
  id: 'live-captions',
  title: 'Live media has real-time captions',
  help: 'A live stream without captions excludes deaf and hard-of-hearing viewers from the event entirely.',
  criteria: ['1.2.4'],
  impact: 'serious',
  detection: 'advisory',
  selector: 'video',
  filter: (element) => visible(element),
  evaluate: (element) => {
    const hasCaptions = Array.from(element.querySelectorAll('track')).some(
      (track) => (track.getAttribute('kind') ?? '').toLowerCase() === 'captions',
    );
    if (hasCaptions) return SKIP;

    return {
      outcome: 'cantTell',
      message: 'If this video is a live stream, level AA requires real-time captions, which cannot be detected from the markup.',
      remediation: 'Arrange live captioning for streamed content. Note that automatic speech recognition alone is generally not accurate enough to meet this.',
      impact: 'minor',
    };
  },
});

// ── AAA additions that are cheap and genuinely decidable ─────────────────────

const abbreviationsExpanded = elementRule({
  id: 'abbreviation-expanded',
  title: 'Abbreviations are expanded',
  help: 'A screen reader may spell out or mispronounce an abbreviation, and a reader unfamiliar with the term has nothing to go on.',
  criteria: ['3.1.4'],
  impact: 'minor',
  techniques: ['H28'],
  selector: 'abbr, acronym',
  filter: visible,
  evaluate: (element) => {
    const title = (element.getAttribute('title') ?? '').trim();
    if (title.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: `The abbreviation "${visibleText(element).slice(0, 30)}" has no expansion.`,
      remediation: 'Add a title attribute containing the full form, or expand it in the surrounding text the first time it appears.',
    };
  },
});

const sectionHeadings = documentRule({
  id: 'section-headings',
  title: 'Long content is broken up by headings',
  help: 'Headings are how a screen reader user skims. A wall of text with no headings has to be read start to finish.',
  criteria: ['2.4.10'],
  impact: 'minor',
  evaluate: (context) => {
    const main = context.document.querySelector('main, [role="main"]');
    if (!main) return { elementsTested: 0, issues: [] };

    const paragraphs = Array.from(main.querySelectorAll('p')).filter(
      (p) => visible(p) && visibleText(p).length > 80,
    );
    if (paragraphs.length < 6) return { elementsTested: 1, issues: [] };

    const headings = main.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"]').length;
    if (headings >= Math.floor(paragraphs.length / 6)) return { elementsTested: 1, issues: [] };

    return {
      elementsTested: 1,
      issues: [
        {
          element: null,
          outcome: 'failed',
          message: `This page has ${paragraphs.length} substantial paragraphs but only ${headings} heading(s) to break them up.`,
          remediation: 'Add headings that describe each section, so the content can be skimmed and navigated rather than only read straight through.',
        },
      ],
    };
  },
});

const visualPresentation = documentRule({
  id: 'visual-presentation-line-height',
  title: 'Body text has comfortable line spacing',
  help: 'Line spacing below 1.5 makes it easy to lose your place, which is hardest on readers with dyslexia or low vision.',
  criteria: ['1.4.8'],
  impact: 'minor',
  evaluate: (context) => {
    const css = styleText(context.document);
    const issues: DocumentIssue[] = [];

    for (const match of [...css.matchAll(/([^{}]*\b(?:body|p|main|article)\b[^{}]*)\{[^}]*line-height\s*:\s*([\d.]+)\s*[;}]/gi)].slice(0, 5)) {
      const value = Number.parseFloat(match[2] ?? '0');
      if (!Number.isFinite(value) || value >= 1.5) continue;
      issues.push({
        element: null,
        outcome: 'failed',
        message: `Body text in "${(match[1] ?? '').trim().slice(0, 40)}" has a line height of ${value}, below the 1.5 that level AAA requires.`,
        remediation: 'Raise the line height to at least 1.5 for blocks of text.',
      });
    }

    return { elementsTested: 1, issues };
  },
});

export const extendedRules: readonly Rule[] = [
  meaningfulSequence,
  sensoryCharacteristics,
  orientationLock,
  textSpacing,
  hoverContent,
  keyboardTrap,
  characterKeyShortcuts,
  flashingContent,
  multipleWays,
  motionActuation,
  pointerGestures,
  liveCaptions,
  abbreviationsExpanded,
  sectionHeadings,
  visualPresentation,
];
