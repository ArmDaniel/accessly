import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TraceMessageType } from '@accessly/contracts/journey.js';

/**
 * The shipped artefact.
 *
 * Every other test in this package exercises the TypeScript sources. This one
 * runs the build and then evaluates the resulting script the way a browser
 * would, because the thing a customer installs is the bundle — and a bundle can
 * be broken in ways the sources are not: a tree-shaken-away side effect, a
 * global that never gets defined, a dependency that quietly came along for the
 * ride.
 */

/*
 * Paths from the working directory, not from `import.meta.url`.
 *
 * This suite has to run under jsdom — it evaluates a browser bundle — and under
 * jsdom `import.meta.url` is an http URL, so `fileURLToPath` refuses it. Vitest
 * runs from the workspace root, which gives us a stable anchor.
 */
const packageDir = resolve(process.cwd(), 'packages/tracker');
const bundlePath = resolve(packageDir, 'dist/accessly-tracker.js');

interface AccesslyGlobal {
  Tracker: unknown;
  record: unknown;
  install: (...args: unknown[]) => { tracker: { isRecording: boolean; messages: { t: number }[] }; stop: () => void };
  current: { tracker: { isRecording: boolean; messages: { t: number }[] }; stop: () => void } | null;
}

const globalWith = globalThis as unknown as { Accessly?: AccesslyGlobal };

let source = '';

beforeAll(() => {
  // Build rather than assume: a stale dist/ would let this suite pass while
  // the artefact on the CDN was months behind the sources.
  execFileSync(process.execPath, ['build.mjs'], { cwd: packageDir, stdio: 'pipe' });
  source = readFileSync(bundlePath, 'utf8');
}, 60_000);

afterAll(() => {
  globalWith.Accessly?.current?.stop();
  delete globalWith.Accessly;
});

/** Run the bundle the way a `<script>` tag would. */
function evaluate(): void {
  // eslint-disable-next-line no-new-func
  new Function(source)();
}

describe('the built bundle', () => {
  it('carries no trace of the request schemas', () => {
    /*
     * The tracker imports its constants from `@accessly/contracts/journey.js`
     * rather than the package root precisely so that zod — which the root
     * re-exports for the API's request schemas — never reaches a customer's
     * page. This is the assertion that keeps that true.
     */
    expect(source).not.toMatch(/ZodError|zod/i);
  });

  it('stays inside its size budget', () => {
    // The tracker's whole argument is that watching a session is cheap.
    expect(statSync(bundlePath).size).toBeLessThan(16 * 1024);
  });

  it('defines the global and starts recording on load', () => {
    document.body.innerHTML = '<button id="go">Go</button>';
    evaluate();

    const api = globalWith.Accessly;
    expect(api).toBeDefined();
    expect(typeof api?.install).toBe('function');
    expect(api?.current?.tracker.isRecording).toBe(true);
    expect(api?.current?.tracker.messages[0]?.t).toBe(TraceMessageType.SessionStart);
  });

  it('records real interaction through the bundled build', () => {
    const button = document.getElementById('go') as HTMLElement;
    button.click();

    const types = globalWith.Accessly?.current?.tracker.messages.map((message) => message.t) ?? [];
    expect(types).toContain(TraceMessageType.PointerActivated);
  });

  it('does not install twice when the tag is included twice', () => {
    /*
     * Duplicate installation is the common tag-manager mistake, and it would
     * record every event twice and post two traces for one session.
     */
    const first = globalWith.Accessly?.current;
    evaluate();
    expect(globalWith.Accessly?.current).toBe(first);
  });
});
