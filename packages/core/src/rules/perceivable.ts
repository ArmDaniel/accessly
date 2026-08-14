import { accessibleName, visibleText } from '../dom/accname.js';
import {
  inputType,
  isHiddenFromAccessibilityTree,
  isVisible,
  LABELLABLE_TAGS,
  SELF_LABELLING_INPUT_TYPES,
  tagOf,
} from '../dom/aria.js';
import { contrastRatio, flatten, isLargeText, parseColor, requiredContrast, roundRatio } from '../dom/color.js';
import { palettes, resolveTextStyle } from '../dom/styles.js';
import type { DocumentIssue, ElementVerdict, Rule, RuleContext } from '../engine/types.js';
import { documentRule, elementRule, PASS, SKIP } from './define.js';

const visible = isVisible;

/** Alt text that describes the file rather than the image. */
const PLACEHOLDER_ALT =
  /^(image|photo|picture|graphic|img|icon|logo|spacer|blank|untitled)?[\s_-]*\d*$|\.(jpe?g|png|gif|svg|webp|avif)$/i;

// ── 1.1.1 Non-text Content ───────────────────────────────────────────────────

const imageAlt = elementRule({
  id: 'image-alt',
  title: 'Images have a text alternative',
  help: 'Every image must carry alt text describing its purpose, or alt="" if it is purely decorative, so screen reader users are not told "image" and nothing else.',
  criteria: ['1.1.1'],
  impact: 'critical',
  techniques: ['H37', 'F65'],
  selector: 'img',
  filter: visible,
  evaluate: (element) => {
    const alt = element.getAttribute('alt');
    const name = accessibleName(element);

    if (alt === null && name.value.length === 0) {
      return {
        outcome: 'failed',
        message: 'This image has no alt attribute and no accessible name, so assistive technology announces only "image".',
        remediation:
          'Add alt text describing what the image conveys. If it is decorative and repeats nearby text, add alt="" so it is skipped.',
      };
    }

    // alt="" is correct for decorative images — but only if nothing else names
    // the element, otherwise the author has contradicted themselves.
    if (alt !== null && alt.trim() === '') {
      const role = element.getAttribute('role');
      if (role && role !== 'presentation' && role !== 'none') {
        return {
          outcome: 'failed',
          message: `This image is marked decorative with alt="" but carries role="${role}", which puts it back in the accessibility tree without a name.`,
          remediation: 'Either give the image real alt text, or remove the role attribute so alt="" can take effect.',
        };
      }
      return PASS;
    }

    if (alt !== null && PLACEHOLDER_ALT.test(alt.trim())) {
      return {
        outcome: 'failed',
        message: `The alt text "${alt.trim()}" describes the file, not the content of the image.`,
        remediation: 'Replace it with a description of what the image shows or what it does, in the context of the surrounding text.',
        impact: 'serious',
      };
    }

    return PASS;
  },
});

const inputImageAlt = elementRule({
  id: 'input-image-alt',
  title: 'Image buttons have a text alternative',
  help: 'An <input type="image"> is a submit button. Without alt text its purpose is unknown to anyone who cannot see it.',
  criteria: ['1.1.1', '4.1.2'],
  impact: 'critical',
  techniques: ['H36'],
  selector: 'input[type="image"]',
  filter: visible,
  evaluate: (element) => {
    const name = accessibleName(element);
    if (name.value.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This image button has no accessible name, so its purpose cannot be determined without seeing it.',
      remediation: 'Add an alt attribute describing the action the button performs, for example alt="Search".',
    };
  },
});

const areaAlt = elementRule({
  id: 'area-alt',
  title: 'Image map areas have a text alternative',
  help: 'Each clickable region of an image map is a link and needs its own name.',
  criteria: ['1.1.1', '2.4.4'],
  impact: 'serious',
  techniques: ['H24'],
  selector: 'area[href]',
  evaluate: (element) => {
    const name = accessibleName(element);
    if (name.value.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This image map area is a link with no accessible name.',
      remediation: 'Add an alt attribute to the <area> describing where the link goes.',
    };
  },
});

const svgHasName = elementRule({
  id: 'svg-has-name',
  title: 'Meaningful SVGs have an accessible name',
  help: 'An SVG exposed as an image needs a name; a purely decorative one should be hidden from assistive technology.',
  criteria: ['1.1.1'],
  impact: 'serious',
  selector: 'svg',
  filter: visible,
  evaluate: (element) => {
    const role = (element.getAttribute('role') ?? '').toLowerCase();
    if (role === 'presentation' || role === 'none') return PASS;

    const name = accessibleName(element);
    if (name.value.length > 0) return PASS;

    // An unlabelled SVG inside a named control is fine — the control names it.
    const control = element.closest?.('a[href], button, [role="button"], [role="link"]');
    if (control && accessibleName(control).value.length > 0) return SKIP;

    return {
      outcome: 'failed',
      message: 'This SVG has no accessible name and is not marked as decorative.',
      remediation:
        'Add a <title> as the first child of the <svg>, or an aria-label. If it is decorative, add aria-hidden="true" and focusable="false".',
    };
  },
});

const objectAlt = elementRule({
  id: 'object-alt',
  title: 'Embedded objects have a text alternative',
  help: 'Embedded content that cannot be rendered must have a text alternative in its place.',
  criteria: ['1.1.1'],
  impact: 'serious',
  selector: 'object',
  filter: visible,
  evaluate: (element) => {
    const name = accessibleName(element);
    if (name.value.length > 0) return PASS;
    if (visibleText(element).length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This embedded object has neither an accessible name nor fallback content.',
      remediation: 'Add an aria-label to the <object>, or place descriptive fallback content between its tags.',
    };
  },
});

// ── 1.2.x Time-based media ───────────────────────────────────────────────────

const videoCaptions = elementRule({
  id: 'video-captions',
  title: 'Video has a captions track',
  help: 'Prerecorded video with audio needs synchronised captions for deaf and hard-of-hearing users.',
  criteria: ['1.2.2'],
  impact: 'critical',
  techniques: ['H95'],
  selector: 'video',
  evaluate: (element) => {
    const tracks = Array.from(element.querySelectorAll('track'));
    const hasCaptions = tracks.some((t) => {
      const kind = (t.getAttribute('kind') ?? 'subtitles').toLowerCase();
      return kind === 'captions';
    });
    if (hasCaptions) return PASS;

    return {
      outcome: 'failed',
      message: 'This video has no <track kind="captions">, so its audio content is unavailable to anyone who cannot hear it.',
      remediation:
        'Add <track kind="captions" srclang="…" src="…" label="…"> to the video. Note that kind="subtitles" is a translation, not a substitute for captions.',
    };
  },
});

const videoAudioDescription = elementRule({
  id: 'video-audio-description',
  title: 'Video has an audio description track',
  help: 'Visual information in a video that is not conveyed by the soundtrack must be described.',
  criteria: ['1.2.3', '1.2.5'],
  impact: 'serious',
  selector: 'video',
  evaluate: (element) => {
    const tracks = Array.from(element.querySelectorAll('track'));
    const hasDescription = tracks.some(
      (t) => (t.getAttribute('kind') ?? '').toLowerCase() === 'descriptions',
    );
    if (hasDescription) return PASS;

    return {
      outcome: 'cantTell',
      message:
        'No audio description track was found. If this video shows information that is not spoken aloud, it needs one.',
      remediation:
        'Add <track kind="descriptions">, provide a described version of the video, or publish a transcript that covers the visual content.',
    };
  },
});

const audioHasTranscript = elementRule({
  id: 'audio-has-alternative',
  title: 'Audio has a text alternative',
  help: 'Prerecorded audio-only content needs an equivalent transcript.',
  criteria: ['1.2.1'],
  impact: 'serious',
  selector: 'audio',
  evaluate: () => ({
    outcome: 'cantTell',
    message: 'Audio-only content requires an equivalent text transcript, which cannot be detected automatically.',
    remediation: 'Publish a transcript near the player and link to it, so the same information is available in text.',
  }),
});

const autoplayAudio = elementRule({
  id: 'no-autoplay-audio',
  title: 'Audio does not play automatically',
  help: 'Sound that starts on its own drowns out a screen reader and gives the user no way to stop it.',
  criteria: ['1.4.2'],
  impact: 'serious',
  techniques: ['G60', 'F93'],
  selector: 'audio[autoplay], video[autoplay]',
  evaluate: (element) => {
    if (element.hasAttribute('muted')) return PASS;
    if (element.hasAttribute('controls')) {
      return {
        outcome: 'cantTell',
        message: 'This media autoplays. It exposes controls, which satisfies 1.4.2 only if it plays for less than three seconds or the controls are reachable first in the tab order.',
        remediation: 'Prefer not autoplaying at all. If you must, add the muted attribute and let the user start the sound.',
        impact: 'moderate',
      };
    }
    return {
      outcome: 'failed',
      message: 'This media plays automatically with sound and offers no control to stop it.',
      remediation: 'Remove the autoplay attribute, or add both muted and controls so the user decides when sound starts.',
    };
  },
});

// ── 1.3.1 Info and Relationships ─────────────────────────────────────────────

const formFieldHasLabel = elementRule({
  id: 'form-field-has-label',
  title: 'Form fields have a label',
  help: 'A field without a programmatic label is announced only by its type — "edit text, blank" — with no hint of what to enter.',
  criteria: ['1.3.1', '3.3.2', '4.1.2'],
  impact: 'critical',
  techniques: ['H44', 'H65', 'F68'],
  selector: 'input, select, textarea',
  filter: (element) => {
    if (!LABELLABLE_TAGS.has(tagOf(element))) return false;
    if (tagOf(element) === 'input' && SELF_LABELLING_INPUT_TYPES.has(inputType(element))) return false;
    return visible(element);
  },
  evaluate: (element) => {
    const name = accessibleName(element);
    if (name.value.length > 0) {
      // A placeholder disappears the moment the user types. It is a hint, not
      // a label, and relying on it fails 3.3.2 as soon as the field is filled.
      if (name.source === 'title' && element.hasAttribute('placeholder')) {
        return {
          outcome: 'failed',
          message: 'This field is named only by its title attribute, which is unreliable on touch devices and invisible to sighted keyboard users.',
          remediation: 'Add a visible <label for="…"> associated with the field.',
          impact: 'serious',
        };
      }
      return PASS;
    }

    if (element.hasAttribute('placeholder')) {
      return {
        outcome: 'failed',
        message: 'This field has only a placeholder, which is not a label — it vanishes as soon as the user types and is not reliably announced.',
        remediation:
          'Add a visible <label for="…"> pointing at this field\'s id. Keep the placeholder for format hints only, if at all.',
      };
    }

    return {
      outcome: 'failed',
      message: 'This form field has no associated label, so its purpose is not announced.',
      remediation: 'Add <label for="…">, wrap the field in a <label>, or add an aria-label if no visible label is possible.',
    };
  },
});

const labelForExists = elementRule({
  id: 'label-for-resolves',
  title: 'Labels point at a real field',
  help: 'A <label for> whose id does not exist labels nothing at all, and the mistake is invisible on screen.',
  criteria: ['1.3.1', '3.3.2'],
  impact: 'serious',
  techniques: ['H44'],
  selector: 'label[for]',
  evaluate: (element) => {
    const target = element.getAttribute('for');
    if (!target) return SKIP;
    const referenced = element.ownerDocument?.getElementById(target);
    if (!referenced) {
      return {
        outcome: 'failed',
        message: `This label points at id="${target}", but no element with that id exists on the page.`,
        remediation: 'Correct the for attribute so it matches the id of the field this label describes.',
      };
    }
    if (!LABELLABLE_TAGS.has(tagOf(referenced))) {
      return {
        outcome: 'failed',
        message: `This label points at a <${tagOf(referenced)}>, which is not a labellable form control.`,
        remediation: 'Point the for attribute at the <input>, <select> or <textarea> this label describes.',
      };
    }
    return PASS;
  },
});

const ariaReferencesResolve = elementRule({
  id: 'aria-reference-resolves',
  title: 'ARIA relationships point at real elements',
  help: 'aria-labelledby and aria-describedby silently do nothing when their ids do not exist, leaving controls unnamed.',
  criteria: ['1.3.1', '4.1.2'],
  impact: 'serious',
  selector: '[aria-labelledby], [aria-describedby], [aria-controls], [aria-owns]',
  evaluate: (element) => {
    const doc = element.ownerDocument;
    if (!doc) return SKIP;

    const broken: string[] = [];
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
      const raw = element.getAttribute(attribute);
      if (!raw) continue;
      for (const id of raw.split(/\s+/).filter((v) => v.length > 0)) {
        if (!doc.getElementById(id)) broken.push(`${attribute}="${id}"`);
      }
    }

    if (broken.length === 0) return PASS;
    return {
      outcome: 'failed',
      message: `These ARIA references point at ids that do not exist: ${broken.join(', ')}.`,
      remediation: 'Correct the ids, or remove the attributes if the relationship is no longer needed.',
    };
  },
});

const listStructure = elementRule({
  id: 'list-structure',
  title: 'Lists contain only list items',
  help: 'Screen readers announce "list, 5 items". Stray children break that count and the relationship it describes.',
  criteria: ['1.3.1'],
  impact: 'moderate',
  techniques: ['H48'],
  selector: 'ul, ol',
  filter: visible,
  evaluate: (element) => {
    const offenders = Array.from(element.children).filter((child) => {
      const tag = tagOf(child);
      // script and template are permitted content model exceptions.
      return !['li', 'script', 'template'].includes(tag);
    });
    if (offenders.length === 0) return PASS;

    const tags = [...new Set(offenders.map((o) => `<${tagOf(o)}>`))].join(', ');
    return {
      outcome: 'failed',
      message: `This list has ${offenders.length} direct child element(s) that are not <li>: ${tags}.`,
      remediation: 'Move the content inside an <li>, or use a <div> wrapper outside the list.',
    };
  },
});

const definitionListStructure = elementRule({
  id: 'definition-list-structure',
  title: 'Definition lists are correctly structured',
  help: 'A <dl> conveys term-to-definition pairings; unexpected children destroy that pairing.',
  criteria: ['1.3.1'],
  impact: 'moderate',
  techniques: ['H40'],
  selector: 'dl',
  filter: visible,
  evaluate: (element) => {
    const offenders = Array.from(element.children).filter(
      (child) => !['dt', 'dd', 'div', 'script', 'template'].includes(tagOf(child)),
    );
    if (offenders.length === 0) return PASS;
    return {
      outcome: 'failed',
      message: `A definition list may only contain <dt>, <dd> and grouping <div> elements, but this one also contains <${tagOf(offenders[0] as Element)}>.`,
      remediation: 'Restructure so every term is a <dt> and every definition a <dd>.',
    };
  },
});

const tableHeaders = elementRule({
  id: 'data-table-has-headers',
  title: 'Data tables have header cells',
  help: 'Without <th>, a screen reader cannot tell the user which column or row a cell belongs to.',
  criteria: ['1.3.1'],
  impact: 'serious',
  techniques: ['H51', 'H63'],
  selector: 'table',
  filter: (element) => {
    if (!visible(element)) return false;
    const role = (element.getAttribute('role') ?? '').toLowerCase();
    // Layout tables are explicitly exempt when marked as such.
    if (role === 'presentation' || role === 'none') return false;
    // A single-row, single-cell table is not a data table.
    return element.querySelectorAll('td, th').length > 1;
  },
  evaluate: (element) => {
    const headers = element.querySelectorAll('th');
    if (headers.length === 0) {
      return {
        outcome: 'failed',
        message: 'This table has data cells but no header cells, so the meaning of each cell is lost.',
        remediation:
          'Mark the header row or column with <th scope="col"> / <th scope="row">. If the table is purely for layout, add role="presentation".',
      };
    }

    const missingScope = Array.from(headers).filter((th) => {
      if (th.hasAttribute('scope')) return false;
      if (th.hasAttribute('id')) return false; // paired with headers=""
      return true;
    });

    // A simple table with a single header row does not need explicit scope —
    // the first row is unambiguous. Complex tables do.
    const rows = element.querySelectorAll('tr').length;
    if (missingScope.length > 0 && rows > 1 && element.querySelectorAll('tr > th').length > 1) {
      const firstRowOnly = Array.from(element.querySelectorAll('tr'))[0];
      const headersOutsideFirstRow = Array.from(headers).some(
        (th) => th.parentElement !== firstRowOnly,
      );
      if (headersOutsideFirstRow) {
        return {
          outcome: 'failed',
          message: 'This table has headers in more than one direction but does not declare scope, so cell relationships are ambiguous.',
          remediation: 'Add scope="col" to column headers and scope="row" to row headers.',
          impact: 'moderate',
        };
      }
    }

    return PASS;
  },
});

const tableCaption = elementRule({
  id: 'data-table-has-caption',
  title: 'Data tables are named',
  help: 'A caption lets a screen reader user decide whether a table is worth exploring before entering it.',
  criteria: ['1.3.1'],
  impact: 'minor',
  techniques: ['H39'],
  selector: 'table',
  filter: (element) => {
    const role = (element.getAttribute('role') ?? '').toLowerCase();
    if (role === 'presentation' || role === 'none') return false;
    return visible(element) && element.querySelectorAll('th').length > 0;
  },
  evaluate: (element) => {
    if (accessibleName(element).value.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This data table has no caption or accessible name.',
      remediation: 'Add a <caption> as the first child of the table describing what it contains.',
    };
  },
});

const fieldsetLegend = elementRule({
  id: 'fieldset-has-legend',
  title: 'Grouped fields have a group name',
  help: 'Radio buttons and checkboxes need a group name, or the user hears the options without the question.',
  criteria: ['1.3.1', '3.3.2'],
  impact: 'serious',
  techniques: ['H71'],
  selector: 'fieldset',
  filter: visible,
  evaluate: (element) => {
    if (accessibleName(element).value.length > 0) return PASS;
    return {
      outcome: 'failed',
      message: 'This fieldset has no legend, so the grouped controls are announced without the question they answer.',
      remediation: 'Add a <legend> as the first child of the fieldset, containing the group\'s question or heading.',
    };
  },
});

const radioGroupIsGrouped = documentRule({
  id: 'radio-group-is-grouped',
  title: 'Radio button groups are grouped programmatically',
  help: 'A set of radio buttons is one question. Without a group, each option is announced with no context.',
  criteria: ['1.3.1'],
  impact: 'moderate',
  techniques: ['H71'],
  evaluate: (context) => {
    const radios = Array.from(context.document.querySelectorAll('input[type="radio"][name]')).filter(
      (r) => !isHiddenFromAccessibilityTree(r),
    );

    const groups = new Map<string, Element[]>();
    for (const radio of radios) {
      const name = radio.getAttribute('name') ?? '';
      const bucket = groups.get(name) ?? [];
      bucket.push(radio);
      groups.set(name, bucket);
    }

    const issues: DocumentIssue[] = [];
    for (const [name, members] of groups) {
      if (members.length < 2) continue;
      const first = members[0] as Element;
      const grouped = members.every((radio) => {
        const fieldset = radio.closest?.('fieldset');
        if (fieldset && accessibleName(fieldset).value.length > 0) return true;
        const group = radio.closest?.('[role="radiogroup"], [role="group"]');
        return Boolean(group && accessibleName(group).value.length > 0);
      });

      if (!grouped) {
        issues.push({
          element: first,
          outcome: 'failed',
          message: `The radio group "${name}" has ${members.length} options but is not wrapped in a named group, so the question is never announced.`,
          remediation:
            'Wrap the options in a <fieldset> with a <legend>, or in an element with role="radiogroup" and an accessible name.',
        });
      }
    }

    return { elementsTested: groups.size, issues };
  },
});

// ── 1.3.5 Identify Input Purpose ─────────────────────────────────────────────

/** Autocomplete tokens from the HTML spec that identify a field's purpose. */
const AUTOCOMPLETE_BY_NAME: Readonly<Record<string, string>> = {
  email: 'email',
  'e-mail': 'email',
  fname: 'given-name',
  firstname: 'given-name',
  lname: 'family-name',
  lastname: 'family-name',
  name: 'name',
  fullname: 'name',
  phone: 'tel',
  tel: 'tel',
  telephone: 'tel',
  address: 'street-address',
  street: 'street-address',
  city: 'address-level2',
  zip: 'postal-code',
  postcode: 'postal-code',
  postalcode: 'postal-code',
  country: 'country-name',
  organization: 'organization',
  company: 'organization',
  username: 'username',
  password: 'current-password',
};

/**
 * The autocomplete field-name tokens defined by the HTML standard, plus the
 * modifiers that may legally surround them. An attribute like
 * `autocomplete="banana"` is not a purpose declaration — it is invalid, and a
 * browser that ignores it gives the user nothing. 1.3.5 (and technique H98)
 * ask for a *correct* token, so the rule validates rather than merely detects
 * presence.
 *
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autocomplete-tokens
 */
const AUTOCOMPLETE_FIELD_NAMES = new Set([
  'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name',
  'honorific-suffix', 'nickname', 'username', 'new-password', 'current-password',
  'one-time-code', 'organization', 'street-address', 'address-line1',
  'address-line2', 'address-line3', 'address-level1', 'address-level2',
  'address-level3', 'address-level4', 'country', 'country-name', 'postal-code',
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name',
  'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type',
  'transaction-currency', 'transaction-amount', 'language', 'bday',
  'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo', 'tel',
  'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local',
  'tel-local-prefix', 'tel-local-suffix', 'tel-extension', 'email', 'impp',
]);

const AUTOCOMPLETE_MODIFIERS = new Set([
  'on', 'off', 'shipping', 'billing', 'home', 'work', 'mobile', 'fax', 'pager',
]);

/** Is this a well-formed autocomplete attribute that names a real purpose? */
function isValidAutocomplete(value: string): boolean {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  let index = 0;
  // An optional shipping/billing scope may lead.
  if ((tokens[index] === 'shipping' || tokens[index] === 'billing') && tokens.length > 1) index += 1;
  // An optional section-* group may lead (after the scope).
  if (/^section-/.test(tokens[index] ?? '') && tokens.length > index + 1) index += 1;

  // Contact-detail modifiers may trail the field name.
  const fieldIndex = index;
  for (let i = tokens.length - 1; i > fieldIndex; i -= 1) {
    if (['home', 'work', 'mobile', 'fax', 'pager'].includes(tokens[i] ?? '')) continue;
    return false;
  }

  const field = tokens[fieldIndex] ?? '';
  return AUTOCOMPLETE_MODIFIERS.has(field) || AUTOCOMPLETE_FIELD_NAMES.has(field);
}

/** The name/id hint used to guess what a field collects — shared by filter and evaluate. */
function autocompleteHint(element: Element): string {
  return `${element.getAttribute('name') ?? ''}${element.getAttribute('id') ?? ''}`
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const identifyInputPurpose = elementRule({
  id: 'input-autocomplete',
  title: 'Personal-data fields declare their purpose',
  help: 'An autocomplete token lets browsers and assistive tools fill or re-label a field — critical for people with memory or motor impairments.',
  criteria: ['1.3.5'],
  impact: 'moderate',
  techniques: ['H98'],
  selector: 'input',
  filter: (element) => {
    const type = inputType(element);
    if (['hidden', 'submit', 'reset', 'button', 'image', 'checkbox', 'radio', 'file'].includes(type)) {
      return false;
    }
    if (!visible(element)) return false;
    const hint = autocompleteHint(element);
    return Object.keys(AUTOCOMPLETE_BY_NAME).some((key) => hint.includes(key));
  },
  evaluate: (element) => {
    const autocomplete = (element.getAttribute('autocomplete') ?? '').trim().toLowerCase();

    // Present but invalid (`autocomplete="banana"`) is worse than absent: it
    // looks like a purpose declaration and browsers discard it.
    if (autocomplete.length > 0 && !isValidAutocomplete(autocomplete)) {
      return {
        outcome: 'failed',
        message: `This field sets autocomplete="${autocomplete}", which is not a valid autocomplete token, so browsers discard it and the user gets no assistance.`,
        remediation: 'Use a real autocomplete token from the HTML standard, for example autocomplete="email" or autocomplete="postal-code".',
      };
    }

    if (autocomplete.length > 0 && autocomplete !== 'off') return PASS;

    const hint = autocompleteHint(element);
    const match = Object.entries(AUTOCOMPLETE_BY_NAME).find(([key]) => hint.includes(key));
    const suggestion = match?.[1] ?? 'the appropriate token';

    if (autocomplete === 'off') {
      return {
        outcome: 'failed',
        message: 'This field collects information about the user but sets autocomplete="off", preventing the browser from filling it.',
        remediation: `Replace it with autocomplete="${suggestion}".`,
      };
    }

    return {
      outcome: 'failed',
      message: 'This field appears to collect information about the user but does not declare its purpose.',
      remediation: `Add autocomplete="${suggestion}" so browsers and assistive tools can identify and fill it.`,
    };
  },
});


/**
 * Measure contrast under every palette the document defines.
 *
 * A page with a `prefers-color-scheme: dark` block has two palettes, and text
 * that passes in one can fail in the other. Reporting only the default would
 * miss half the users. The worst result across all palettes is what gets
 * reported, named so the developer knows which theme to fix.
 */
function measureContrast(
  element: Element,
  context: RuleContext,
  level: 'AA' | 'AAA',
): ElementVerdict {
  let worst: {
    ratio: number;
    required: number;
    large: boolean;
    palette: string;
  } | null = null;
  let unresolvedReason: string | null = null;

  for (const palette of palettes(context.styleModel)) {
    const style = resolveTextStyle(element, context.styleModel, palette.variables);

    if (!style.complete || !style.color || !style.backgroundColor) {
      unresolvedReason ??= style.unresolvedReason;
      continue;
    }

    const foreground = flatten(style.color, style.backgroundColor);
    const ratio = roundRatio(contrastRatio(foreground, style.backgroundColor));
    const large = isLargeText(style.fontSizePx ?? 16, style.fontWeight ?? 400);
    const required = requiredContrast(level, large);

    // "Worst" means furthest below its own requirement, since the threshold
    // differs between palettes when font sizes differ.
    if (worst === null || ratio - required < worst.ratio - worst.required) {
      worst = { ratio, required, large, palette: palette.label };
    }
  }

  if (worst === null) {
    return {
      outcome: 'cantTell',
      message: `Contrast could not be verified for this text. ${unresolvedReason ?? ''}`.trim(),
      remediation:
        'Check this text against its background with a contrast checker. Accessly resolves colours declared in the page itself, including custom properties, but cannot see external stylesheets.',
      impact: 'minor',
    };
  }

  if (worst.ratio >= worst.required) return PASS;

  const where = worst.palette === 'default' ? '' : ` in the "${worst.palette}" theme`;
  return {
    outcome: 'failed',
    message: `This text has a contrast ratio of ${worst.ratio}:1 against its background${where}, below the ${worst.required}:1 required for ${worst.large ? 'large' : 'body'} text.`,
    remediation: `Darken the text or lighten the background until the ratio reaches at least ${worst.required}:1${where}.`,
    impact: worst.ratio < worst.required / 2 ? 'critical' : 'serious',
  };
}

// ── 1.4.3 / 1.4.6 Contrast ───────────────────────────────────────────────────

/** Elements that hold text directly, rather than only wrapping other elements. */
const TEXT_BEARING = 'p, h1, h2, h3, h4, h5, h6, a, span, li, td, th, label, button, legend, figcaption, dt, dd, blockquote, cite, strong, em, small, summary';

const textContrast = elementRule({
  id: 'text-contrast',
  title: 'Text meets the minimum contrast ratio',
  help: 'Body text needs 4.5:1 against its background (3:1 when large). Below that it becomes unreadable for people with low vision or in bright light.',
  criteria: ['1.4.3'],
  impact: 'serious',
  techniques: ['G18', 'G145', 'F24'],
  selector: TEXT_BEARING,
  filter: (element) => {
    if (!visible(element)) return false;
    // Only elements with their own text — otherwise we would report the same
    // failure once for every ancestor.
    const ownText = Array.from(element.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    return ownText.length > 0;
  },
  evaluate: (element, context) => measureContrast(element, context, 'AA'),
});

const textContrastEnhanced = elementRule({
  id: 'text-contrast-enhanced',
  title: 'Text meets the enhanced contrast ratio',
  help: 'Level AAA raises the bar to 7:1 (4.5:1 for large text), which is what many people with moderately low vision actually need.',
  criteria: ['1.4.6'],
  impact: 'moderate',
  selector: TEXT_BEARING,
  filter: (element) => {
    if (!visible(element)) return false;
    const ownText = Array.from(element.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    return ownText.length > 0;
  },
  evaluate: (element, context) => {
    const verdict = measureContrast(element, context, 'AAA');
    // At AAA an undecidable result is noise on top of the AA rule's, which has
    // already said the same thing about the same element.
    return verdict.outcome === 'cantTell' ? SKIP : verdict;
  },
});

// ── 1.4.4 / 1.4.10 Resize and reflow ─────────────────────────────────────────

const viewportZoom = documentRule({
  id: 'meta-viewport-scalable',
  title: 'Zoom is not disabled',
  help: 'Blocking pinch-zoom prevents low-vision users from enlarging text — the single most common accommodation there is.',
  criteria: ['1.4.4', '1.4.10'],
  impact: 'critical',
  techniques: ['F69'],
  evaluate: (context) => {
    const meta = context.document.querySelector('meta[name="viewport"]');
    if (!meta) return { elementsTested: 0, issues: [] };

    const content = (meta.getAttribute('content') ?? '').toLowerCase();
    const issues: DocumentIssue[] = [];

    if (/user-scalable\s*=\s*(no|0)/.test(content)) {
      issues.push({
        element: meta,
        outcome: 'failed',
        message: 'The viewport meta tag sets user-scalable=no, which disables pinch-to-zoom.',
        remediation: 'Remove user-scalable=no from the viewport meta tag.',
      });
    }

    const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(content);
    if (maxScale && Number.parseFloat(maxScale[1] ?? '0') < 2) {
      issues.push({
        element: meta,
        outcome: 'failed',
        message: `The viewport meta tag caps zoom at ${maxScale[1]}×, below the 2× minimum users must be able to reach.`,
        remediation: 'Remove maximum-scale, or set it to at least 2.',
      });
    }

    return { elementsTested: 1, issues };
  },
});

// ── 1.4.1 Use of Colour ──────────────────────────────────────────────────────

const linkDistinguishable = elementRule({
  id: 'link-not-colour-only',
  title: 'Links in body text are not distinguished by colour alone',
  help: 'If a link inside a paragraph is only a different colour, someone with colour blindness cannot tell it is a link.',
  criteria: ['1.4.1'],
  impact: 'moderate',
  techniques: ['G182', 'F73'],
  selector: 'p a[href], li a[href]',
  filter: visible,
  evaluate: (element, context) => {
    const style = resolveTextStyle(element, context.styleModel);
    const inline = (element.getAttribute('style') ?? '').toLowerCase();

    // An underline (the default) or any other non-colour cue satisfies this.
    if (/text-decoration[^;]*underline/.test(inline)) return PASS;
    if (/border-bottom/.test(inline)) return PASS;
    // Only a genuinely bold weight is a cue — `font-weight: normal` is not.
    if (/font-weight\s*:\s*(?:bold|bolder|[6-9]\d{2})/.test(inline)) return PASS;

    const removesUnderline = /text-decoration\s*:\s*none/.test(inline);
    const parentStyle = element.parentElement
      ? resolveTextStyle(element.parentElement, context.styleModel)
      : null;

    const colourDiffers =
      style.color && parentStyle?.color
        ? style.color.r !== parentStyle.color.r ||
          style.color.g !== parentStyle.color.g ||
          style.color.b !== parentStyle.color.b
        : false;

    if (removesUnderline && colourDiffers) {
      return {
        outcome: 'failed',
        message: 'This in-text link removes its underline and is distinguished from the surrounding text by colour alone.',
        remediation:
          'Keep the underline, or add another visual cue such as a bottom border or bold weight. Alternatively raise the contrast between link and body text to at least 3:1 and ensure the link is underlined on hover and focus.',
      };
    }

    if (removesUnderline) {
      return {
        outcome: 'cantTell',
        message: 'This in-text link has its underline removed. Verify that another non-colour cue distinguishes it from surrounding text.',
        remediation: 'Add an underline, border or weight change so the link is identifiable without relying on colour.',
        impact: 'minor',
      };
    }

    return PASS;
  },
});

// ── 1.4.11 Non-text Contrast ─────────────────────────────────────────────────

const uiComponentContrast = elementRule({
  id: 'ui-component-contrast',
  title: 'Control boundaries are visible',
  help: 'The visible boundary of an input or button must reach 3:1 against its surroundings, or the control is invisible to some users.',
  criteria: ['1.4.11'],
  impact: 'moderate',
  selector: 'input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"], textarea, select',
  filter: visible,
  evaluate: (element, context) => {
    const inline = (element.getAttribute('style') ?? '').toLowerCase();
    const borderNone = /border\s*:\s*(none|0)/.test(inline);
    if (!borderNone) {
      const borderColour = /border(?:-\w+)?-color\s*:\s*([^;]+)/.exec(inline)?.[1];
      if (!borderColour) return SKIP;

      const border = parseColor(borderColour.trim());
      const style = resolveTextStyle(element, context.styleModel);
      if (!border || !style.backgroundColor) return SKIP;

      const ratio = roundRatio(contrastRatio(flatten(border, style.backgroundColor), style.backgroundColor));
      if (ratio >= 3) return PASS;

      return {
        outcome: 'failed',
        message: `The border of this control contrasts at only ${ratio}:1 with its background, below the 3:1 minimum.`,
        remediation: 'Darken the border colour until it reaches at least 3:1 against the adjacent background.',
      };
    }

    return {
      outcome: 'cantTell',
      message: 'This control removes its border. Verify that its boundary is still identifiable at 3:1 contrast, or that it has another visible indicator.',
      remediation: 'Give the control a visible boundary with at least 3:1 contrast, such as a border or a filled background distinct from the page.',
      impact: 'minor',
    };
  },
});

// ── 1.4.5 Images of Text ─────────────────────────────────────────────────────

const imagesOfText = elementRule({
  id: 'images-of-text',
  title: 'Text is not delivered as an image',
  help: 'Text baked into an image cannot be resized, restyled or read by a screen reader once magnified.',
  // 1.4.9 is the level AAA form, which removes the exceptions 1.4.5 allows.
  criteria: ['1.4.5', '1.4.9'],
  impact: 'moderate',
  detection: 'advisory',
  selector: 'img[alt]',
  filter: (element) => {
    if (!visible(element)) return false;
    const alt = (element.getAttribute('alt') ?? '').trim();
    // A long alt string is a strong hint the image is carrying prose.
    return alt.split(/\s+/).length >= 6;
  },
  evaluate: (element) => {
    const src = (element.getAttribute('src') ?? '').toLowerCase();
    // Logos are explicitly exempt from 1.4.5.
    if (/logo|wordmark|brand/.test(src)) return SKIP;
    return {
      outcome: 'cantTell',
      message: 'This image has a long text alternative, which often means the image itself contains text.',
      remediation:
        'If the image contains text that is not a logo, render it as real text styled with CSS so it can be resized and restyled.',
      impact: 'minor',
    };
  },
});

export const perceivableRules: readonly Rule[] = [
  imageAlt,
  inputImageAlt,
  areaAlt,
  svgHasName,
  objectAlt,
  videoCaptions,
  videoAudioDescription,
  audioHasTranscript,
  autoplayAudio,
  formFieldHasLabel,
  labelForExists,
  ariaReferencesResolve,
  listStructure,
  definitionListStructure,
  tableHeaders,
  tableCaption,
  fieldsetLegend,
  radioGroupIsGrouped,
  identifyInputPurpose,
  textContrast,
  textContrastEnhanced,
  viewportZoom,
  linkDistinguishable,
  uiComponentContrast,
  imagesOfText,
];
