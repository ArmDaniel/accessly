import type { FastifyRequest } from 'fastify';

/**
 * Tenant resolution.
 *
 * Authentication is out of scope for this phase, and pretending otherwise
 * would be worse than being explicit: every request currently resolves to the
 * demo organisation unless it names another one.
 *
 * When auth lands, this is the only function that changes — every route and
 * service already reads the organisation from here rather than assuming one.
 */
export const DEMO_ORGANISATION_ID = '00000000-0000-4000-8000-000000000001';

export const ORGANISATION_HEADER = 'x-accessly-organisation';

export function organisationIdFrom(request: FastifyRequest): string {
  const header = request.headers[ORGANISATION_HEADER];
  if (typeof header === 'string' && header.trim().length > 0) return header.trim();
  return DEMO_ORGANISATION_ID;
}
