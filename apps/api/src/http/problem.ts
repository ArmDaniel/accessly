import type { FastifyReply } from 'fastify';
import type { ProblemDetails } from '@accessly/contracts';

/**
 * RFC 9457 Problem Details.
 *
 * One error shape for the whole API. The frontend renders `title` in a live
 * region and `errors` next to the offending fields, so both must be written for
 * a person to read aloud, not for a log.
 */
const TYPE_BASE = 'https://accessly.eu/problems/';

export function problem(
  reply: FastifyReply,
  status: number,
  code: string,
  title: string,
  detail?: string,
  errors?: Readonly<Record<string, readonly string[]>>,
): FastifyReply {
  const body: ProblemDetails = {
    type: `${TYPE_BASE}${code}`,
    title,
    status,
    ...(detail ? { detail } : {}),
    ...(errors ? { errors } : {}),
    instance: reply.request.url,
  };

  return reply.code(status).type('application/problem+json').send(body);
}
