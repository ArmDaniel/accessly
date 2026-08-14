import { accessibleName } from '../dom/accname.js';
import { inputType, isVisible, tagOf } from '../dom/aria.js';
import type { DocumentIssue, Rule } from '../engine/types.js';
import { documentRule, elementRule, PASS } from './define.js';

const visible = isVisible;

/**
 * Primary language subtags from ISO 639-1 plus the three-letter codes that show
 * up in practice. A full registry lookup is overkill: what we need to catch is
 * `lang="english"`, `lang="EN_US"` and empty values, which is most of what
 * actually goes wrong.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i;

const COMMON_LANGUAGE_SUBTAGS = new Set([
  'ar', 'bg', 'bn', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu',
  'fa', 'fi', 'fr', 'ga', 'gl', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it',
  'ja', 'ka', 'kk', 'ko', 'lt', 'lv', 'mk', 'ms', 'mt', 'nb', 'nl', 'nn', 'no',
  'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sq', 'sr', 'sv', 'sw', 'ta', 'th', 'tr',
  'uk', 'ur', 'vi', 'zh',
]);

// ── 3.1.1 Language of Page ───────────────────────────────────────────────────

const pageHasLang = documentRule({
  id: 'page-has-lang',
  title: 'The page declares its language',
  help: 'Without a language, a screen reader reads the page in whatever voice it happens to be set to — English text read with a German voice is incomprehensible.',
  criteria: ['3.1.1'],
  impact: 'serious',
  techniques: ['H57', 'F31'],
  evaluate: (context) => {
    const root = context.document.documentElement;
    if (!root) return { elementsTested: 0, issues: [] };

    const lang = (root.getAttribute('lang') ?? '').trim();

    if (lang.length === 0) {
      return {
        elementsTested: 1,
        issues: [
          {
            element: root,
            outcome: 'failed',
            message: 'The <html> element has no lang attribute, so assistive technology cannot choose the right pronunciation rules.',
            remediation: 'Add a lang attribute to <html> with the page\'s primary language, for example lang="en" or lang="ro".',
          },
        ],
      };
    }

    if (!LANGUAGE_TAG.test(lang)) {
      return {
        elementsTested: 1,
        issues: [
          {
            element: root,
            outcome: 'failed',
            message: `lang="${lang}" is not a valid BCP 47 language tag.`,
            remediation: 'Use a valid tag such as "en", "en-GB" or "ro-RO". Language names like "english" are not valid.',
          },
        ],
      };
    }

    const primary = (lang.split('-')[0] ?? '').toLowerCase();
    if (primary.length === 2 && !COMMON_LANGUAGE_SUBTAGS.has(primary)) {
      return {
        elementsTested: 1,
        issues: [
          {
            element: root,
            outcome: 'cantTell',
            message: `lang="${lang}" is well-formed but "${primary}" is not a language subtag Accessly recognises.`,
            remediation: 'Check the value against the IANA Language Subtag Registry.',
            impact: 'minor',
          },
        ],
      };
    }

    return { elementsTested: 1, issues: [] };
  },
});

// ── 3.1.2 Language of Parts ──────────────────────────────────────────────────

const validLangOnParts = elementRule({
  id: 'valid-lang-on-parts',
  title: 'Inline language changes are declared correctly',
  help: 'A passage in another language needs its own lang attribute, or it is read with the wrong pronunciation.',
  criteria: ['3.1.2'],
  impact: 'moderate',
  techniques: ['H58'],
  selector: '[lang]',
  filter: (element) => tagOf(element) !== 'html',
  evaluate: (element) => {
    const lang = (element.getAttribute('lang') ?? '').trim();
    if (lang.length === 0) {
      return {
        outcome: 'failed',
        message: 'This element has an empty lang attribute, which does not declare anything.',
        remediation: 'Set a valid language tag, or remove the attribute so the page language applies.',
      };
    }
    if (!LANGUAGE_TAG.test(lang)) {
      return {
        outcome: 'failed',
        message: `lang="${lang}" is not a valid BCP 47 language tag.`,
        remediation: 'Use a valid tag such as "fr" or "de-AT".',
      };
    }
    return PASS;
  },
});

// ── 3.2.1 On Focus / 3.2.2 On Input ──────────────────────────────────────────

const noContextChangeOnFocus = elementRule({
  id: 'no-context-change-on-focus',
  title: 'Focus alone does not change context',
  help: 'A page that navigates or submits the moment a control receives focus makes keyboard navigation impossible — you cannot tab past it.',
  criteria: ['3.2.1'],
  impact: 'serious',
  techniques: ['F55'],
  selector: '[onfocus]',
  filter: visible,
  evaluate: (element) => {
    const handler = (element.getAttribute('onfocus') ?? '').toLowerCase();
    if (/\.submit\(|location\s*=|location\.(href|assign|replace)|window\.open/.test(handler)) {
      return {
        outcome: 'failed',
        message: 'This element navigates or submits when it receives focus, which traps keyboard users who are simply tabbing through.',
        remediation: 'Move the action to an explicit activation event such as click, or to a submit button.',
      };
    }
    return {
      outcome: 'cantTell',
      message: 'This element runs script on focus. Verify that it does not change context — navigate, submit, or move focus elsewhere.',
      remediation: 'Restrict focus handlers to presentational changes. Anything that changes context must be user-initiated.',
      impact: 'minor',
    };
  },
});

const noContextChangeOnInput = elementRule({
  id: 'no-context-change-on-input',
  title: 'Changing a value alone does not change context',
  help: 'A select that navigates as soon as you arrow onto an option makes it impossible to reach the option you actually wanted.',
  criteria: ['3.2.2'],
  impact: 'serious',
  techniques: ['H32', 'F36', 'F37'],
  selector: 'select[onchange], input[onchange]',
  filter: visible,
  evaluate: (element) => {
    const handler = (element.getAttribute('onchange') ?? '').toLowerCase();
    const changesContext = /\.submit\(|location\s*=|location\.(href|assign|replace)|window\.open/.test(
      handler,
    );
    if (!changesContext) return PASS;

    const tag = tagOf(element);
    if (tag === 'select') {
      return {
        outcome: 'failed',
        message: 'This select navigates or submits as soon as its value changes, so keyboard users cannot browse past the first option.',
        remediation:
          'Add a separate "Go" button that applies the selection, and remove the automatic submit. This is WCAG technique H32.',
      };
    }

    if (['checkbox', 'radio'].includes(inputType(element))) {
      return {
        outcome: 'failed',
        message: 'This control submits the form as soon as it is selected, giving the user no chance to review or change their answer.',
        remediation: 'Add an explicit submit button and remove the automatic submission.',
      };
    }

    return {
      outcome: 'failed',
      message: 'Changing this field\'s value changes the page context automatically.',
      remediation: 'Require an explicit action — a submit button — before the context changes.',
    };
  },
});

// ── 3.2.3 Consistent Navigation ──────────────────────────────────────────────

const consistentNavigation = documentRule({
  id: 'consistent-navigation',
  title: 'Navigation is consistent across pages',
  help: 'Repeated navigation must appear in the same relative order on every page it occurs on.',
  criteria: ['3.2.3'],
  impact: 'moderate',
  evaluate: (context) => {
    const navs = context.document.querySelectorAll('nav, [role="navigation"]');
    if (navs.length === 0) return { elementsTested: 0, issues: [] };

    return {
      elementsTested: navs.length,
      issues: [
        {
          element: null,
          outcome: 'cantTell',
          message:
            'Consistent navigation is a site-wide property and cannot be judged from a single page. Accessly verifies it across the pages you register for monitoring.',
          remediation:
            'Keep repeated navigation in the same relative order on every page. Register more pages under a monitored site so Accessly can compare them.',
          impact: 'minor',
        },
      ],
    };
  },
});

// ── 3.3.1 Error Identification / 3.3.3 Error Suggestion ──────────────────────

const requiredFieldsMarked = elementRule({
  id: 'required-field-marked',
  title: 'Required fields are marked programmatically',
  help: 'A red asterisk is invisible to a screen reader. Required state has to be in the markup.',
  criteria: ['3.3.2'],
  impact: 'moderate',
  techniques: ['ARIA2', 'H90'],
  selector: 'input, select, textarea',
  filter: (element) => {
    if (!visible(element)) return false;
    if (element.hasAttribute('required') || element.getAttribute('aria-required') === 'true') {
      return false;
    }
    // Only flag fields that *look* required in their visible label.
    const name = accessibleName(element).value;
    return /\*|\(required\)|required/i.test(name);
  },
  evaluate: (element) => ({
    outcome: 'failed',
    message: `The label for this field ("${accessibleName(element).value}") indicates it is required, but the field itself is not marked required.`,
    remediation: 'Add the required attribute, or aria-required="true", so assistive technology announces the requirement.',
  }),
});

const errorMessageAssociated = elementRule({
  id: 'error-message-associated',
  title: 'Validation errors are linked to their field',
  help: 'An error message that is only visually adjacent to a field is never announced when the user reaches that field.',
  criteria: ['3.3.1', '3.3.3'],
  impact: 'serious',
  techniques: ['ARIA21', 'G85'],
  selector: '[aria-invalid="true"]',
  filter: visible,
  evaluate: (element) => {
    const describedBy = element.getAttribute('aria-describedby');
    const errorMessage = element.getAttribute('aria-errormessage');
    const doc = element.ownerDocument;

    const resolves = (value: string | null): boolean => {
      if (!value || !doc) return false;
      return value
        .split(/\s+/)
        .filter((id) => id.length > 0)
        .some((id) => {
          const target = doc.getElementById(id);
          return target !== null && (target.textContent ?? '').trim().length > 0;
        });
    };

    if (resolves(describedBy) || resolves(errorMessage)) return PASS;

    return {
      outcome: 'failed',
      message: 'This field is marked invalid but is not associated with any error message text.',
      remediation:
        'Point aria-describedby (or aria-errormessage) at the element containing the error text, and describe how to fix the problem, not just that it exists.',
    };
  },
});

// ── 3.3.4 Error Prevention ───────────────────────────────────────────────────

const consequentialFormReview = documentRule({
  id: 'consequential-form-review',
  title: 'Consequential submissions are reversible or confirmable',
  help: 'Legal, financial and data-deleting submissions must be reversible, checked, or confirmed before they take effect.',
  criteria: ['3.3.4'],
  impact: 'moderate',
  evaluate: (context) => {
    const forms = Array.from(context.document.querySelectorAll('form')).filter(visible);
    const consequential = forms.filter((form) => {
      const text = `${form.textContent ?? ''} ${form.getAttribute('action') ?? ''} ${form.getAttribute('id') ?? ''}`.toLowerCase();
      return /payment|checkout|purchase|order|delete|cancel subscription|transfer|invoice|billing/.test(
        text,
      );
    });

    if (consequential.length === 0) return { elementsTested: forms.length, issues: [] };

    const issues: DocumentIssue[] = consequential.map((form) => ({
      element: form,
      outcome: 'cantTell' as const,
      message:
        'This form appears to carry a financial or data-destroying commitment. Level AA requires that such submissions be reversible, validated, or explicitly confirmed.',
      remediation:
        'Add a review step showing what will happen before it is committed, and let the user go back and change it — or make the action reversible afterwards.',
      impact: 'minor' as const,
    }));

    return { elementsTested: forms.length, issues };
  },
});

export const understandableRules: readonly Rule[] = [
  pageHasLang,
  validLangOnParts,
  noContextChangeOnFocus,
  noContextChangeOnInput,
  consistentNavigation,
  requiredFieldsMarked,
  errorMessageAssociated,
  consequentialFormReview,
];

