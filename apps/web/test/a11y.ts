import { expect } from 'vitest';
import { auditHtml } from '@accessly/core';
import type { ConformanceLevel, Finding } from '@accessly/contracts';

/**
 * Run the Accessly engine against our own rendered markup.
 *
 * Dogfooding, but also the cheapest possible regression net: if a rule is good
 * enough to fail a customer's build, it is good enough to fail ours. Anything
 * we have to exempt below is a claim we have to be able to defend.
 */

export interface AuditExpectation {
  readonly target?: ConformanceLevel;
  /**
   * Rule ids that are permitted to fail, each with a written justification.
   * The justification is not decoration — it is what stops this list growing
   * silently, and it is reviewed whenever an entry is added.
   */
  readonly allow?: Readonly<Record<string, string>>;
}

/** Wrap a rendered fragment in a minimal valid document. */
export function documentAround(bodyHtml: string, title = 'Accessly test page'): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${bodyHtml}</body></html>`;
}

export function auditMarkup(html: string, target: ConformanceLevel = 'AA') {
  return auditHtml({ html, url: 'https://accessly.eu/test', target });
}

/**
 * Assert that markup has no confirmed WCAG failures.
 *
 * `cantTell` findings are not asserted on: the engine cannot resolve colours
 * from an external stylesheet, and in jsdom there is no stylesheet at all, so
 * every contrast check is undecidable here by construction. Contrast is
 * asserted directly against the design tokens in theme.test.ts instead.
 */
export function expectNoViolations(html: string, options: AuditExpectation = {}): void {
  const report = auditMarkup(html, options.target ?? 'AA');
  const allowed = options.allow ?? {};

  const violations = report.findings.filter(
    (finding: Finding) => finding.outcome === 'failed' && !(finding.ruleId in allowed),
  );

  expect(
    violations.map((v) => `${v.ruleId} [${v.criteria.join(', ')}] ${v.message} → ${v.location.selector}`),
    'rendered markup must have no confirmed WCAG failures',
  ).toEqual([]);
}

/** Assert a specific rule reported nothing, used for targeted checks. */
export function expectRulePasses(html: string, ruleId: string): void {
  const report = auditMarkup(html);
  const failures = report.findings.filter((f) => f.ruleId === ruleId && f.outcome === 'failed');
  expect(failures.map((f) => f.message), `${ruleId} must pass`).toEqual([]);
}
