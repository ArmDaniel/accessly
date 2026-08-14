import { z } from 'zod';

/**
 * Configuration is read once, validated, and passed down explicitly.
 * Nothing below this file touches `process.env` — that is what makes the
 * services testable without a mutable global.
 */
const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().min(0).max(65535).default(4000),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Origins permitted to call the API from a browser. */
  corsOrigins: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((o) => o.trim()).filter((o) => o.length > 0)),

  /** Hard ceiling on a fetched document, to bound memory per request. */
  maxDocumentBytes: z.coerce.number().int().positive().default(5_000_000),
  fetchTimeoutMs: z.coerce.number().int().positive().default(15_000),

  /** How often the watcher wakes up to look for due watches. */
  watcherTickMs: z.coerce.number().int().positive().default(60_000),
  /** Watches processed per tick, so one large tenant cannot starve the rest. */
  watcherBatchSize: z.coerce.number().int().positive().default(10),
  watcherEnabled: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),

  /**
   * Refuse to fetch private, loopback and link-local addresses.
   * Only ever disabled in tests, which point at a local fixture server.
   */
  blockPrivateHosts: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGINS,
    maxDocumentBytes: env.MAX_DOCUMENT_BYTES,
    fetchTimeoutMs: env.FETCH_TIMEOUT_MS,
    watcherTickMs: env.WATCHER_TICK_MS,
    watcherBatchSize: env.WATCHER_BATCH_SIZE,
    watcherEnabled: env.WATCHER_ENABLED,
    blockPrivateHosts: env.BLOCK_PRIVATE_HOSTS,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${detail}`);
  }

  return parsed.data;
}
