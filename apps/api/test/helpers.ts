import { loadConfig, type Config } from '../src/config.js';
import { FixedClock, SequentialIdGenerator } from '../src/domain/clock.js';
import { createInMemoryRepositories } from '../src/repositories/memory.js';
import { StubHtmlFetcher } from '../src/services/fetcher.js';
import { buildServer, type BuiltServer } from '../src/server.js';
import { createContainer, type Container } from '../src/container.js';

/**
 * Test harness.
 *
 * Every test gets its own repositories, clock and id generator, so tests are
 * independent and their assertions can name exact timestamps and ids instead of
 * matching loose patterns.
 */

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      NODE_ENV: 'test',
      // The stub fetcher never touches the network, but the guard is still
      // exercised directly in url-guard.test.ts.
      BLOCK_PRIVATE_HOSTS: 'true',
      WATCHER_ENABLED: 'false',
    }),
    ...overrides,
  };
}

export interface Harness extends BuiltServer {
  readonly clock: FixedClock;
  readonly fetcher: StubHtmlFetcher;
}

export async function createHarness(
  pages: Record<string, string> = {},
): Promise<Harness> {
  const clock = new FixedClock('2026-01-01T09:00:00.000Z');
  const fetcher = new StubHtmlFetcher(pages);

  const built = await buildServer(testConfig(), {
    repositories: createInMemoryRepositories(),
    clock,
    ids: new SequentialIdGenerator(),
    fetcher,
  });

  return { ...built, clock, fetcher };
}

/** A container without the HTTP layer, for testing services directly. */
export function createTestContainer(pages: Record<string, string> = {}): {
  container: Container;
  clock: FixedClock;
  fetcher: StubHtmlFetcher;
} {
  const clock = new FixedClock('2026-01-01T09:00:00.000Z');
  const fetcher = new StubHtmlFetcher(pages);
  const container = createContainer(testConfig(), {
    repositories: createInMemoryRepositories(),
    clock,
    ids: new SequentialIdGenerator(),
    fetcher,
  });
  return { container, clock, fetcher };
}

/** A page with no accessibility defects the engine can detect. */
export const GOOD_PAGE = `<!doctype html>
<html lang="en"><head><title>An accessible product page</title></head>
<body>
  <a href="#m">Skip to main content</a>
  <header><nav aria-label="Main"><ul><li><a href="/">Home</a></li></ul></nav></header>
  <main id="m"><h1>Product</h1><p>Description of the product.</p></main>
</body></html>`;

/** The same page after someone shipped a regression. */
export const REGRESSED_PAGE = `<!doctype html>
<html lang="en"><head><title>An accessible product page</title></head>
<body>
  <a href="#m">Skip to main content</a>
  <header><nav aria-label="Main"><ul><li><a href="/">Home</a></li></ul></nav></header>
  <main id="m"><h1>Product</h1><p>Description of the product.</p><img src="new.png"><a href="/buy"></a></main>
</body></html>`;
