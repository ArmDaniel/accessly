import { describe, expect, it } from 'vitest';
import { getCriterion, SUCCESS_CRITERIA, type ConformanceLevel } from '@accessly/contracts';
import { auditHtml } from '../src/audit.js';
import { defaultRegistry, allRules } from '../src/rules/index.js';

/**
 * Rule tests.
 *
 * Every rule gets a page that should trigger it and a page that should not.
 * The "should not" half is the one that matters most: a rule that fires on
 * correct markup is worse than no rule, because it teaches users to dismiss the
 * whole report.
 */

interface Options {
  target?: ConformanceLevel;
  full?: boolean;
}

/** Wrap a body fragment in a document that is otherwise clean. */
function page(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><title>An adequately descriptive title</title>${head}</head><body>${body}</body></html>`;
}

function findingsFor(ruleId: string, html: string, options: Options = {}) {
  const report = auditHtml({
    html,
    url: 'https://example.test/page',
    target: options.target ?? 'AA',
    only: [ruleId],
  });
  return report.findings;
}

/**
 * Assert the rule fired, and return its message *and* remediation.
 *
 * Both matter: the message has to say what is wrong and the remediation has to
 * say how to fix it. A rule whose remediation just restates the problem is not
 * doing its job, so tests assert against whichever half carries the claim.
 */
function expectFires(ruleId: string, html: string, options?: Options): string {
  const findings = findingsFor(ruleId, html, options);
  expect(findings, `${ruleId} should have reported an issue`).not.toHaveLength(0);
  const finding = findings[0]!;
  return `${finding.message} ${finding.remediation}`;
}

function expectClean(ruleId: string, html: string, options?: Options): void {
  const messages = findingsFor(ruleId, html, options).map((f) => f.message);
  expect(messages, `${ruleId} should not have reported an issue`).toEqual([]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('rule registry', () => {
  it('registers every rule with a unique id', () => {
    const ids = allRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(defaultRegistry.size).toBe(allRules.length);
  });

  it('gives every rule at least one WCAG 2.1 criterion that actually exists', () => {
    for (const rule of allRules) {
      expect(rule.criteria.length, `${rule.id} cites no criteria`).toBeGreaterThan(0);
      for (const criterion of rule.criteria) {
        // Throws if the criterion is not in the published Recommendation.
        expect(() => getCriterion(criterion)).not.toThrow();
      }
    }
  });

  it('gives every rule an id, title and help text written for a human', () => {
    for (const rule of allRules) {
      expect(rule.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(rule.title.length).toBeGreaterThan(8);
      // The help text should be a sentence, not a restatement of the id.
      expect(rule.help.length).toBeGreaterThan(30);
    }
  });

  it('rejects a rule citing a criterion outside WCAG 2.1', () => {
    expect(() =>
      defaultRegistry.register({
        kind: 'document',
        id: 'bogus-rule',
        title: 'Bogus',
        help: 'A rule that cites a criterion which does not exist in WCAG 2.1.',
        criteria: ['2.4.11'], // WCAG 2.2
        impact: 'minor',
        evaluate: () => ({ elementsTested: 0, issues: [] }),
      }),
    ).toThrowError(/Unknown WCAG 2\.1 success criterion/);
  });

  it('rejects a duplicate rule id', () => {
    expect(() =>
      defaultRegistry.register({
        kind: 'document',
        id: 'page-has-title',
        title: 'Duplicate',
        help: 'A rule whose id collides with one that is already registered.',
        criteria: ['2.4.2'],
        impact: 'minor',
        evaluate: () => ({ elementsTested: 0, issues: [] }),
      }),
    ).toThrowError(/Duplicate rule id/);
  });

  it('only runs rules whose criteria are obligatory at the target level', () => {
    const atA = defaultRegistry.forLevel('A').map((r) => r.id);
    const atAAA = defaultRegistry.forLevel('AAA').map((r) => r.id);

    // text-contrast-enhanced cites only 1.4.6, which is AAA.
    expect(atA).not.toContain('text-contrast-enhanced');
    expect(atAAA).toContain('text-contrast-enhanced');
    // text-contrast cites 1.4.3 (AA) so it is out of scope at level A.
    expect(atA).not.toContain('text-contrast');
    expect(defaultRegistry.forLevel('AA').map((r) => r.id)).toContain('text-contrast');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.1.1 Non-text Content
// ─────────────────────────────────────────────────────────────────────────────

describe('1.1.1 Non-text Content', () => {
  it('flags an image with no alt attribute', () => {
    const message = expectFires('image-alt', page('<main><img src="cat.png"></main>'));
    expect(message).toMatch(/no alt attribute/i);
  });

  it('accepts alt="" as a deliberate decorative marking', () => {
    // This is the case naive checkers get wrong. alt="" is correct, not missing.
    expectClean('image-alt', page('<main><img src="divider.png" alt=""></main>'));
  });

  it('flags alt="" combined with a contradicting role', () => {
    expectFires('image-alt', page('<main><img src="a.png" alt="" role="img"></main>'));
  });

  it('flags alt text that describes the file rather than the image', () => {
    expectFires('image-alt', page('<main><img src="a.png" alt="image1"></main>'));
    expectFires('image-alt', page('<main><img src="a.png" alt="photo.jpg"></main>'));
    expectClean('image-alt', page('<main><img src="a.png" alt="A tabby cat asleep on a keyboard"></main>'));
  });

  it('accepts an image named by aria-label', () => {
    expectClean('image-alt', page('<main><img src="a.png" aria-label="Company logo"></main>'));
  });

  it('skips images that are hidden from assistive technology', () => {
    expectClean('image-alt', page('<main><img src="a.png" aria-hidden="true"></main>'));
  });

  it('flags an unnamed image button', () => {
    expectFires('input-image-alt', page('<main><form><input type="image" src="go.png"></form></main>'));
    expectClean(
      'input-image-alt',
      page('<main><form><input type="image" src="go.png" alt="Search"></form></main>'),
    );
  });

  it('flags an svg with no name and no decorative marking', () => {
    expectFires('svg-has-name', page('<main><svg><path d="M0 0"/></svg></main>'));
    expectClean('svg-has-name', page('<main><svg aria-hidden="true"><path d="M0 0"/></svg></main>'));
    expectClean('svg-has-name', page('<main><svg><title>Chart of Q3 sales</title></svg></main>'));
  });

  it('does not flag an icon inside an already-named control', () => {
    expectClean(
      'svg-has-name',
      page('<main><button aria-label="Close"><svg><path d="M0 0"/></svg></button></main>'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.2.x Time-based media
// ─────────────────────────────────────────────────────────────────────────────

describe('1.2.2 Captions', () => {
  it('flags a video with no captions track', () => {
    expectFires('video-captions', page('<main><video src="v.mp4"></video></main>'));
  });

  it('does not accept subtitles in place of captions', () => {
    // Subtitles translate dialogue; captions include non-speech audio. They are
    // not interchangeable and the rule must not treat them as such.
    const message = expectFires(
      'video-captions',
      page('<main><video src="v.mp4"><track kind="subtitles" srclang="fr"></video></main>'),
    );
    expect(message).toMatch(/captions/i);
  });

  it('accepts a captions track', () => {
    expectClean(
      'video-captions',
      page('<main><video src="v.mp4"><track kind="captions" srclang="en" src="c.vtt"></video></main>'),
    );
  });
});

describe('1.4.2 Audio Control', () => {
  it('flags autoplaying media with no controls', () => {
    expectFires('no-autoplay-audio', page('<main><audio src="a.mp3" autoplay></audio></main>'));
  });

  it('accepts muted autoplay', () => {
    expectClean('no-autoplay-audio', page('<main><video src="v.mp4" autoplay muted></video></main>'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.3.1 Info and Relationships
// ─────────────────────────────────────────────────────────────────────────────

describe('1.3.1 Info and Relationships', () => {
  it('flags a form field with no label', () => {
    expectFires('form-field-has-label', page('<main><form><input type="text" name="q"></form></main>'));
  });

  it('flags a placeholder used in place of a label', () => {
    const message = expectFires(
      'form-field-has-label',
      page('<main><form><input type="text" placeholder="Email"></form></main>'),
    );
    expect(message).toMatch(/placeholder/i);
  });

  it('accepts a label associated by for/id', () => {
    expectClean(
      'form-field-has-label',
      page('<main><form><label for="e">Email</label><input id="e" type="email"></form></main>'),
    );
  });

  it('accepts a wrapping label', () => {
    expectClean(
      'form-field-has-label',
      page('<main><form><label>Email <input type="email"></label></form></main>'),
    );
  });

  it('does not require a label on a submit button', () => {
    expectClean('form-field-has-label', page('<main><form><input type="submit" value="Go"></form></main>'));
  });

  it('flags a label pointing at an id that does not exist', () => {
    const message = expectFires(
      'label-for-resolves',
      page('<main><form><label for="nope">Email</label><input id="e"></form></main>'),
    );
    expect(message).toMatch(/no element with that id/i);
  });

  it('flags ARIA references that do not resolve', () => {
    const message = expectFires(
      'aria-reference-resolves',
      page('<main><button aria-labelledby="ghost">x</button></main>'),
    );
    expect(message).toMatch(/aria-labelledby="ghost"/);
  });

  it('flags non-li children of a list', () => {
    expectFires('list-structure', page('<main><ul><li>a</li><div>b</div></ul></main>'));
    expectClean('list-structure', page('<main><ul><li>a</li><li>b</li></ul></main>'));
  });

  it('permits script and template inside a list', () => {
    expectClean('list-structure', page('<main><ul><li>a</li><script></script></ul></main>'));
  });

  it('flags a data table with no header cells', () => {
    expectFires(
      'data-table-has-headers',
      page('<main><table><tr><td>Jan</td><td>10</td></tr><tr><td>Feb</td><td>20</td></tr></table></main>'),
    );
  });

  it('exempts a table explicitly marked presentational', () => {
    expectClean(
      'data-table-has-headers',
      page('<main><table role="presentation"><tr><td>a</td><td>b</td></tr></table></main>'),
    );
  });

  it('accepts a simple table with a single header row', () => {
    expectClean(
      'data-table-has-headers',
      page('<main><table><tr><th scope="col">Month</th><th scope="col">Sales</th></tr><tr><td>Jan</td><td>10</td></tr></table></main>'),
    );
  });

  it('flags a fieldset with no legend', () => {
    expectFires('fieldset-has-legend', page('<main><form><fieldset><input type="radio" name="a"></fieldset></form></main>'));
  });

  it('flags an ungrouped radio group', () => {
    const message = expectFires(
      'radio-group-is-grouped',
      page('<main><form><input type="radio" name="size" id="s"><label for="s">S</label><input type="radio" name="size" id="m"><label for="m">M</label></form></main>'),
    );
    expect(message).toMatch(/not wrapped in a named group/i);
  });

  it('accepts radios inside a fieldset with a legend', () => {
    expectClean(
      'radio-group-is-grouped',
      page('<main><form><fieldset><legend>Size</legend><input type="radio" name="size"><input type="radio" name="size"></fieldset></form></main>'),
    );
  });

  it('does not flag a single radio, which is not a group', () => {
    expectClean('radio-group-is-grouped', page('<main><form><input type="radio" name="only"></form></main>'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.3.5 Identify Input Purpose
// ─────────────────────────────────────────────────────────────────────────────

describe('1.3.5 Identify Input Purpose', () => {
  it('flags a personal-data field with no autocomplete token', () => {
    const message = expectFires(
      'input-autocomplete',
      page('<main><form><label for="e">Email</label><input id="e" name="email" type="email"></form></main>'),
    );
    expect(message).toMatch(/autocomplete="email"/);
  });

  it('flags autocomplete="off" on a personal-data field', () => {
    expectFires(
      'input-autocomplete',
      page('<main><form><label for="e">Email</label><input id="e" name="email" autocomplete="off"></form></main>'),
    );
  });

  it('accepts a correct token', () => {
    expectClean(
      'input-autocomplete',
      page('<main><form><label for="e">Email</label><input id="e" name="email" autocomplete="email"></form></main>'),
    );
  });

  it('ignores fields that do not collect information about the user', () => {
    expectClean(
      'input-autocomplete',
      page('<main><form><label for="q">Search</label><input id="q" name="query"></form></main>'),
    );
  });

  it('flags a nonsense token that browsers will discard', () => {
    const message = expectFires(
      'input-autocomplete',
      page('<main><form><label for="e">Email</label><input id="e" name="email" autocomplete="banana"></form></main>'),
    );
    expect(message).toMatch(/not a valid autocomplete token/);
  });

  it('accepts scoped and modified tokens', () => {
    expectClean(
      'input-autocomplete',
      page('<main><form><label for="e">Email</label><input id="e" name="email" autocomplete="shipping section-primary email home"></form></main>'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.4.3 Contrast
// ─────────────────────────────────────────────────────────────────────────────

describe('1.4.3 Contrast (Minimum)', () => {
  it('flags body text below 4.5:1', () => {
    const message = expectFires(
      'text-contrast',
      page('<main><p style="color:#999999;background-color:#ffffff">Hard to read</p></main>'),
    );
    expect(message).toMatch(/2\.8[0-9]?:1/);
    expect(message).toMatch(/4\.5:1/);
  });

  it('accepts body text at or above 4.5:1', () => {
    expectClean(
      'text-contrast',
      page('<main><p style="color:#767676;background-color:#ffffff">Just enough</p></main>'),
    );
  });

  it('applies the 3:1 threshold to large text', () => {
    // #949494 on white is ~3.1:1 — fails as body text, passes as large text.
    expectFires(
      'text-contrast',
      page('<main><p style="color:#949494;background-color:#fff">Body</p></main>'),
    );
    expectClean(
      'text-contrast',
      page('<main><p style="color:#949494;background-color:#fff;font-size:24px">Large</p></main>'),
    );
  });

  it('treats 14pt bold as large text', () => {
    expectClean(
      'text-contrast',
      page('<main><p style="color:#949494;background-color:#fff;font-size:19px;font-weight:700">Bold</p></main>'),
    );
  });

  it('inherits colour from an ancestor', () => {
    expectFires(
      'text-contrast',
      page('<main style="color:#aaaaaa;background-color:#ffffff"><p>Inherited</p></main>'),
    );
  });

  it('reports cantTell rather than guessing when the colour is not declared', () => {
    const report = auditHtml({
      html: page('<main><p>Undeclared colours</p></main>'),
      url: 'https://example.test/',
      only: ['text-contrast'],
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.outcome).toBe('cantTell');
    expect(report.findings[0]?.message).toMatch(/could not be verified/i);
  });

  it('does not report the same text once per ancestor', () => {
    const messages = findingsFor(
      'text-contrast',
      page('<main><div><section><p style="color:#999;background:#fff">Once</p></section></div></main>'),
    );
    expect(messages).toHaveLength(1);
  });

  it('applies the stricter AAA threshold only when targeting AAA', () => {
    // #5f5f5f on white is ~6.4:1 — passes AA, fails AAA.
    const html = page('<main><p style="color:#5f5f5f;background-color:#ffffff">Text</p></main>');
    expectClean('text-contrast', html, { target: 'AA' });
    expectFires('text-contrast-enhanced', html, { target: 'AAA' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.4.4 / 1.4.10 Zoom and reflow
// ─────────────────────────────────────────────────────────────────────────────

describe('1.4.4 Resize text', () => {
  it('flags user-scalable=no', () => {
    const message = expectFires(
      'meta-viewport-scalable',
      page('<main>x</main>', '<meta name="viewport" content="width=device-width, user-scalable=no">'),
    );
    expect(message).toMatch(/user-scalable=no/);
  });

  it('flags maximum-scale below 2', () => {
    expectFires(
      'meta-viewport-scalable',
      page('<main>x</main>', '<meta name="viewport" content="width=device-width, maximum-scale=1">'),
    );
  });

  it('accepts a viewport tag that does not restrict zoom', () => {
    expectClean(
      'meta-viewport-scalable',
      page('<main>x</main>', '<meta name="viewport" content="width=device-width, initial-scale=1">'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.1.1 Keyboard
// ─────────────────────────────────────────────────────────────────────────────

describe('2.1.1 Keyboard', () => {
  it('flags a div with a click handler and no keyboard affordance', () => {
    const message = expectFires('clickable-keyboard-operable', page('<main><div onclick="go()">Go</div></main>'));
    expect(message).toMatch(/keyboard focus/i);
  });

  it('accepts a native button with a click handler', () => {
    expectClean('clickable-keyboard-operable', page('<main><button onclick="go()">Go</button></main>'));
  });

  it('accepts a div that has been given the full set of affordances', () => {
    expectClean(
      'clickable-keyboard-operable',
      page('<main><div onclick="go()" onkeydown="k(event)" role="button" tabindex="0">Go</div></main>'),
    );
  });

  it('flags focusable content inside an aria-hidden container', () => {
    const message = expectFires(
      'focusable-not-aria-hidden',
      page('<main><div aria-hidden="true"><a href="/x">Still tabbable</a></div></main>'),
    );
    expect(message).toMatch(/focusable/i);
  });

  it('accepts an aria-hidden container whose contents are out of the tab order', () => {
    expectClean(
      'focusable-not-aria-hidden',
      page('<main><div aria-hidden="true"><a href="/x" tabindex="-1">x</a></div></main>'),
    );
  });
});

describe('2.4.3 Focus Order', () => {
  it('flags a positive tabindex', () => {
    const message = expectFires('no-positive-tabindex', page('<main><button tabindex="3">x</button></main>'));
    expect(message).toMatch(/tabindex="3"/);
  });

  it('accepts tabindex 0 and -1', () => {
    expectClean('no-positive-tabindex', page('<main><div tabindex="0">x</div><div tabindex="-1">y</div></main>'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.2.x Enough time
// ─────────────────────────────────────────────────────────────────────────────

describe('2.2.1 Timing Adjustable', () => {
  it('flags a timed meta refresh', () => {
    expectFires('no-meta-refresh', page('<main>x</main>', '<meta http-equiv="refresh" content="30">'));
  });

  it('permits an immediate redirect, which WCAG explicitly allows', () => {
    expectClean('no-meta-refresh', page('<main>x</main>', '<meta http-equiv="refresh" content="0;url=/new">'));
  });

  it('reports a malformed delay as undetermined rather than "NaN seconds"', () => {
    const message = expectFires(
      'no-meta-refresh',
      page('<main>x</main>', '<meta http-equiv="refresh" content="url=/new">'),
    );
    expect(message).not.toMatch(/NaN/);
    expect(message).toMatch(/could not be determined/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.4 Navigable
// ─────────────────────────────────────────────────────────────────────────────

describe('2.4.1 Bypass Blocks', () => {
  it('flags a page with navigation but no skip link', () => {
    const findings = findingsFor(
      'bypass-blocks',
      page('<header><nav><a href="/a">A</a></nav></header><main><h1>x</h1></main>'),
    );
    expect(findings.some((f) => /skip to main content/i.test(f.message))).toBe(true);
  });

  it('flags a page with no main landmark', () => {
    const findings = findingsFor('bypass-blocks', page('<div><h1>x</h1></div>'));
    expect(findings.some((f) => /no <main> landmark/i.test(f.message))).toBe(true);
  });

  it('accepts a page with a working skip link and a main landmark', () => {
    expectClean(
      'bypass-blocks',
      page(
        '<a href="#c">Skip to main content</a><header><nav><a href="/a">A</a></nav></header><main id="c"><h1>x</h1></main>',
      ),
    );
  });
});

describe('2.4.2 Page Titled', () => {
  it('flags a missing title', () => {
    expectFires('page-has-title', '<!doctype html><html lang="en"><body><main>x</main></body></html>');
  });

  it('flags a placeholder title', () => {
    expectFires(
      'page-has-title',
      '<!doctype html><html lang="en"><head><title>Untitled</title></head><body><main>x</main></body></html>',
    );
  });

  it('accepts a descriptive title', () => {
    expectClean('page-has-title', page('<main>x</main>'));
  });
});

describe('2.4.4 Link Purpose', () => {
  it('flags a link with no accessible name', () => {
    expectFires('link-has-name', page('<main><a href="/x"><svg aria-hidden="true"></svg></a></main>'));
  });

  it('accepts a link named by aria-label', () => {
    expectClean('link-has-name', page('<main><a href="/x" aria-label="View basket"><svg aria-hidden="true"></svg></a></main>'));
  });

  it('raises a review item for non-descriptive link text', () => {
    const report = auditHtml({
      html: page('<main><a href="/a">Read more</a></main>'),
      url: 'https://example.test/',
      only: ['link-text-descriptive'],
    });
    // 2.4.4 allows context to supply meaning, so this cannot be a hard failure.
    expect(report.findings[0]?.outcome).toBe('cantTell');
  });

  it('flags two links with the same name going to different places', () => {
    const message = expectFires(
      'identical-links-same-purpose',
      page('<main><a href="/a">Download</a><a href="/b">Download</a></main>'),
    );
    expect(message).toMatch(/different destinations/i);
  });

  it('accepts repeated links to the same destination', () => {
    expectClean(
      'identical-links-same-purpose',
      page('<main><a href="/a">Download</a><a href="/a">Download</a></main>'),
    );
  });

  it('treats absolute, relative and rooted hrefs to one page as the same destination', () => {
    expectClean(
      'identical-links-same-purpose',
      page('<main><a href="/about">About</a><a href="https://example.test/about">About</a><a href="about">About</a></main>'),
    );
  });

  it('ignores fragments when comparing destinations', () => {
    expectClean(
      'identical-links-same-purpose',
      page('<main><a href="/about">About</a><a href="/about#team">About</a></main>'),
    );
  });

  it('flags an unannounced new window', () => {
    // 3.2.5 Change on Request is a level AAA criterion, so this rule is only in
    // scope when the audit targets AAA. Running it at AA would be reporting a
    // failure against an obligation the customer did not take on.
    const options = { target: 'AAA' } as const;
    expectFires('new-window-warned', page('<main><a href="/x" target="_blank">Report</a></main>'), options);
    expectClean(
      'new-window-warned',
      page('<main><a href="/x" target="_blank">Report (opens in a new window)</a></main>'),
      options,
    );
  });

  it('is out of scope when the audit targets level AA', () => {
    expectClean('new-window-warned', page('<main><a href="/x" target="_blank">Report</a></main>'), {
      target: 'AA',
    });
  });
});

describe('2.4.6 Headings and Labels', () => {
  it('flags an empty heading', () => {
    expectFires('heading-has-text', page('<main><h2></h2></main>'));
  });

  it('flags a skipped heading level', () => {
    const message = expectFires('heading-order', page('<main><h1>a</h1><h2>b</h2><h4>c</h4></main>'));
    expect(message).toMatch(/h4.*h2/);
  });

  it('accepts headings that descend one level at a time', () => {
    expectClean('heading-order', page('<main><h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2></main>'));
  });

  it('flags a page with no h1 and a page with several', () => {
    expectFires('page-has-one-h1', page('<main><h2>a</h2></main>'));
    expectFires('page-has-one-h1', page('<main><h1>a</h1><h1>b</h1></main>'));
    expectClean('page-has-one-h1', page('<main><h1>a</h1><h2>b</h2></main>'));
  });
});

describe('2.4.7 Focus Visible', () => {
  it('flags an inline outline:none on a focusable element', () => {
    expectFires('focus-visible', page('<main><button style="outline:none">x</button></main>'));
  });

  it('flags a :focus rule that removes the outline with no replacement', () => {
    expectFires('focus-visible', page('<main><button>x</button></main>', '<style>a:focus { outline: none; }</style>'));
  });

  it('accepts a :focus rule that substitutes another visible indicator', () => {
    expectClean(
      'focus-visible',
      page('<main><button>x</button></main>', '<style>a:focus { outline: none; box-shadow: 0 0 0 3px #000; }</style>'),
    );
  });

  it('does not mistake :focus-within for a focus indicator rule', () => {
    // :focus-within styles the *container* of the focused element; it is not
    // an outline removal on the focusable element itself and must not fire 2.4.7.
    expectClean(
      'focus-visible',
      page('<main><button>x</button></main>', '<style>div:focus-within { outline: none; }</style>'),
    );
  });
});

describe('2.5.3 Label in Name', () => {
  it('flags an accessible name that does not contain the visible label', () => {
    const message = expectFires(
      'label-in-name',
      page('<main><button aria-label="Submit form">Send</button></main>'),
    );
    expect(message).toMatch(/speech-input/i);
  });

  it('accepts an accessible name that extends the visible label', () => {
    expectClean('label-in-name', page('<main><button aria-label="Send message">Send</button></main>'));
  });

  it('ignores punctuation and case when comparing', () => {
    expectClean('label-in-name', page('<main><button aria-label="send message!">Send</button></main>'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.1 Readable
// ─────────────────────────────────────────────────────────────────────────────

describe('3.1.1 Language of Page', () => {
  it('flags a missing lang attribute', () => {
    expectFires(
      'page-has-lang',
      '<!doctype html><html><head><title>A descriptive title</title></head><body><main>x</main></body></html>',
    );
  });

  it('flags a language name in place of a language tag', () => {
    const message = expectFires(
      'page-has-lang',
      '<!doctype html><html lang="english"><head><title>A descriptive title</title></head><body><main>x</main></body></html>',
    );
    expect(message).toMatch(/not a valid BCP 47/i);
  });

  it('accepts a valid tag with a region subtag', () => {
    expectClean(
      'page-has-lang',
      '<!doctype html><html lang="ro-RO"><head><title>A descriptive title</title></head><body><main>x</main></body></html>',
    );
  });

  it('flags an invalid lang on an inline part', () => {
    expectFires('valid-lang-on-parts', page('<main><span lang="francais">bonjour</span></main>'));
    expectClean('valid-lang-on-parts', page('<main><span lang="fr">bonjour</span></main>'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.2 Predictable
// ─────────────────────────────────────────────────────────────────────────────

describe('3.2.2 On Input', () => {
  it('flags a select that submits on change', () => {
    const message = expectFires(
      'no-context-change-on-input',
      page('<main><form><label for="s">Country</label><select id="s" onchange="this.form.submit()"><option>a</option></select></form></main>'),
    );
    // The remediation must name the actual fix — a separate activation control,
    // which is WCAG technique H32 — not just restate the problem.
    expect(message).toMatch(/H32/);
    expect(message).toMatch(/"Go" button/);
  });

  it('accepts a change handler that does not change context', () => {
    expectClean(
      'no-context-change-on-input',
      page('<main><form><label for="s">Country</label><select id="s" onchange="updatePrice()"><option>a</option></select></form></main>'),
    );
  });
});

describe('3.2.1 On Focus', () => {
  it('flags navigation triggered by focus', () => {
    expectFires(
      'no-context-change-on-focus',
      page('<main><input onfocus="location.href=\'/next\'"></main>'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.3 Input Assistance
// ─────────────────────────────────────────────────────────────────────────────

describe('3.3.1 Error Identification', () => {
  it('flags an invalid field with no associated error text', () => {
    expectFires(
      'error-message-associated',
      page('<main><form><label for="e">Email</label><input id="e" aria-invalid="true"><p>Not a valid email</p></form></main>'),
    );
  });

  it('accepts an invalid field wired to its error message', () => {
    expectClean(
      'error-message-associated',
      page('<main><form><label for="e">Email</label><input id="e" aria-invalid="true" aria-describedby="err"><p id="err">Enter an email like name@example.com</p></form></main>'),
    );
  });
});

describe('3.3.2 Labels or Instructions', () => {
  it('flags a field whose label says required but which is not marked required', () => {
    expectFires(
      'required-field-marked',
      page('<main><form><label for="e">Email (required)</label><input id="e"></form></main>'),
    );
  });

  it('accepts a field that is marked required', () => {
    expectClean(
      'required-field-marked',
      page('<main><form><label for="e">Email (required)</label><input id="e" required></form></main>'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.1 Compatible
// ─────────────────────────────────────────────────────────────────────────────

describe('4.1.1 Parsing', () => {
  it('flags duplicate ids', () => {
    const message = expectFires('unique-ids', page('<main><div id="x"></div><div id="x"></div></main>'));
    expect(message).toMatch(/used 2 times/i);
  });

  it('accepts unique ids', () => {
    expectClean('unique-ids', page('<main><div id="x"></div><div id="y"></div></main>'));
  });

  it('flags a duplicated accesskey', () => {
    expectFires('unique-accesskey', page('<main><a href="/a" accesskey="s">a</a><a href="/b" accesskey="s">b</a></main>'));
  });
});

describe('4.1.2 Name, Role, Value', () => {
  it('flags an invented role', () => {
    const message = expectFires('valid-aria-role', page('<main><div role="clickable">x</div></main>'));
    expect(message).toMatch(/not a recognised ARIA role/i);
  });

  it('flags an abstract role', () => {
    const message = expectFires('valid-aria-role', page('<main><div role="widget">x</div></main>'));
    expect(message).toMatch(/abstract role/i);
  });

  it('accepts a valid role', () => {
    expectClean('valid-aria-role', page('<main><div role="button" tabindex="0" aria-label="x"></div></main>'));
  });

  it('flags an invalid ARIA state value', () => {
    const message = expectFires(
      'valid-aria-attribute-values',
      page('<main><button aria-expanded="yes">x</button></main>'),
    );
    expect(message).toMatch(/aria-expanded="yes"/);
  });

  it('accepts valid ARIA state values', () => {
    expectClean('valid-aria-attribute-values', page('<main><button aria-expanded="true">x</button></main>'));
  });

  it('flags a widget role missing its required state', () => {
    const message = expectFires(
      'required-aria-properties',
      page('<main><div role="checkbox" tabindex="0" aria-label="Accept">x</div></main>'),
    );
    expect(message).toMatch(/aria-checked/);
  });

  it('does not require aria-checked on a native checkbox', () => {
    expectClean(
      'required-aria-properties',
      page('<main><form><label for="c">Accept</label><input id="c" type="checkbox" role="checkbox"></form></main>'),
    );
  });

  it('flags a control with no accessible name', () => {
    expectFires('widget-has-accessible-name', page('<main><button></button></main>'));
    expectClean('widget-has-accessible-name', page('<main><button>Save</button></main>'));
  });

  it('flags a composite widget with the wrong children', () => {
    const message = expectFires(
      'aria-required-children',
      page('<main><div role="tablist"><div role="button">Tab 1</div></div></main>'),
    );
    expect(message).toMatch(/requires children with role tab/i);
  });

  it('accepts a correctly structured tablist', () => {
    expectClean(
      'aria-required-children',
      page('<main><div role="tablist"><button role="tab" aria-selected="true">Tab 1</button></div></main>'),
    );
  });

  it('flags an orphaned widget child', () => {
    expectFires('aria-required-parent', page('<main><div role="option" aria-selected="false">x</div></main>'));
  });

  it('accepts a widget child adopted through aria-owns', () => {
    expectClean(
      'aria-required-parent',
      page('<main><div role="listbox" aria-owns="opt1"></div><div id="opt1" role="option" aria-selected="false">x</div></main>'),
    );
  });

  it('survives an id that would break a CSS selector', () => {
    // The adoption check used to interpolate the id into querySelector, which
    // throws on metacharacters and crashed the rule.
    expectClean(
      'aria-required-parent',
      page('<main><div role="listbox" aria-owns="we:ird[id]"></div><div id="we:ird[id]" role="option" aria-selected="false">x</div></main>'),
    );
  });

  it('flags role=presentation on a focusable element', () => {
    const message = expectFires('no-presentation-on-focusable', page('<main><a href="/x" role="presentation">x</a></main>'));
    expect(message).toMatch(/still focusable/i);
  });

  it('accepts role=presentation on an anchor without href', () => {
    // <a> without href is not focusable; stripping its semantics is harmless.
    expectClean('no-presentation-on-focusable', page('<main><a role="presentation">x</a></main>'));
  });
});

describe('4.1.3 Status Messages', () => {
  it('raises a review item for an assertive live region', () => {
    const report = auditHtml({
      html: page('<main><div aria-live="assertive"></div></main>'),
      url: 'https://example.test/',
      only: ['status-message-region'],
    });
    expect(report.findings.some((f) => /interrupts/i.test(f.message))).toBe(true);
  });

  it('raises a review item for a form with no live region at all', () => {
    const report = auditHtml({
      html: page('<main><form><label for="e">Email</label><input id="e"></form></main>'),
      url: 'https://example.test/',
      only: ['status-message-region'],
    });
    expect(report.findings.some((f) => /no live region/i.test(f.message))).toBe(true);
  });

  it('accepts a polite status region', () => {
    expectClean(
      'status-message-region',
      page('<main><div role="status"></div><form><label for="e">Email</label><input id="e"></form></main>'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting guarantees
// ─────────────────────────────────────────────────────────────────────────────

describe('1.3.2 Meaningful Sequence', () => {
  it('flags CSS order used as the first declaration in a block', () => {
    // `order` directly after `{` used to be missed by an over-anchored regex.
    const message = expectFires(
      'meaningful-sequence',
      page('<main><div class="cards"><a href="/a">A</a><a href="/b">B</a></div></main>', '<style>.cards { order: 2; display: flex; }</style>'),
    );
    expect(message).toMatch(/reorders content visually/i);
  });

  it('does not confuse border with order', () => {
    expectClean(
      'meaningful-sequence',
      page('<main><div class="card">x</div></main>', '<style>.card { border: 2px solid #333; }</style>'),
    );
  });
});

describe('1.4.1 Use of Colour', () => {
  it('does not accept font-weight: normal as a non-colour cue', () => {
    const message = expectFires(
      'link-not-colour-only',
      page('<main><p style="color:#000000">Text <a href="/a" style="text-decoration:none;color:#0000ff;font-weight:normal">link</a></p></main>'),
    );
    expect(message).toMatch(/colour alone/i);
  });

  it('accepts a bold weight as a non-colour cue', () => {
    expectClean(
      'link-not-colour-only',
      page('<main><p style="color:#000000">Text <a href="/a" style="text-decoration:none;color:#0000ff;font-weight:700">link</a></p></main>'),
    );
  });
});

describe('1.2.4 Captions (Live)', () => {
  it('raises a review item for a video with no caption track', () => {
    const report = auditHtml({
      html: page('<main><video src="stream.mp4"></video></main>'),
      url: 'https://example.test/',
      only: ['live-captions'],
    });
    expect(report.findings[0]?.outcome).toBe('cantTell');
  });
});

describe('every rule behaves on a clean page', () => {
  /**
   * The strongest single guarantee in this suite: a page written correctly must
   * produce no *failures*. Undecidable items are allowed — some criteria
   * genuinely cannot be settled from markup — but nothing may be asserted as a
   * failure here.
   */
  const cleanPage = `<!doctype html>
<html lang="en">
  <head><title>An accessible example page</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body>
    <a href="#main">Skip to main content</a>
    <header><nav aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/about">About us</a></li></ul></nav></header>
    <main id="main">
      <h1 style="color:#0b1f24;background-color:#ffffff">Ordering a replacement card</h1>
      <p style="color:#0b1f24;background-color:#ffffff">Use the form below to order a replacement.</p>
      <h2 style="color:#0b1f24;background-color:#ffffff">Your details</h2>
      <img src="card.png" alt="A bank card with the chip facing upwards">
      <form>
        <div role="status"></div>
        <label for="name">Full name</label>
        <input id="name" name="name" type="text" autocomplete="name" required>
        <fieldset>
          <legend>Delivery speed</legend>
          <label><input type="radio" name="speed" value="std"> Standard</label>
          <label><input type="radio" name="speed" value="fast"> Next day</label>
        </fieldset>
        <button type="submit">Order replacement card</button>
      </form>
      <table>
        <caption>Delivery options</caption>
        <thead><tr><th scope="col">Option</th><th scope="col">Arrives</th></tr></thead>
        <tbody><tr><th scope="row">Standard</th><td>5 days</td></tr></tbody>
      </table>
    </main>
    <footer><nav aria-label="Legal"><ul><li><a href="/privacy">Privacy notice</a></li></ul></nav></footer>
  </body>
</html>`;

  it('reports no confirmed failures at level AA', () => {
    const report = auditHtml({ html: cleanPage, url: 'https://example.test/', target: 'AA' });
    const failures = report.findings.filter((finding) => finding.outcome === 'failed');

    expect(
      failures.map((f) => `${f.ruleId}: ${f.message}`),
      'a correctly-authored page must not produce failures',
    ).toEqual([]);
  });

  it('reports the page as having no automated failures at level AA', () => {
    const report = auditHtml({ html: cleanPage, url: 'https://example.test/', target: 'AA' });
    expect(report.score.conformsTo === 'AA' || report.score.conformsTo === 'AAA').toBe(true);
    expect(report.score.criteriaFailed).toBe(0);
  });
});

describe('resilience', () => {
  /**
   * The runner catches a throwing rule and downgrades it to `cantTell` so one
   * bad rule cannot take down an audit. That safety net must not become a place
   * where crashes hide: these tests assert nothing reached it.
   */
  const expectNoRuleCrashed = (html: string): void => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(() => auditHtml({ html, url: 'https://example.test/' })).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(errors, 'no rule may throw').toEqual([]);
  };

  it('runs every rule without crashing on an empty document', () => {
    expectNoRuleCrashed('');
  });

  it('runs every rule without crashing on malformed markup', () => {
    expectNoRuleCrashed('<div><p>unclosed<span>');
  });

  it('runs every rule without crashing on a document with no body', () => {
    expectNoRuleCrashed('<!doctype html>');
  });

  it('produces a report even when every rule finds nothing applicable', () => {
    const report = auditHtml({ html: '<!doctype html><html lang="en"><head><title>Empty but valid page</title></head><body></body></html>', url: 'https://example.test/' });
    expect(report.status).toBe('succeeded');
    expect(report.engine.rulesRun).toBeGreaterThan(0);
  });

  it('never cites a criterion outside the target level in a finding', () => {
    const report = auditHtml({
      html: page('<main><img src="a.png"><p style="color:#999;background:#fff">x</p></main>'),
      url: 'https://example.test/',
      target: 'A',
    });
    for (const finding of report.findings) {
      expect(finding.level).not.toBe('AAA');
    }
  });

  it('produces stable finding ids across identical runs', () => {
    const html = page('<main><img src="a.png"></main>');
    const first = auditHtml({ html, url: 'https://example.test/' });
    const second = auditHtml({ html, url: 'https://example.test/' });
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
  });
});

describe('coverage reporting', () => {
  it('covers a meaningful share of level A and AA criteria', () => {
    const covered = defaultRegistry.coveredCriteria();
    const scoped = SUCCESS_CRITERIA.filter((c) => c.level !== 'AAA');
    const coveredScoped = scoped.filter((c) => covered.has(c.id));
    // Automation cannot reach everything; this asserts we have not silently
    // regressed coverage, not that coverage is complete.
    expect(coveredScoped.length / scoped.length).toBeGreaterThan(0.5);
  });

  it('never claims coverage of a criterion no rule cites', () => {
    const covered = defaultRegistry.coveredCriteria();
    for (const id of covered) {
      expect(defaultRegistry.rulesForCriterion(id).length).toBeGreaterThan(0);
    }
  });
});
