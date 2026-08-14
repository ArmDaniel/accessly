import { accessibleName, visibleText } from '../dom/accname.js';
import { computeRole, isFocusable, isVisible, tagOf, WIDGET_ROLES } from '../dom/aria.js';
import { safeBody } from '../dom/parse.js';
import type { DocumentIssue, Rule } from '../engine/types.js';
import { documentRule, elementRule, PASS, SKIP } from './define.js';

const visible = isVisible;

/** Link text that tells the user nothing when read out of context. */
const NON_DESCRIPTIVE_LINK_TEXT = new Set([
  'click here',
  'here',
  'read more',
  'more',
  'learn more',
  'details',
  'link',
  'this',
  'this page',
  'continue',
  'go',
  'download',
  'view',
  'see more',
  'more info',
  'more information',
]);

// ── 2.1.1 Keyboard ───────────────────────────────────────────────────────────

const clickableIsKeyboardOperable = elementRule({
  id: 'clickable-keyboard-operable',
  title: 'Click handlers are reachable by keyboard',
  help: 'A div with an onclick works for a mouse and for nobody else. Keyboard and switch users cannot reach it at all.',
  criteria: ['2.1.1', '4.1.2'],
  impact: 'critical',
  techniques: ['F42', 'SCR29'],
  selector: '[onclick]',
  filter: visible,
  evaluate: (element) => {
    const tag = tagOf(element);
    // Native interactive elements are already keyboard operable.
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) {
      if (tag !== 'a' || element.hasAttribute('href')) return PASS;
    }

    const focusable = isFocusable(element);
    const role = computeRole(element);
    const hasWidgetRole = role !== null && WIDGET_ROLES.has(role);
    const hasKeyHandler =
      element.hasAttribute('onkeydown') ||
      element.hasAttribute('onkeyup') ||
      element.hasAttribute('onkeypress');

    if (focusable && hasWidgetRole && hasKeyHandler) return PASS;

    const missing: string[] = [];
    if (!focusable) missing.push('it cannot receive keyboard focus (no tabindex="0")');
    if (!hasWidgetRole) missing.push('it has no interactive role, so it is announced as plain text');
    if (!hasKeyHandler) missing.push('it responds to click but not to Enter or Space');

    return {
      outcome: 'failed',
      message: `This <${tag}> has a click handler but ${missing.join(', and ')}.`,
      remediation:
        'Use a <button> instead. If that is impossible, add tabindex="0", role="button", and a keydown handler for Enter and Space.',
    };
  },
});

const noPositiveTabindex = elementRule({
  id: 'no-positive-tabindex',
  title: 'Tab order follows the document',
  help: 'A positive tabindex jumps the user out of document order and makes the whole page tab sequence unpredictable.',
  criteria: ['2.4.3'],
  impact: 'serious',
  techniques: ['F44'],
  selector: '[tabindex]',
  evaluate: (element) => {
    const value = Number.parseInt(element.getAttribute('tabindex') ?? '', 10);
    if (!Number.isFinite(value) || value <= 0) return PASS;
    return {
      outcome: 'failed',
      message: `This element has tabindex="${value}", which pulls it out of the natural tab order and ahead of everything with tabindex="0".`,
      remediation:
        'Use tabindex="0" and place the element where it belongs in the source order, so the tab sequence matches the visual one.',
    };
  },
});

const focusableNotAriaHidden = elementRule({
  id: 'focusable-not-aria-hidden',
  title: 'Focusable elements are not hidden from assistive technology',
  help: 'An element that is hidden from a screen reader but still focusable becomes a dead stop in the tab order with nothing announced.',
  criteria: ['2.1.1', '4.1.2'],
  impact: 'serious',
  techniques: ['F165'],
  selector: '[aria-hidden="true"]',
  evaluate: (element) => {
    const focusableDescendants = Array.from(
      element.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'),
    ).filter((candidate) => {
      const tabindex = candidate.getAttribute('tabindex');
      if (tabindex !== null) return Number.parseInt(tabindex, 10) >= 0;
      return !candidate.hasAttribute('disabled');
    });

    const selfFocusable = (() => {
      const tabindex = element.getAttribute('tabindex');
      if (tabindex !== null) return Number.parseInt(tabindex, 10) >= 0;
      return ['a', 'button', 'input', 'select', 'textarea'].includes(tagOf(element));
    })();

    if (!selfFocusable && focusableDescendants.length === 0) return PASS;

    const count = focusableDescendants.length + (selfFocusable ? 1 : 0);
    return {
      outcome: 'failed',
      message: `This element is aria-hidden="true" but contains ${count} focusable element(s), which remain in the tab order while being invisible to screen readers.`,
      remediation:
        'Add tabindex="-1" to the focusable descendants, or use the inert attribute / display:none so they leave the tab order too.',
    };
  },
});

// ── 2.2.x Enough time ────────────────────────────────────────────────────────

const noMetaRefresh = documentRule({
  id: 'no-meta-refresh',
  title: 'The page does not refresh or redirect on a timer',
  help: 'A timed refresh can move the page out from under someone who reads slowly or is midway through a form.',
  criteria: ['2.2.1', '2.2.4', '3.2.5'],
  impact: 'serious',
  techniques: ['F40', 'F41'],
  evaluate: (context) => {
    const metas = Array.from(context.document.querySelectorAll('meta[http-equiv]')).filter(
      (meta) => (meta.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh',
    );

    const issues: DocumentIssue[] = [];
    for (const meta of metas) {
      const content = meta.getAttribute('content') ?? '';
      const delay = Number.parseInt(content.split(/[;,]/)[0]?.trim() ?? '', 10);
      // A delay of 0 is an immediate redirect, which WCAG explicitly permits.
      if (delay === 0) continue;
      // Over 20 hours is treated as "effectively never" by the technique.
      if (Number.isFinite(delay) && delay > 72000) continue;

      // A non-numeric delay (`content="url=page.html"`) is malformed but
      // occurs in the wild; report it as a timed refresh without quoting NaN.
      issues.push({
        element: meta,
        outcome: 'failed',
        message: Number.isFinite(delay)
          ? `This page refreshes itself after ${delay} seconds, with no way for the user to turn that off or extend it.`
          : 'This page uses a meta refresh whose delay could not be determined, so the page may move out from under the user at any time.',
        remediation:
          'Remove the meta refresh. If the content must update, do it in place and let the user request the change or adjust the timing.',
      });
    }

    return { elementsTested: metas.length, issues };
  },
});

const noBlinkingContent = elementRule({
  id: 'no-blinking-content',
  title: 'Nothing blinks or scrolls without a pause control',
  help: 'Content that moves for more than five seconds is impossible to read for people with attention or vestibular disorders.',
  criteria: ['2.2.2'],
  impact: 'serious',
  techniques: ['F16', 'F47'],
  selector: 'blink, marquee',
  evaluate: (element) => ({
    outcome: 'failed',
    message: `<${tagOf(element)}> moves or flashes content continuously with no mechanism to pause it.`,
    remediation: 'Remove the element. If the content must move, provide a visible pause control and stop after five seconds by default.',
  }),
});

// ── 2.4.1 Bypass Blocks ──────────────────────────────────────────────────────

const bypassBlocks = documentRule({
  id: 'bypass-blocks',
  title: 'Repeated content can be skipped',
  help: 'Without a skip link or landmarks, a keyboard user tabs through the entire navigation on every single page.',
  criteria: ['2.4.1'],
  impact: 'serious',
  techniques: ['H69', 'G1', 'ARIA11'],
  evaluate: (context) => {
    const doc = context.document;
    if (!safeBody(doc)) return { elementsTested: 0, issues: [] };

    const hasMain = doc.querySelector('main, [role="main"]') !== null;

    const skipLink = Array.from(doc.querySelectorAll('a[href^="#"]'))
      .slice(0, 5)
      .find((link) => {
        const target = (link.getAttribute('href') ?? '').slice(1);
        if (target.length === 0) return false;
        if (!doc.getElementById(target)) return false;
        return /skip|jump/i.test(visibleText(link) || accessibleName(link).value);
      });

    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6').length;

    if (hasMain || skipLink || headings > 0) {
      const issues: DocumentIssue[] = [];
      if (!hasMain) {
        issues.push({
          element: null,
          outcome: 'failed',
          message: 'This page has no <main> landmark, so assistive technology users cannot jump straight to the primary content.',
          remediation: 'Wrap the page\'s primary content in a single <main> element.',
          impact: 'moderate',
        });
      }
      if (!skipLink && doc.querySelector('nav, [role="navigation"]')) {
        issues.push({
          element: null,
          outcome: 'failed',
          message: 'This page has navigation but no "Skip to main content" link, so keyboard users must tab through every nav item to reach the content.',
          remediation:
            'Add a skip link as the first focusable element in the body, pointing at the id of your <main>. It may be visually hidden until focused, but it must become visible on focus.',
          impact: 'moderate',
        });
      }
      return { elementsTested: 1, issues };
    }

    return {
      elementsTested: 1,
      issues: [
        {
          element: null,
          outcome: 'failed',
          message: 'This page provides no way to bypass repeated content — no skip link, no landmarks, and no headings.',
          remediation: 'Add a <main> landmark and a skip link, and structure the content with headings.',
        },
      ],
    };
  },
});

const landmarkUniqueness = documentRule({
  id: 'landmark-uniqueness',
  title: 'Landmarks are unambiguous',
  help: 'Two navigation landmarks with no names leave the user choosing between "navigation" and "navigation".',
  criteria: ['1.3.1', '2.4.1'],
  impact: 'moderate',
  techniques: ['ARIA11'],
  evaluate: (context) => {
    const doc = context.document;
    const issues: DocumentIssue[] = [];

    const mains = Array.from(doc.querySelectorAll('main, [role="main"]')).filter(visible);
    if (mains.length > 1) {
      issues.push({
        element: mains[1] as Element,
        outcome: 'failed',
        message: `This page has ${mains.length} main landmarks. There must be exactly one.`,
        remediation: 'Keep a single <main> and convert the others to <section> or <div>.',
      });
    }

    const navs = Array.from(doc.querySelectorAll('nav, [role="navigation"]')).filter(visible);
    if (navs.length > 1) {
      const unnamed = navs.filter((nav) => accessibleName(nav).value.length === 0);
      if (unnamed.length > 0) {
        issues.push({
          element: unnamed[0] as Element,
          outcome: 'failed',
          message: `This page has ${navs.length} navigation landmarks and ${unnamed.length} of them are unnamed, so they cannot be told apart in a landmarks list.`,
          remediation: 'Give each navigation landmark a distinct aria-label, for example "Main" and "Footer".',
        });
      }
    }

    const banners = Array.from(doc.querySelectorAll('[role="banner"]')).filter(visible);
    const bodyHeaders = Array.from(doc.querySelectorAll('body > header')).filter(visible);
    if (banners.length + bodyHeaders.length > 1) {
      issues.push({
        element: (banners[0] ?? bodyHeaders[0]) as Element,
        outcome: 'failed',
        message: 'This page has more than one banner landmark. There must be at most one.',
        remediation: 'Keep a single page-level <header> and scope the others inside <article> or <section>.',
        impact: 'minor',
      });
    }

    return { elementsTested: mains.length + navs.length + banners.length + bodyHeaders.length, issues };
  },
});

// ── 2.4.2 Page Titled ────────────────────────────────────────────────────────

const pageHasTitle = documentRule({
  id: 'page-has-title',
  title: 'The page has a descriptive title',
  help: 'The title is the first thing a screen reader announces and the label on every browser tab and bookmark.',
  criteria: ['2.4.2'],
  impact: 'serious',
  techniques: ['H25', 'F25'],
  evaluate: (context) => {
    const title = context.parsed.title;

    if (!title) {
      return {
        elementsTested: 1,
        issues: [
          {
            element: null,
            outcome: 'failed',
            message: 'This page has no <title>, so it is announced and bookmarked as an untitled document.',
            remediation: 'Add a <title> in the <head> that describes this specific page, most-specific part first.',
          },
        ],
      };
    }

    if (title.length < 4 || /^(untitled|document|home|page|new page|index)$/i.test(title)) {
      return {
        elementsTested: 1,
        issues: [
          {
            element: null,
            outcome: 'failed',
            message: `The page title "${title}" does not describe the page's purpose.`,
            remediation: 'Write a title that identifies this page and distinguishes it from the rest of the site.',
            impact: 'moderate',
          },
        ],
      };
    }

    return { elementsTested: 1, issues: [] };
  },
});

// ── 2.4.4 / 2.4.9 Link purpose ───────────────────────────────────────────────

const linkHasName = elementRule({
  id: 'link-has-name',
  title: 'Links have discernible text',
  help: 'A link with no text is announced as just "link" and there is no way to know where it goes.',
  criteria: ['2.4.4', '4.1.2'],
  impact: 'critical',
  techniques: ['H30', 'F89'],
  selector: 'a[href], [role="link"]',
  filter: visible,
  evaluate: (element) => {
    const name = accessibleName(element);
    if (name.value.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This link has no accessible name, so it is announced only as "link".',
      remediation:
        'Add text inside the link. If it contains only an icon, give the icon alt text or add an aria-label describing the destination.',
    };
  },
});

const linkTextIsDescriptive = elementRule({
  id: 'link-text-descriptive',
  title: 'Link text describes its destination',
  help: 'Screen reader users often navigate by listing every link on the page. "Read more" repeated twelve times is a list of nothing.',
  // 2.4.9 is the level AAA form of the same requirement, judged on the link
  // text alone rather than in context.
  criteria: ['2.4.4', '2.4.9'],
  impact: 'moderate',
  techniques: ['F63', 'H30'],
  selector: 'a[href]',
  filter: visible,
  evaluate: (element) => {
    const name = accessibleName(element).value.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    if (name.length === 0) return SKIP; // covered by link-has-name

    if (!NON_DESCRIPTIVE_LINK_TEXT.has(name)) return PASS;

    // Context from an ancestor list item or paragraph can rescue the link
    // under 2.4.4 (In Context), so this is advisory rather than a hard failure.
    return {
      outcome: 'cantTell',
      message: `The link text "${name}" does not describe where the link goes when read on its own.`,
      remediation:
        'Rewrite the link text to name the destination, for example "Read the 2026 accessibility report". If the surrounding sentence supplies the context, this passes 2.4.4 but still fails 2.4.9 at level AAA.',
      impact: 'minor',
    };
  },
});

const identicalLinksSameDestination = documentRule({
  id: 'identical-links-same-purpose',
  title: 'Links with the same name go to the same place',
  help: 'Two links reading "Download" that lead to different files are indistinguishable in a link list.',
  criteria: ['2.4.4', '3.2.4'],
  impact: 'moderate',
  evaluate: (context) => {
    const links = Array.from(context.document.querySelectorAll('a[href]')).filter(visible);
    const byName = new Map<string, Set<string>>();
    const firstByName = new Map<string, Element>();

    /*
     * Compare destinations, not raw href strings. `about`, `/about` and
     * `https://site/about` are the same page written three ways, and treating
     * them as different destinations fails pages that are actually consistent.
     * The fragment is dropped: `#main` on the same page is not a different
     * destination.
     */
    const destinationOf = (href: string): string => {
      const withoutFragment = href.split('#')[0] ?? href;
      if (!context.baseUrl) return withoutFragment;
      try {
        const resolved = new URL(withoutFragment, context.baseUrl);
        return `${resolved.origin}${resolved.pathname}${resolved.search}`;
      } catch {
        return withoutFragment;
      }
    };

    for (const link of links) {
      const name = accessibleName(link).value.trim().toLowerCase();
      if (name.length === 0) continue;
      const href = link.getAttribute('href') ?? '';
      const destinations = byName.get(name) ?? new Set<string>();
      destinations.add(destinationOf(href));
      byName.set(name, destinations);
      if (!firstByName.has(name)) firstByName.set(name, link);
    }

    const issues: DocumentIssue[] = [];
    for (const [name, destinations] of byName) {
      if (destinations.size <= 1) continue;
      issues.push({
        element: firstByName.get(name) ?? null,
        outcome: 'failed',
        message: `${destinations.size} links share the name "${name}" but point to different destinations.`,
        remediation:
          'Give each link text that distinguishes its destination, or add an aria-label that does. Users navigating by link list cannot tell these apart.',
      });
    }

    return { elementsTested: links.length, issues };
  },
});

const newWindowWarned = elementRule({
  id: 'new-window-warned',
  title: 'Links that open a new window say so',
  help: 'An unannounced new window disorients screen reader users and breaks the back button for everyone.',
  criteria: ['3.2.5'],
  impact: 'minor',
  techniques: ['G201', 'H83'],
  selector: 'a[target="_blank"]',
  filter: visible,
  evaluate: (element) => {
    const name = accessibleName(element).value.toLowerCase();
    const title = (element.getAttribute('title') ?? '').toLowerCase();
    if (/new (window|tab)|opens in|external/.test(`${name} ${title}`)) return PASS;
    return {
      outcome: 'failed',
      message: 'This link opens in a new window without warning the user.',
      remediation:
        'Add "(opens in a new window)" to the link text, or include it in an aria-label. A visual icon alone is not enough.',
    };
  },
});

// ── 2.4.6 Headings and Labels ────────────────────────────────────────────────

const headingHasText = elementRule({
  id: 'heading-has-text',
  title: 'Headings are not empty',
  help: 'An empty heading is announced as "heading level 2" with no content, and it pollutes the heading outline users navigate by.',
  criteria: ['1.3.1', '2.4.6'],
  impact: 'serious',
  selector: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
  filter: visible,
  evaluate: (element) => {
    if (accessibleName(element).value.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This heading has no text content.',
      remediation: 'Give the heading text, or remove it if it exists only for spacing or styling.',
    };
  },
});

const headingOrder = documentRule({
  id: 'heading-order',
  title: 'Heading levels are not skipped',
  help: 'Headings are the table of contents screen reader users navigate by. A jump from h2 to h4 implies a missing section.',
  criteria: ['1.3.1'],
  impact: 'moderate',
  techniques: ['G141'],
  evaluate: (context) => {
    const headings = Array.from(
      context.document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]'),
    ).filter(visible);

    const issues: DocumentIssue[] = [];
    let previous = 0;

    for (const heading of headings) {
      const explicit = Number.parseInt(heading.getAttribute('aria-level') ?? '', 10);
      const level = Number.isFinite(explicit)
        ? explicit
        : Number.parseInt(tagOf(heading).slice(1), 10);
      if (!Number.isFinite(level)) continue;

      if (previous > 0 && level > previous + 1) {
        issues.push({
          element: heading,
          outcome: 'failed',
          message: `This is an h${level} but the previous heading was an h${previous}, so ${level - previous - 1} level(s) are skipped.`,
          remediation: `Change this to an h${previous + 1}, or add the intermediate heading the outline implies.`,
        });
      }
      previous = level;
    }

    return { elementsTested: headings.length, issues };
  },
});

const singleH1 = documentRule({
  id: 'page-has-one-h1',
  title: 'The page has exactly one top-level heading',
  help: 'The h1 names the page. Zero leaves the outline rootless; several make it ambiguous which one is the page.',
  criteria: ['1.3.1', '2.4.6'],
  impact: 'moderate',
  evaluate: (context) => {
    const doc = context.document;
    if (!safeBody(doc)) return { elementsTested: 0, issues: [] };

    const h1s = Array.from(doc.querySelectorAll('h1, [role="heading"][aria-level="1"]')).filter(visible);

    if (h1s.length === 0) {
      return {
        elementsTested: 1,
        issues: [
          {
            element: null,
            outcome: 'failed',
            message: 'This page has no h1, so its heading outline has no root.',
            remediation: 'Add a single h1 naming what this page is about. It usually matches the page title.',
          },
        ],
      };
    }

    if (h1s.length > 1) {
      return {
        elementsTested: h1s.length,
        issues: [
          {
            element: h1s[1] as Element,
            outcome: 'failed',
            message: `This page has ${h1s.length} h1 elements, so it is unclear which one names the page.`,
            remediation: 'Keep one h1 for the page and demote the rest to h2.',
            impact: 'minor',
          },
        ],
      };
    }

    return { elementsTested: 1, issues: [] };
  },
});

// ── 2.4.7 Focus Visible ──────────────────────────────────────────────────────

const focusVisible = documentRule({
  id: 'focus-visible',
  title: 'The keyboard focus indicator is not removed',
  help: 'Removing the focus outline leaves keyboard users with no idea where they are on the page.',
  criteria: ['2.4.7'],
  impact: 'critical',
  techniques: ['G149', 'F78'],
  evaluate: (context) => {
    const issues: DocumentIssue[] = [];

    // Inline `outline: none` on a focusable element.
    const inlineOffenders = Array.from(context.document.querySelectorAll('[style]')).filter(
      (element) =>
        /outline\s*:\s*(none|0)/.test((element.getAttribute('style') ?? '').toLowerCase()) &&
        isFocusable(element),
    );

    for (const element of inlineOffenders) {
      issues.push({
        element,
        outcome: 'failed',
        message: 'This focusable element removes its outline inline, with no replacement focus indicator.',
        remediation:
          'Remove outline:none, or pair it with a clearly visible :focus-visible style of at least 3:1 contrast against the background.',
      });
    }

    // `:focus { outline: none }` in a <style> block, with no replacement.
    for (const styleEl of Array.from(context.document.querySelectorAll('style'))) {
      const css = (styleEl.textContent ?? '').replace(/\s+/g, ' ');
      const focusBlocks = css.match(/[^{}]*:focus(?:-visible)?(?![\w-])[^{]*\{[^}]*\}/g) ?? [];
      for (const block of focusBlocks) {
        /*
         * `[tabindex="-1"]:focus { outline: none }` is not a defect.
         *
         * An element with tabindex="-1" is not in the tab sequence — it can
         * only receive focus programmatically, as a skip-link target or after a
         * route change. Suppressing the ring there is the recommended pattern:
         * the user did not navigate to it themselves, and drawing a box around
         * an entire page region is more confusing than helpful. The rule must
         * not report it, or every well-built single-page app fails 2.4.7.
         */
        const selector = block.slice(0, block.indexOf('{'));
        if (/\[tabindex\s*=\s*["']?-1["']?\]/.test(selector)) continue;

        // Parse the declarations rather than pattern-matching the whole block.
        // A negative lookahead over the raw text is not safe here: `\s*` can
        // backtrack to zero width, which makes `outline: none` look like a
        // replacement rule and silently suppresses the finding.
        const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
        const declarations = new Map<string, string>();
        for (const chunk of body.split(';')) {
          const colon = chunk.indexOf(':');
          if (colon === -1) continue;
          declarations.set(
            chunk.slice(0, colon).trim().toLowerCase(),
            chunk.slice(colon + 1).trim().toLowerCase(),
          );
        }

        const outline = declarations.get('outline') ?? declarations.get('outline-style');
        const removesOutline = outline !== undefined && /^(none|0(px|em|rem)?)$/.test(outline);
        if (!removesOutline) continue;

        // Any other visible indicator in the same block counts as a replacement.
        const replaced = [...declarations].some(([property, value]) => {
          if (!/^(box-shadow|border|border-\w+|background|background-color|outline)$/.test(property)) {
            return false;
          }
          return !/^(none|0(px|em|rem)?|transparent)$/.test(value);
        });
        if (replaced) continue;
        issues.push({
          element: styleEl,
          outcome: 'failed',
          message: 'A :focus rule removes the outline without providing a replacement focus indicator.',
          remediation:
            'Style :focus-visible with a visible indicator — an outline, box-shadow or border with at least 3:1 contrast and a 2px minimum thickness.',
        });
      }
    }

    return { elementsTested: 1, issues };
  },
});

// ── 2.5.3 Label in Name ──────────────────────────────────────────────────────

const labelInName = elementRule({
  id: 'label-in-name',
  title: 'The accessible name contains the visible label',
  help: 'Speech-input users say what they see. If the button reads "Send" but its name is "Submit form", saying "click Send" does nothing.',
  criteria: ['2.5.3'],
  impact: 'serious',
  techniques: ['G208', 'F96'],
  selector: 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"]',
  filter: (element) => {
    if (!visible(element)) return false;
    // Only meaningful when there is visible text to compare against.
    return visibleText(element).length > 0;
  },
  evaluate: (element) => {
    const label = visibleText(element)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    const name = accessibleName(element)
      .value.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (label.length === 0 || name.length === 0) return SKIP;
    if (name.includes(label)) return PASS;

    return {
      outcome: 'failed',
      message: `The visible label is "${label}" but the accessible name is "${name}", which does not contain it. Speech-input users cannot activate this control by saying what they see.`,
      remediation:
        'Make the accessible name start with the visible text. If you need extra context, append it: aria-label="Send message" for a button reading "Send".',
    };
  },
});

// ── 2.5.1 Pointer Gestures / 2.5.2 Pointer Cancellation ──────────────────────

const pointerCancellation = elementRule({
  id: 'pointer-cancellation',
  title: 'Actions do not fire on pointer-down',
  help: 'Firing on mousedown removes the ability to change your mind by moving away before releasing — a lifeline for people with tremors.',
  criteria: ['2.5.2'],
  impact: 'moderate',
  selector: '[onmousedown], [onpointerdown], [ontouchstart]',
  filter: visible,
  evaluate: (element) => {
    const hasUpHandler =
      element.hasAttribute('onmouseup') ||
      element.hasAttribute('onpointerup') ||
      element.hasAttribute('ontouchend') ||
      element.hasAttribute('onclick');

    if (hasUpHandler) {
      return {
        outcome: 'cantTell',
        message: 'This element handles both pointer-down and pointer-up. Verify that the action completes on up, not on down.',
        remediation: 'Trigger the action on the up event, and let the user abort by moving the pointer away before releasing.',
        impact: 'minor',
      };
    }

    return {
      outcome: 'failed',
      message: 'This element performs its action on pointer-down, so the user cannot abort it by moving away before releasing.',
      remediation: 'Move the action to the up event (or use click), so pressing can be cancelled.',
    };
  },
});

// ── 2.5.5 Target Size ────────────────────────────────────────────────────────

const targetSize = elementRule({
  id: 'target-size',
  title: 'Touch targets are large enough',
  help: 'Targets smaller than 44×44 CSS pixels are hard to hit for anyone with reduced dexterity.',
  criteria: ['2.5.5'],
  impact: 'moderate',
  selector: 'a[href], button, [role="button"], input[type="checkbox"], input[type="radio"]',
  filter: (element) => {
    if (!visible(element)) return false;
    const style = (element.getAttribute('style') ?? '').toLowerCase();
    return /width|height/.test(style);
  },
  evaluate: (element) => {
    const style = (element.getAttribute('style') ?? '').toLowerCase();
    const dimension = (property: string): number | null => {
      const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([\\d.]+)px`).exec(style);
      return match ? Number.parseFloat(match[1] ?? '') : null;
    };

    const width = dimension('width');
    const height = dimension('height');
    if (width === null && height === null) return SKIP;

    const tooSmall = (width !== null && width < 44) || (height !== null && height < 44);
    if (!tooSmall) return PASS;

    return {
      outcome: 'failed',
      message: `This target is declared as ${width ?? '?'}×${height ?? '?'} CSS pixels, below the 44×44 minimum.`,
      remediation: 'Increase the size to at least 44×44 CSS pixels, or add padding so the clickable area reaches that size.',
    };
  },
});

export const operableRules: readonly Rule[] = [
  clickableIsKeyboardOperable,
  noPositiveTabindex,
  focusableNotAriaHidden,
  noMetaRefresh,
  noBlinkingContent,
  bypassBlocks,
  landmarkUniqueness,
  pageHasTitle,
  linkHasName,
  linkTextIsDescriptive,
  identicalLinksSameDestination,
  newWindowWarned,
  headingHasText,
  headingOrder,
  singleH1,
  focusVisible,
  labelInName,
  pointerCancellation,
  targetSize,
];
