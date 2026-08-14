import type { FastifyInstance } from 'fastify';
import {
  createAuditSchema,
  idParamSchema,
  listAuditsQuerySchema,
} from '@accessly/contracts';
import type { Container } from '../container.js';
import { organisationIdFrom } from '../http/context.js';

export function registerAuditRoutes(app: FastifyInstance, container: Container): void {
  /**
   * Run an audit.
   *
   * Synchronous on purpose for this phase: a single-document audit completes in
   * milliseconds, and a 202-plus-polling flow would add latency and complexity
   * for no benefit. Crawling multiple pages will need a job queue, and that is
   * the point at which this becomes 202 Accepted.
   */
  app.post('/v1/audits', async (request, reply) => {
    const input = createAuditSchema.parse(request.body);
    const report = await container.services.audits.create(input, organisationIdFrom(request));
    return reply.code(201).send(report);
  });

  app.get('/v1/audits', async (request) => {
    const query = listAuditsQuerySchema.parse(request.query);
    // Scoped to the calling organisation: without this the endpoint would list
    // every tenant's reports.
    return container.services.audits.list(query, organisationIdFrom(request));
  });

  app.get('/v1/audits/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return container.services.audits.findById(id, organisationIdFrom(request));
  });

  /** What changed since the previous audit of the same site. */
  app.get('/v1/audits/:id/diff', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const diff = await container.services.audits.diffWithPrevious(id, organisationIdFrom(request));
    if (!diff) {
      return reply.code(204).send();
    }
    return diff;
  });
}
