import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { auditHtml } from '@accessly/core';
import type { AuditReport, ConformanceLevel, Finding } from '@accessly/contracts';
import { App } from '../src/App.js';

/**
 * Audit Accessly with Accessly.
 *
 * The component tests in `apps/web/test` already run the engine against
 * rendered markup, but they run under jsdom, which resolves no stylesheets — so
 * every contrast check there comes back undecidable. This script closes that
 * gap: it server-renders each route to real HTML and inlines the actual
 * stylesheets into a `<style>` block, which is a form the engine's CSS resolver
 * can evaluate. The result is a genuine contrast verdict on the real palette as
 * applied to the real markup.
 *
 * What it still cannot see, and why that is fine:
 *  - Anything that only exists after hydration. Our pages render their full
 *    content on the server, so this is a small gap in practice.
 *  - Layout-dependent criteria (reflow, target size as rendered). Those need a
 *    real browser and are checked by hand before a release.
 *
 * Run with:  npm run audit:self  -w @accessly/web
 * Exits non-zero on any confirmed level A or AA failure, so CI can gate on it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = resolve(HERE, '../src/styles');

const ROUTES = [
  '/',
  '/scan',
  '/platform',
  '/monitoring',
  '/coverage',
  '/standards',
  '/standards/eaa',
  '/pricing',
  '/about',
  '/contact',
  '/accessibility',
  '/dashboard',
  '/dashboard/monitoring',
  '/dashboard/journeys',
  '/not-a-real-page',
] as const;

const TARGET: ConformanceLevel = 'AA';

/**
 * Concatenate the stylesheets in cascade order.
 *
 * `index.css` is only a list of imports, so we resolve them by hand rather than
 * running a bundler for what is ultimately string concatenation.
 */
function loadStyles(): string {
  const order = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'print.css'];
  return order.map((name) => readFileSync(resolve(STYLE_DIR, name), 'utf8')).join('\n');
}

function renderRoute(path: string, css: string): string {
  const body = renderToStaticMarkup(
    <StaticRouter location={path}>
      <App />
    </StaticRouter>,
  );

  // The document wrapper mirrors index.html, because several rules are about
  // the document rather than the body: lang, title, and the viewport meta.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleFor(path)}</title>
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

function titleFor(path: string): string {
  if (path === '/') return 'Accessly — prove your website is accessible';
  const name = path.split('/').filter(Boolean).join(' ') || 'page';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} — Accessly`;
}

function describe(finding: Finding): string {
  return [
    `    ${finding.ruleId} [${finding.criteria.join(', ')} · level ${finding.level} · ${finding.impact}]`,
    `      ${finding.message}`,
    `      at ${finding.location.selector}`,
    `      fix: ${finding.remediation}`,
  ].join('\n');
}

function main(): void {
  const css = loadStyles();
  const reports: Array<{ route: string; report: AuditReport }> = [];

  let failures = 0;
  let reviewItems = 0;

  process.stdout.write(`\nAuditing ${ROUTES.length} routes against WCAG 2.1 level ${TARGET}\n`);
  process.stdout.write(`${'─'.repeat(72)}\n`);

  for (const route of ROUTES) {
    const html = renderRoute(route, css);
    const report = auditHtml({ html, url: `https://accessly.eu${route}`, target: TARGET });
    reports.push({ route, report });

    const confirmed = report.findings.filter((f) => f.outcome === 'failed');
    const review = report.findings.filter((f) => f.outcome === 'cantTell');

    failures += confirmed.length;
    reviewItems += review.length;

    const verdict = confirmed.length === 0 ? 'pass' : `${confirmed.length} FAILURE(S)`;
    process.stdout.write(
      `${confirmed.length === 0 ? '  ok  ' : '  FAIL'} ${route.padEnd(26)} score ${String(report.score.value).padStart(3)}/100  ${verdict}${review.length > 0 ? `, ${review.length} to review` : ''}\n`,
    );

    for (const finding of confirmed) {
      process.stdout.write(`${describe(finding)}\n`);
    }
  }

  process.stdout.write(`${'─'.repeat(72)}\n`);

  const worst = [...reports].sort((a, b) => a.report.score.value - b.report.score.value)[0];
  const average = Math.round(
    reports.reduce((total, entry) => total + entry.report.score.value, 0) / reports.length,
  );

  process.stdout.write(`Average score:      ${average}/100\n`);
  process.stdout.write(
    `Lowest scoring:     ${worst?.route} (${worst?.report.score.value}/100)\n`,
  );
  process.stdout.write(`Confirmed failures: ${failures}\n`);
  process.stdout.write(`Needs human review: ${reviewItems}\n`);

  // Written out so a CI job can attach it, and so a regression can be diffed
  // rather than argued about.
  const outputPath = resolve(HERE, '../../../self-audit.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        target: TARGET,
        average,
        confirmedFailures: failures,
        needsReview: reviewItems,
        routes: reports.map(({ route, report }) => ({
          route,
          score: report.score.value,
          conformsTo: report.score.conformsTo,
          failures: report.findings
            .filter((f) => f.outcome === 'failed')
            .map((f) => ({
              rule: f.ruleId,
              criteria: f.criteria,
              level: f.level,
              message: f.message,
              selector: f.location.selector,
            })),
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  process.stdout.write(`\nWrote self-audit.json\n`);

  if (failures > 0) {
    process.stdout.write(
      `\nSelf-audit failed: ${failures} confirmed WCAG 2.1 level ${TARGET} failure(s).\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`\nNo confirmed level A or AA failures.\n`);
}

main();
