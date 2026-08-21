import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Build the distributable tracker.
 *
 * Two outputs, because there are two ways to install it:
 *
 *  - `accessly-tracker.js` — a self-contained IIFE that defines `window.Accessly`
 *    and starts itself. This is what goes in a `<script>` tag, and it is the
 *    one that has to stay small.
 *  - `accessly-tracker.esm.js` — the same library for people who already have a
 *    bundler and would rather import it.
 *
 * A size budget is enforced here rather than left to a reviewer's judgement.
 * The tracker's whole argument is that watching a session is cheap; a bundle
 * that quietly grew to a hundred kilobytes would refute that in production long
 * before anyone noticed it in a diff.
 */

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Gzipped-ish ceiling for the browser build, in bytes. */
const SIZE_BUDGET = 16 * 1024;

const shared = {
  bundle: true,
  minify: true,
  sourcemap: true,
  // Two years of browsers. Anything older cannot run the APIs the tracker
  // depends on (MutationObserver on live regions, keepalive fetch) closely
  // enough for the recording to mean anything.
  target: ['es2020', 'chrome91', 'firefox90', 'safari15'],
  legalComments: 'none',
  logLevel: 'warning',
};

mkdirSync(here('./dist'), { recursive: true });

await build({
  ...shared,
  entryPoints: [here('./src/global.ts')],
  outfile: here('./dist/accessly-tracker.js'),
  format: 'iife',
  platform: 'browser',
});

await build({
  ...shared,
  entryPoints: [here('./src/index.ts')],
  outfile: here('./dist/accessly-tracker.esm.js'),
  format: 'esm',
  platform: 'browser',
});

const browserBundle = here('./dist/accessly-tracker.js');
const { size } = statSync(browserBundle);

writeFileSync(
  here('./dist/README.txt'),
  [
    'Accessly tracker — generated, do not edit.',
    '',
    'accessly-tracker.js      script-tag build, defines window.Accessly',
    'accessly-tracker.esm.js  ES module build for bundlers',
    '',
    `Built ${new Date().toISOString()}; browser bundle ${size} bytes.`,
    '',
  ].join('\n'),
);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

if (size > SIZE_BUDGET) {
  console.error(
    `The browser bundle is ${kb(size)}, over the ${kb(SIZE_BUDGET)} budget.\n` +
      'Something heavy was pulled in — check that nothing reaches through\n' +
      '@accessly/contracts to the zod schemas, which is the usual cause.',
  );
  process.exit(1);
}

console.log(`accessly-tracker.js  ${kb(size)}  (budget ${kb(SIZE_BUDGET)})`);
