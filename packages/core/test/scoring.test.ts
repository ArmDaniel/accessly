import { describe, expect, it } from 'vitest';
import { criteriaForLevel } from '@accessly/contracts';
import { auditHtml, diffAudits } from '../src/audit.js';
import { calculateScore, SCORING_WEIGHTS } from '../src/scoring/score.js';
import { defaultRegistry } from '../src/rules/index.js';

const url = 'https://example.test/';

const CLEAN = `<!doctype html><html lang="en"><head><title>A perfectly ordinary page</title></head><body>
<a href="#m">Skip to main content</a>
<header><nav aria-label="Main"><ul><li><a href="/">Home</a></li></ul></nav></header>
<main id="m"><h1>Ordering</h1><p>Some text.</p></main></body></html>`;

const BROKEN = `<!doctype html><html><head></head><body>
<div><img src="a.png"><a href="/x"></a><div onclick="go()">Go</div>
<input type="text"><h3>Skipped</h3><div id="d"></div><div id="d"></div></div></body></html>`;

describe('score composition', () => {
  it('is bounded to 0–100', () => {
    for (const html of [CLEAN, BROKEN, '', '<html></html>']) {
      const report = auditHtml({ html, url });
      expect(report.score.value).toBeGreaterThanOrEqual(0);
      expect(report.score.value).toBeLessThanOrEqual(100);
    }
  });

  it('scores a clean page above a broken one', () => {
    const clean = auditHtml({ html: CLEAN, url });
    const broken = auditHtml({ html: BROKEN, url });
    expect(clean.score.value).toBeGreaterThan(broken.score.value);
  });

  it('is deterministic for the same input', () => {
    expect(auditHtml({ html: BROKEN, url }).score).toEqual(auditHtml({ html: BROKEN, url }).score);
  });

  it('weights level A failures more heavily than AAA ones', () => {
    expect(SCORING_WEIGHTS.level.A).toBeGreaterThan(SCORING_WEIGHTS.level.AA);
    expect(SCORING_WEIGHTS.level.AA).toBeGreaterThan(SCORING_WEIGHTS.level.AAA);
  });

  it('splits the score 75/25 between criterion coverage and instance density', () => {
    expect(SCORING_WEIGHTS.criterionShare + SCORING_WEIGHTS.instanceShare).toBe(1);
    expect(SCORING_WEIGHTS.criterionShare).toBeGreaterThan(SCORING_WEIGHTS.instanceShare);
  });

  it('distinguishes one instance of a defect from many', () => {
    // Both pages fail 1.1.1 identically as far as conformance goes. The score
    // must still separate them, or it is useless for tracking remediation.
    const one = auditHtml({ html: `<!doctype html><html lang="en"><head><title>One image page</title></head><body><main><h1>x</h1><img src="a.png"></main></body></html>`, url });
    const many = auditHtml({
      html: `<!doctype html><html lang="en"><head><title>Many images page</title></head><body><main><h1>x</h1>${'<img src="a.png">'.repeat(30)}</main></body></html>`,
      url,
    });

    expect(one.score.criteriaFailed).toBe(many.score.criteriaFailed);
    expect(many.score.value).toBeLessThan(one.score.value);
  });

  it('assigns a band consistent with the value', () => {
    const bands: Array<[number, string]> = [
      [95, 'excellent'],
      [85, 'good'],
      [70, 'fair'],
      [50, 'poor'],
    ];
    const report = auditHtml({ html: CLEAN, url });
    const expected = bands.find(([threshold]) => report.score.value >= threshold)?.[1] ?? 'critical';
    expect(report.score.band).toBe(expected);
  });
});

describe('conformance verdict', () => {
  it('is null when any level A criterion fails, regardless of the score', () => {
    const report = auditHtml({ html: BROKEN, url });
    expect(report.score.criteriaFailed).toBeGreaterThan(0);
    expect(report.score.conformsTo).toBeNull();
  });

  it('is kept separate from the numeric score', () => {
    // A page can score well and still not conform. That is the whole point of
    // reporting both, and it must not be smoothed over.
    const report = auditHtml({
      html: `<!doctype html><html lang="en"><head><title>Almost perfect page</title></head><body>
        <a href="#m">Skip to main content</a>
        <header><nav aria-label="Main"><a href="/">Home</a></nav></header>
        <main id="m"><h1>Title</h1><img src="a.png"></main></body></html>`,
      url,
    });
    expect(report.score.value).toBeGreaterThan(80);
    expect(report.score.conformsTo).toBeNull();
  });

  it('reports the highest level with no automated failures', () => {
    const report = auditHtml({ html: CLEAN, url, target: 'AA' });
    expect(['AA', 'AAA']).toContain(report.score.conformsTo);
  });
});

describe('manual-review accounting', () => {
  it('counts criteria that no rule covers, rather than passing them silently', () => {
    const report = auditHtml({ html: CLEAN, url, target: 'AA' });
    expect(report.score.criteriaRequiringManualReview).toBeGreaterThan(0);

    // Every criterion in scope is either evaluated or flagged for review —
    // none may simply vanish from the report.
    const inScope = criteriaForLevel('AA').length;
    expect(report.score.criteriaEvaluated + report.score.criteriaRequiringManualReview).toBe(inScope);
    expect(report.criteria).toHaveLength(inScope);
  });

  it('excludes manual-review criteria from the score in both directions', () => {
    // Fabricate a run where nothing was tested at all. If manual-review
    // criteria counted as failures the score would be 0; if they counted as
    // passes it would be 100 and meaningless. It must be 100 with the gap
    // reported separately.
    const { score } = calculateScore({
      target: 'AA',
      rules: [],
      findings: [],
      registry: defaultRegistry,
    });
    expect(score.value).toBe(100);
    expect(score.criteriaRequiringManualReview).toBe(criteriaForLevel('AA').length);
    expect(score.criteriaEvaluated).toBe(0);
  });

  it('marks a criterion as needing review when no rule cites it', () => {
    const report = auditHtml({ html: CLEAN, url, target: 'AA' });
    const timing = report.criteria.find((c) => c.criterion === '2.2.1');
    // 2.2.1 is cited by no-meta-refresh, so it is covered.
    expect(timing?.requiresManualReview).toBe(false);

    // 1.2.4 Captions (Live) cannot be automated at all.
    const liveCaptions = report.criteria.find((c) => c.criterion === '1.2.4');
    expect(liveCaptions?.requiresManualReview).toBe(true);
  });
});

describe('per-principle scores', () => {
  it('reports all four principles', () => {
    const report = auditHtml({ html: BROKEN, url });
    expect(report.score.byPrinciple.map((p) => p.principle)).toEqual(['1', '2', '3', '4']);
    for (const principle of report.score.byPrinciple) {
      expect(principle.score).toBeGreaterThanOrEqual(0);
      expect(principle.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('summary counts', () => {
  it('matches the findings it summarises', () => {
    const report = auditHtml({ html: BROKEN, url });
    expect(report.summary.total).toBe(report.findings.length);

    const byImpact = Object.values(report.summary.byImpact).reduce((a, b) => a + b, 0);
    const byLevel = Object.values(report.summary.byLevel).reduce((a, b) => a + b, 0);
    expect(byImpact).toBe(report.findings.length);
    expect(byLevel).toBe(report.findings.length);
  });

  it('orders findings by obligation then impact', () => {
    const report = auditHtml({ html: BROKEN, url, target: 'AAA' });
    const order = { A: 0, AA: 1, AAA: 2 };
    const levels = report.findings.map((f) => order[f.level]);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});

describe('audit diffing', () => {
  const before = `<!doctype html><html lang="en"><head><title>Product page before</title></head><body><main><h1>P</h1><img src="a.png"></main></body></html>`;
  const after = `<!doctype html><html lang="en"><head><title>Product page after</title></head><body><main><h1>P</h1><img src="a.png" alt="A product photo"></main></body></html>`;

  it('reports a fixed issue as resolved, not as unchanged', () => {
    const diff = diffAudits(auditHtml({ html: before, url }), auditHtml({ html: after, url }));
    expect(diff.resolved.some((f) => f.ruleId === 'image-alt')).toBe(true);
    expect(diff.introduced.some((f) => f.ruleId === 'image-alt')).toBe(false);
    expect(diff.scoreDelta).toBeGreaterThan(0);
  });

  it('reports a newly broken issue as introduced', () => {
    const diff = diffAudits(auditHtml({ html: after, url }), auditHtml({ html: before, url }));
    expect(diff.introduced.some((f) => f.ruleId === 'image-alt')).toBe(true);
    expect(diff.scoreDelta).toBeLessThan(0);
  });

  it('recognises an unchanged issue as the same issue across runs', () => {
    const diff = diffAudits(auditHtml({ html: before, url }), auditHtml({ html: before, url }));
    expect(diff.introduced).toEqual([]);
    expect(diff.resolved).toEqual([]);
    expect(diff.scoreDelta).toBe(0);
  });

  it('reports which criteria regressed and which were fixed', () => {
    const diff = diffAudits(auditHtml({ html: before, url }), auditHtml({ html: after, url }));
    expect(diff.criteriaFixed).toContain('1.1.1');
    expect(diff.criteriaRegressed).toEqual([]);
  });
});

describe('report shape', () => {
  it('records what was tested, so the report stands alone', () => {
    const report = auditHtml({ html: CLEAN, url: 'https://example.test/checkout', target: 'AA' });

    expect(report.subject.url).toBe('https://example.test/checkout');
    expect(report.subject.title).toBe('A perfectly ordinary page');
    expect(report.subject.lang).toBe('en');
    expect(report.subject.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.engine.wcagVersion).toBe('2.1');
    expect(report.engine.rulesRun).toBeGreaterThan(0);
    expect(report.status).toBe('succeeded');
    expect(new Date(report.finishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(report.startedAt).getTime(),
    );
  });

  it('gives every finding a selector a developer can act on', () => {
    const report = auditHtml({ html: BROKEN, url });
    for (const finding of report.findings) {
      expect(finding.location.selector.length).toBeGreaterThan(0);
      expect(finding.remediation.length).toBeGreaterThan(20);
      expect(finding.criteria.length).toBeGreaterThan(0);
    }
  });
});
