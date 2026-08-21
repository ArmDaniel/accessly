import { install, readConfig, type EmbedHandle } from './embed.js';
import { Tracker, record } from './index.js';

/**
 * The bundled global build.
 *
 * This file exists only to define what a customer sees on `window` after the
 * script tag runs. The library itself never touches globals — a package that
 * assigns to `window` at import time cannot be tested, server-rendered, or
 * loaded twice — so the assignment lives here, in the one build that is
 * *supposed* to have a page under it.
 */

export interface AccesslyGlobal {
  readonly Tracker: typeof Tracker;
  readonly record: typeof record;
  readonly install: typeof install;
  readonly readConfig: typeof readConfig;
  /** The session started by the script tag, when it auto-started. */
  current: EmbedHandle | null;
}

const existing = (globalThis as { Accessly?: AccesslyGlobal }).Accessly;

/*
 * Installing twice would record every event twice and post two traces for one
 * session. Tag duplication is common — a tag manager and a hard-coded snippet,
 * or two teams adding it independently — so the second load defers to the
 * first rather than competing with it.
 */
const api: AccesslyGlobal = existing ?? {
  Tracker,
  record,
  install,
  readConfig,
  current: null,
};

if (!existing) {
  (globalThis as { Accessly?: AccesslyGlobal }).Accessly = api;
  try {
    api.current = install();
  } catch {
    // Never take a customer's page down. A tracker that throws during startup
    // is a tracker that gets removed, and then nothing is measured at all.
  }
}

export { Tracker, record, install, readConfig };
export default api;
