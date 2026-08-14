import { accessibleName } from '../dom/accname.js';
import { computeRole, isFocusable, isVisible, tagOf, WIDGET_ROLES } from '../dom/aria.js';
import type { DocumentIssue, Rule } from '../engine/types.js';
import { documentRule, elementRule, PASS, SKIP } from './define.js';

const visible = isVisible;

/** Concrete (non-abstract) roles from WAI-ARIA 1.2. */
const VALID_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'associationlist',
  'associationlistitemkey', 'associationlistitemvalue', 'banner', 'blockquote',
  'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox',
  'comment', 'complementary', 'contentinfo', 'definition', 'deletion', 'dialog',
  'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic',
  'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list',
  'listbox', 'listitem', 'log', 'main', 'mark', 'marquee', 'math', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter',
  'navigation', 'none', 'note', 'option', 'paragraph', 'presentation',
  'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
  'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
  'spinbutton', 'status', 'strong', 'subscript', 'suggestion', 'superscript',
  'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time',
  'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);

/** Roles that are abstract and must never appear in markup. */
const ABSTRACT_ROLES = new Set([
  'command', 'composite', 'input', 'landmark', 'range', 'roletype', 'section',
  'sectionhead', 'select', 'structure', 'widget', 'window',
]);

/** Required owned-state attributes, per the WAI-ARIA role definitions. */
const REQUIRED_ARIA_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  checkbox: ['aria-checked'],
  combobox: ['aria-expanded'],
  heading: ['aria-level'],
  menuitemcheckbox: ['aria-checked'],
  menuitemradio: ['aria-checked'],
  option: ['aria-selected'],
  radio: ['aria-checked'],
  scrollbar: ['aria-controls', 'aria-valuenow'],
  slider: ['aria-valuenow'],
  switch: ['aria-checked'],
};

/** Roles that require an accessible name to be usable at all. */
const ROLES_REQUIRING_NAME = new Set([
  ...WIDGET_ROLES,
  'dialog',
  'alertdialog',
  'region',
  'form',
  'tabpanel',
  'meter',
  'progressbar',
]);

/** Valid values for the enumerated ARIA states our rules check. */
const ARIA_ENUMS: Readonly<Record<string, readonly string[]>> = {
  'aria-checked': ['true', 'false', 'mixed', 'undefined'],
  'aria-expanded': ['true', 'false', 'undefined'],
  'aria-pressed': ['true', 'false', 'mixed', 'undefined'],
  'aria-selected': ['true', 'false', 'undefined'],
  'aria-hidden': ['true', 'false'],
  'aria-disabled': ['true', 'false'],
  'aria-required': ['true', 'false'],
  'aria-invalid': ['true', 'false', 'grammar', 'spelling'],
  'aria-current': ['true', 'false', 'page', 'step', 'location', 'date', 'time'],
  'aria-live': ['off', 'polite', 'assertive'],
  'aria-atomic': ['true', 'false'],
  'aria-busy': ['true', 'false'],
  'aria-modal': ['true', 'false'],
  'aria-multiselectable': ['true', 'false'],
  'aria-orientation': ['horizontal', 'vertical', 'undefined'],
  'aria-haspopup': ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'],
  'aria-sort': ['ascending', 'descending', 'none', 'other'],
};

/**
 * Roles whose children are constrained by the ARIA spec. Getting these wrong
 * breaks the widget entirely in most screen readers.
 */
const REQUIRED_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  list: ['listitem'],
  listbox: ['option', 'group'],
  menu: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  menubar: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  radiogroup: ['radio'],
  tablist: ['tab'],
  table: ['row', 'rowgroup'],
  tree: ['treeitem', 'group'],
};

const REQUIRED_PARENT: Readonly<Record<string, readonly string[]>> = {
  listitem: ['list', 'group'],
  option: ['listbox', 'group'],
  tab: ['tablist'],
  treeitem: ['tree', 'group'],
  menuitem: ['menu', 'menubar', 'group'],
  row: ['table', 'grid', 'treegrid', 'rowgroup'],
};

// ── 4.1.1 Parsing ────────────────────────────────────────────────────────────

const uniqueIds = documentRule({
  id: 'unique-ids',
  title: 'Element ids are unique',
  help: 'Duplicate ids break every ARIA relationship and label association that points at them — the browser resolves only the first.',
  criteria: ['4.1.1'],
  impact: 'serious',
  techniques: ['H93', 'F77'],
  evaluate: (context) => {
    const withId = Array.from(context.document.querySelectorAll('[id]'));
    const seen = new Map<string, Element[]>();

    for (const element of withId) {
      const id = element.getAttribute('id') ?? '';
      if (id.trim().length === 0) continue;
      const bucket = seen.get(id) ?? [];
      bucket.push(element);
      seen.set(id, bucket);
    }

    const issues: DocumentIssue[] = [];
    for (const [id, elements] of seen) {
      if (elements.length < 2) continue;
      issues.push({
        element: elements[1] as Element,
        outcome: 'failed',
        message: `id="${id}" is used ${elements.length} times. Only the first occurrence can ever be referenced.`,
        remediation:
          'Make every id unique. Check any label[for], aria-labelledby or aria-describedby pointing at this id — they are silently resolving to the wrong element.',
      });
    }

    return { elementsTested: withId.length, issues };
  },
});

const noDuplicateAccesskey = documentRule({
  id: 'unique-accesskey',
  title: 'Access keys are unique',
  help: 'Two elements claiming the same access key makes the shortcut ambiguous and unusable.',
  criteria: ['4.1.1'],
  impact: 'minor',
  evaluate: (context) => {
    const elements = Array.from(context.document.querySelectorAll('[accesskey]'));
    const seen = new Map<string, Element[]>();

    for (const element of elements) {
      const key = (element.getAttribute('accesskey') ?? '').trim().toLowerCase();
      if (key.length === 0) continue;
      const bucket = seen.get(key) ?? [];
      bucket.push(element);
      seen.set(key, bucket);
    }

    const issues: DocumentIssue[] = [];
    for (const [key, group] of seen) {
      if (group.length < 2) continue;
      issues.push({
        element: group[1] as Element,
        outcome: 'failed',
        message: `accesskey="${key}" is assigned to ${group.length} elements.`,
        remediation: 'Give each access key to a single element, or remove them — access keys often clash with assistive technology shortcuts.',
      });
    }

    return { elementsTested: elements.length, issues };
  },
});

// ── 4.1.2 Name, Role, Value ──────────────────────────────────────────────────

const validRole = elementRule({
  id: 'valid-aria-role',
  title: 'ARIA roles are valid',
  help: 'An unrecognised role is ignored, silently leaving the element with whatever role it had — usually none at all.',
  criteria: ['4.1.2'],
  impact: 'serious',
  techniques: ['ARIA4'],
  selector: '[role]',
  evaluate: (element) => {
    const raw = (element.getAttribute('role') ?? '').trim().toLowerCase();
    if (raw.length === 0) {
      return {
        outcome: 'failed',
        message: 'This element has an empty role attribute.',
        remediation: 'Remove the attribute, or set it to a valid ARIA role.',
        impact: 'minor',
      };
    }

    const tokens = raw.split(/\s+/);
    const invalid = tokens.filter((t) => !VALID_ROLES.has(t) && !ABSTRACT_ROLES.has(t));
    const abstract = tokens.filter((t) => ABSTRACT_ROLES.has(t));

    if (abstract.length > 0) {
      return {
        outcome: 'failed',
        message: `role="${abstract.join(' ')}" is an abstract role, which must never be used in markup.`,
        remediation: 'Replace it with a concrete role that describes what the element actually is.',
      };
    }

    if (invalid.length === tokens.length) {
      return {
        outcome: 'failed',
        message: `role="${raw}" is not a recognised ARIA role, so it is ignored entirely.`,
        remediation: 'Use a valid WAI-ARIA role, or remove the attribute and use the matching native HTML element.',
      };
    }

    return PASS;
  },
});

const validAriaAttributes = elementRule({
  id: 'valid-aria-attribute-values',
  title: 'ARIA state values are valid',
  help: 'aria-expanded="yes" is not a boolean. Invalid values are dropped, so the state is never communicated.',
  criteria: ['4.1.2'],
  impact: 'serious',
  techniques: ['ARIA5'],
  selector: '*',
  filter: (element) =>
    Array.from(element.attributes ?? []).some((attr) => attr.name.startsWith('aria-')),
  evaluate: (element) => {
    const problems: string[] = [];

    for (const attribute of Array.from(element.attributes ?? [])) {
      const name = attribute.name.toLowerCase();
      const allowed = ARIA_ENUMS[name];
      if (!allowed) continue;

      const value = attribute.value.trim().toLowerCase();
      if (value.length === 0) {
        problems.push(`${name} is empty`);
        continue;
      }
      if (!allowed.includes(value)) {
        problems.push(`${name}="${attribute.value}" (expected ${allowed.join(', ')})`);
      }
    }

    if (problems.length === 0) return PASS;

    return {
      outcome: 'failed',
      message: `Invalid ARIA state value(s): ${problems.join('; ')}.`,
      remediation: 'Use one of the values the attribute defines. Invalid values are ignored by browsers, so the state goes unannounced.',
    };
  },
});

const requiredAriaProperties = elementRule({
  id: 'required-aria-properties',
  title: 'ARIA widgets declare their required state',
  help: 'role="checkbox" without aria-checked is a checkbox whose state is never announced.',
  criteria: ['4.1.2'],
  impact: 'critical',
  techniques: ['ARIA5'],
  selector: '[role]',
  filter: visible,
  evaluate: (element) => {
    const role = (element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    const required = REQUIRED_ARIA_PROPERTIES[role];
    if (!required) return SKIP;

    // Native semantics can supply the state — <input type=checkbox role=checkbox>
    // is redundant but not broken, because the browser reports checkedness.
    if (role === 'checkbox' && tagOf(element) === 'input') return PASS;
    if (role === 'heading' && /^h[1-6]$/.test(tagOf(element))) return PASS;

    const missing = required.filter((attribute) => !element.hasAttribute(attribute));
    if (missing.length === 0) return PASS;

    return {
      outcome: 'failed',
      message: `role="${role}" requires ${missing.join(' and ')}, which ${missing.length === 1 ? 'is' : 'are'} missing, so the control's state is never announced.`,
      remediation: `Add ${missing.join(' and ')} and keep the value in sync with the control's visual state.`,
    };
  },
});

const widgetHasName = elementRule({
  id: 'widget-has-accessible-name',
  title: 'Interactive controls have an accessible name',
  help: 'A control with no name is announced by its role alone — "button" — which tells the user nothing about what it does.',
  criteria: ['4.1.2'],
  impact: 'critical',
  techniques: ['ARIA6', 'ARIA14'],
  selector: 'button, [role], summary',
  filter: (element) => {
    if (!visible(element)) return false;
    const role = computeRole(element);
    if (role === null) return false;
    if (!ROLES_REQUIRING_NAME.has(role)) return false;
    // Links and form fields are covered by their own, more specific rules, so
    // we do not report the same problem twice under two rule ids.
    if (role === 'link') return false;
    if (['input', 'select', 'textarea', 'a'].includes(tagOf(element))) return false;
    return true;
  },
  evaluate: (element) => {
    const role = computeRole(element);
    if (accessibleName(element).value.length > 0) return PASS;

    return {
      outcome: 'failed',
      message: `This ${role} has no accessible name, so assistive technology announces only its role.`,
      remediation:
        'Put text inside the element, or add an aria-label / aria-labelledby describing what it does.',
    };
  },
});

const requiredOwnedElements = elementRule({
  id: 'aria-required-children',
  title: 'Composite widgets contain the children their role requires',
  help: 'role="tablist" containing anything other than tabs breaks keyboard navigation and the position announcements ("tab 2 of 5").',
  criteria: ['1.3.1', '4.1.2'],
  impact: 'serious',
  techniques: ['ARIA5'],
  selector: '[role]',
  filter: visible,
  evaluate: (element) => {
    const role = (element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    const allowed = REQUIRED_CHILDREN[role];
    if (!allowed) return SKIP;

    // aria-owns can supply children from elsewhere in the document; we cannot
    // reliably rebuild that tree, so we stand down rather than guess.
    if (element.hasAttribute('aria-owns')) return SKIP;
    if (element.hasAttribute('aria-busy')) return SKIP;

    const children = Array.from(element.children).filter(visible);
    if (children.length === 0) return SKIP;

    const offenders = children.filter((child) => {
      const childRole = computeRole(child);
      if (childRole === null) return false;
      if (allowed.includes(childRole)) return false;
      // A generic wrapper is tolerated when it in turn holds valid children.
      if (childRole === 'generic' || childRole === 'presentation' || childRole === 'none') {
        return !Array.from(child.children).some((g) => allowed.includes(computeRole(g) ?? ''));
      }
      return true;
    });

    if (offenders.length === 0) return PASS;

    return {
      outcome: 'failed',
      message: `role="${role}" requires children with role ${allowed.join(' or ')}, but ${offenders.length} child element(s) have a different role.`,
      remediation: `Give the direct children role="${allowed[0]}", or use the matching native HTML structure instead.`,
    };
  },
});

const requiredParentRole = elementRule({
  id: 'aria-required-parent',
  title: 'Widget children live inside the right container',
  help: 'A role="option" outside a listbox is orphaned — the user is never told which list it belongs to or how many there are.',
  criteria: ['1.3.1', '4.1.2'],
  impact: 'serious',
  selector: '[role]',
  filter: visible,
  evaluate: (element) => {
    const role = (element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    const allowedParents = REQUIRED_PARENT[role];
    if (!allowedParents) return SKIP;

    let parent = element.parentElement;
    while (parent) {
      const parentRole = computeRole(parent);
      if (parentRole && allowedParents.includes(parentRole)) return PASS;
      // Stop at the first non-transparent ancestor role.
      if (parentRole && !['generic', 'presentation', 'none', 'group', 'rowgroup'].includes(parentRole)) {
        break;
      }
      parent = parent.parentElement;
    }

    /*
     * aria-owns elsewhere in the document can legitimately adopt this element.
     * The attribute value is scanned rather than interpolated into a selector:
     * an id containing quotes or selector metacharacters would otherwise throw
     * (or worse, match the wrong thing).
     */
    const doc = element.ownerDocument;
    const id = element.getAttribute('id');
    if (doc && id) {
      const adopted = Array.from(doc.querySelectorAll('[aria-owns]')).some((owner) =>
        (owner.getAttribute('aria-owns') ?? '').split(/\s+/).includes(id),
      );
      if (adopted) return PASS;
    }

    return {
      outcome: 'failed',
      message: `role="${role}" must be contained in an element with role ${allowedParents.join(' or ')}, but no such ancestor was found.`,
      remediation: `Wrap this element in a container with role="${allowedParents[0]}", or use the equivalent native HTML element.`,
    };
  },
});

const presentationRoleConflict = elementRule({
  id: 'no-presentation-on-focusable',
  title: 'Interactive elements are not marked presentational',
  help: 'role="presentation" on a focusable element strips its semantics while leaving it in the tab order.',
  criteria: ['4.1.2'],
  impact: 'serious',
  techniques: ['F92'],
  selector: '[role="presentation"], [role="none"]',
  evaluate: (element) => {
    const tag = tagOf(element);
    // `isFocusable` rather than a tag list: it understands `<a>` without an
    // `href`, `tabindex="-1"`, `disabled` and hidden elements, none of which
    // a naive list gets right.
    const focusable = isFocusable(element);

    if (!focusable) return PASS;

    return {
      outcome: 'failed',
      message: `This <${tag}> is marked role="presentation" but is still focusable, so keyboard users land on an element with no announced role or name.`,
      remediation:
        'Remove role="presentation". If the element really is decorative, make it a non-interactive element and remove it from the tab order.',
    };
  },
});

// ── 4.1.3 Status Messages ────────────────────────────────────────────────────

const statusMessageRegions = documentRule({
  id: 'status-message-region',
  title: 'Status updates are announced',
  help: 'A "3 results found" message that appears without a live region is never announced — the user has no idea anything happened.',
  criteria: ['4.1.3'],
  impact: 'moderate',
  techniques: ['ARIA22', 'ARIA19'],
  evaluate: (context) => {
    const liveRegions = Array.from(
      context.document.querySelectorAll(
        '[role="status"], [role="alert"], [role="log"], [aria-live], output',
      ),
    );

    const issues: DocumentIssue[] = [];

    for (const region of liveRegions) {
      const live = (region.getAttribute('aria-live') ?? '').trim().toLowerCase();
      const role = (region.getAttribute('role') ?? '').trim().toLowerCase();

      // aria-live="assertive" interrupts whatever the user is reading. It is
      // for genuine emergencies, and it is very widely misused.
      if (live === 'assertive' && role !== 'alert') {
        issues.push({
          element: region,
          outcome: 'cantTell',
          message:
            'This live region is assertive, which interrupts the screen reader mid-sentence. That is only appropriate for time-critical messages.',
          remediation: 'Use aria-live="polite" unless the message genuinely cannot wait, such as a session-expiry warning.',
          impact: 'minor',
        });
      }

      // A live region that starts with content already in it will announce
      // that content on load, which is rarely what the author intended.
      if ((region.textContent ?? '').trim().length > 0 && (live === 'assertive' || role === 'alert')) {
        issues.push({
          element: region,
          outcome: 'cantTell',
          message: 'This alert region already contains text in the initial markup, so it may be announced immediately on page load.',
          remediation: 'Render the live region empty and inject its content when the status actually changes.',
          impact: 'minor',
        });
      }
    }

    // A form with client-side validation but no live region anywhere is a
    // strong signal that error messages will go unannounced.
    const hasForm = context.document.querySelector('form') !== null;
    if (hasForm && liveRegions.length === 0) {
      issues.push({
        element: null,
        outcome: 'cantTell',
        message: 'This page has a form but no live region. If validation errors or success messages appear without a page reload, they will not be announced.',
        remediation:
          'Add a container with role="status" (or role="alert" for errors) and write status messages into it as they occur.',
      });
    }

    return { elementsTested: liveRegions.length + (hasForm ? 1 : 0), issues };
  },
});

export const robustRules: readonly Rule[] = [
  uniqueIds,
  noDuplicateAccesskey,
  validRole,
  validAriaAttributes,
  requiredAriaProperties,
  widgetHasName,
  requiredOwnedElements,
  requiredParentRole,
  presentationRoleConflict,
  statusMessageRegions,
];
