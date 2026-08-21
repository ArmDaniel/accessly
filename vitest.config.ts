import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * One root config for the whole workspace.
 *
 * The environments differ on purpose: the rule engine and the API must run in a
 * plain Node environment (they parse HTML themselves and must never depend on a
 * browser global), while the web app's component tests need a DOM. Running the
 * engine tests in jsdom would let a rule accidentally rely on a global
 * `document` and still pass.
 */
export default defineConfig({
  resolve: {
    /*
     * An array rather than an object, because order decides correctness here.
     * A bare `@accessly/contracts` entry also prefix-matches
     * `@accessly/contracts/journey.js` and would rewrite it to
     * `…/src/index.tsjourney.js`, so the subpath rule has to be tried first.
     * Object keys happen to preserve order today; spelling it out means we are
     * not relying on that.
     */
    alias: [
      { find: /^@accessly\/contracts\/(.*)\.js$/, replacement: r('./packages/contracts/src/$1.ts') },
      { find: '@accessly/contracts', replacement: r('./packages/contracts/src/index.ts') },
      { find: '@accessly/core', replacement: r('./packages/core/src/index.ts') },
      { find: '@accessly/media', replacement: r('./packages/media/src/index.ts') },
      { find: '@accessly/tracker', replacement: r('./packages/tracker/src/index.ts') },
      { find: '@web', replacement: r('./apps/web/src') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['apps/web/test/**', 'jsdom'],
      // The tracker is browser code; jsdom gives it real coverage without a browser.
      ['packages/tracker/test/**', 'jsdom'],
    ],
    setupFiles: [r('./test/setup.ts')],
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/api/test/**/*.test.ts',
      'apps/web/test/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**', 'apps/*/src/**'],
    },
  },
});
