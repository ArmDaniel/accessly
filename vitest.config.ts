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
    alias: {
      '@accessly/contracts': r('./packages/contracts/src/index.ts'),
      '@accessly/core': r('./packages/core/src/index.ts'),
      '@web': r('./apps/web/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [['apps/web/test/**', 'jsdom']],
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
