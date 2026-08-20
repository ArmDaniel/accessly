import { z } from 'zod';
import { CONFORMANCE_LEVELS } from './wcag.js';
import { STEP_ACTIONS } from './journey.js';
import { MEDIA_KINDS } from './media.js';
import { SUBSCRIPTION_PLANS, WATCH_INTERVALS, WATCH_STATUSES } from './types.js';

/**
 * Wire schemas. These are the *only* contract between apps/api and apps/web.
 *
 * Requests are validated at the edge with these; responses are typed from the
 * domain types in `types.ts`. We deliberately do not derive request types from
 * the domain — inbound shapes should be free to stay narrower than what we
 * store, and coupling them makes every storage change a breaking API change.
 */

const conformanceLevel = z.enum(CONFORMANCE_LEVELS);

/**
 * Accept only absolute http(s) URLs.
 *
 * The API additionally refuses private/loopback hosts at request time — see
 * `apps/api/src/services/url-guard.ts`. Blocking them here would make the guard
 * invisible to callers of the schema, and it needs DNS resolution anyway.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .min(1, 'A URL is required.')
  .max(2048, 'URL is too long.')
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Enter a full URL starting with http:// or https://' },
  );

// ── Audits ───────────────────────────────────────────────────────────────────

/** Audit a live URL the API fetches itself. */
export const createUrlAuditSchema = z.object({
  source: z.literal('url'),
  url: httpUrlSchema,
  target: conformanceLevel.default('AA'),
  siteId: z.string().uuid().nullish(),
});

/**
 * Audit markup supplied directly by the caller.
 *
 * This is how the in-browser scanner works: the page is never sent anywhere the
 * customer has not already published it, and we can audit authenticated pages
 * without holding credentials.
 */
export const createInlineAuditSchema = z.object({
  source: z.literal('inline'),
  html: z.string().min(1, 'Paste some HTML to scan.').max(5_000_000, 'Document is too large to scan (5 MB limit).'),
  /** Used for resolving relative URLs and for display; not fetched. */
  url: httpUrlSchema.optional(),
  target: conformanceLevel.default('AA'),
  siteId: z.string().uuid().nullish(),
});

/**
 * Audit a document that is not a web page: a PDF, a deck, a report, captions.
 *
 * Bytes travel base64-encoded in JSON rather than as multipart. The API speaks
 * one content type everywhere else and these files are small — a 5 MB ceiling
 * covers the documents people actually publish — so a second parsing stack
 * would buy nothing.
 */
export const createMediaAuditSchema = z.object({
  source: z.literal('media'),
  filename: z
    .string()
    .trim()
    .min(1, 'Choose a file to scan.')
    .max(255)
    // Path separators in a filename are never legitimate here and are the
    // classic way a stored name escapes the directory it was meant for.
    .refine((value) => !/[\\/]/.test(value), { message: 'A filename cannot contain a path.' }),
  /** Base64 of the raw file. */
  data: z
    .string()
    .min(1, 'That file appears to be empty.')
    // Base64 inflates by 4/3; the ceiling keeps the decoded size near 5 MB.
    .max(7_000_000, 'That file is too large to scan (5 MB limit).')
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'The file could not be read.'),
  /** Declared kind, when the caller already knows it. Otherwise sniffed. */
  kind: z.enum(MEDIA_KINDS).optional(),
  target: conformanceLevel.default('AA'),
  siteId: z.string().uuid().nullish(),
});

export const createAuditSchema = z.discriminatedUnion('source', [
  createUrlAuditSchema,
  createInlineAuditSchema,
  createMediaAuditSchema,
]);
export type CreateAuditInput = z.infer<typeof createAuditSchema>;

export const listAuditsQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type ListAuditsQuery = z.infer<typeof listAuditsQuerySchema>;

// ── Sites ────────────────────────────────────────────────────────────────────

export const createSiteSchema = z.object({
  url: httpUrlSchema,
  label: z.string().trim().min(1, 'Give this site a name.').max(120),
  target: conformanceLevel.default('AA'),
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = createSiteSchema.partial();
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

// ── Watches ──────────────────────────────────────────────────────────────────

export const createWatchSchema = z.object({
  siteId: z.string().uuid(),
  interval: z.enum(WATCH_INTERVALS).default('daily'),
  auditUnchanged: z.boolean().default(false),
});
export type CreateWatchInput = z.infer<typeof createWatchSchema>;

export const updateWatchSchema = z.object({
  interval: z.enum(WATCH_INTERVALS).optional(),
  status: z.enum(WATCH_STATUSES).optional(),
  auditUnchanged: z.boolean().optional(),
});
export type UpdateWatchInput = z.infer<typeof updateWatchSchema>;

// ── Journeys ─────────────────────────────────────────────────────────────────

export const stepExpectationSchema = z.object({
  focusWithin: z.string().trim().min(1).max(200).optional(),
  /** `true` means "something must be announced"; a string must be contained in it. */
  announces: z.union([z.literal(true), z.string().trim().min(1).max(200)]).optional(),
  keyboardOnly: z.boolean().optional(),
  dialogOpen: z.boolean().optional(),
});

export const journeyStepSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(160),
  action: z.enum(STEP_ACTIONS),
  target: z.string().trim().max(500).optional(),
  expect: stepExpectationSchema.optional(),
});

export const createJourneySchema = z.object({
  name: z.string().trim().min(1, 'Give this journey a name.').max(160),
  description: z.string().trim().max(1000).default(''),
  startUrl: httpUrlSchema,
  siteId: z.string().uuid().nullish(),
  // A journey with no steps is still useful — it monitors ad-hoc recordings
  // against the rules without asserting anything specific.
  steps: z.array(journeyStepSchema).max(100).default([]),
});
export type CreateJourneyInput = z.infer<typeof createJourneySchema>;

export const updateJourneySchema = createJourneySchema.partial();
export type UpdateJourneyInput = z.infer<typeof updateJourneySchema>;

/**
 * One recorded message.
 *
 * Validated structurally rather than per message type: the tracker is deployed
 * on customers' pages and will outlive several server versions, so a message we
 * do not recognise must be ignorable, not a reason to reject the whole trace.
 * The reconstructor already skips unknown type ids.
 */
export const traceMessageSchema = z.object({
  t: z.number().int().min(0).max(255),
  o: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  id: z.number().int().min(0).optional(),
  p: z.number().int().min(0).optional(),
  i: z.number().int().min(0).optional(),
  r: z.string().max(64).optional(),
  v: z.string().max(2048).optional(),
  s: z.string().max(64).optional(),
  n: z.number().optional(),
  m: z.number().optional(),
  b: z.boolean().optional(),
});

/**
 * A posted trace.
 *
 * `organisationId` is deliberately absent: tenancy comes from the request, not
 * from a body a customer's browser composed. Accepting it here would let any
 * page post into any tenant.
 */
export const ingestTraceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  journeyId: z.string().uuid().nullish(),
  version: z.number().int().min(1).max(1_000),
  startedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  url: httpUrlSchema,
  messages: z.array(traceMessageSchema).max(50_000),
  client: z.object({
    viewportWidth: z.number().int().min(0).max(20_000),
    viewportHeight: z.number().int().min(0).max(20_000),
    prefersReducedMotion: z.boolean(),
    forcedColors: z.boolean(),
  }),
});
export type IngestTraceInput = z.infer<typeof ingestTraceSchema>;

// ── Organisations ────────────────────────────────────────────────────────────

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  plan: z.enum(SUBSCRIPTION_PLANS).default('free'),
});
export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;

// ── Shared envelopes ─────────────────────────────────────────────────────────

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * RFC 9457 "Problem Details for HTTP APIs" — the API speaks this for every
 * error so clients have one shape to handle.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  /** Field-level validation messages, keyed by dotted path. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

export const idParamSchema = z.object({ id: z.string().uuid() });
