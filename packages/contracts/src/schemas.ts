import { z } from 'zod';
import { CONFORMANCE_LEVELS } from './wcag.js';
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

export const createAuditSchema = z.discriminatedUnion('source', [
  createUrlAuditSchema,
  createInlineAuditSchema,
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
