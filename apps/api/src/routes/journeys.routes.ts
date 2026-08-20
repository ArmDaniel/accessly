import type { FastifyInstance } from 'fastify';
import {
  createJourneySchema,
  idParamSchema,
  ingestTraceSchema,
  listAuditsQuerySchema,
  updateJourneySchema,
} from '@accessly/contracts';
import type { Container } from '../container.js';
import { organisationIdFrom } from '../http/context.js';

export function registerJourneyRoutes(app: FastifyInstance, container: Container): void {
  const journeys = container.services.journeys;

  app.post('/v1/journeys', async (request, reply) => {
    const input = createJourneySchema.parse(request.body);
    const journey = await journeys.create(input, organisationIdFrom(request));
    return reply.code(201).send(journey);
  });

  app.get('/v1/journeys', async (request) => {
    const items = await journeys.listByOrganisation(organisationIdFrom(request));
    return { items, nextCursor: null };
  });

  app.get('/v1/journeys/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return journeys.findById(id, organisationIdFrom(request));
  });

  app.patch('/v1/journeys/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const patch = updateJourneySchema.parse(request.body);
    return journeys.update(id, patch, organisationIdFrom(request));
  });

  app.delete('/v1/journeys/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await journeys.delete(id, organisationIdFrom(request));
    return reply.code(204).send();
  });

  app.get('/v1/journeys/:id/reports', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { limit, cursor } = listAuditsQuerySchema.parse(request.query);
    return journeys.listReports({
      organisationId: organisationIdFrom(request),
      journeyId: id,
      limit,
      cursor,
    });
  });

  /**
   * Trace ingestion — the tracker's endpoint.
   *
   * This is the only route posted to by a script running on someone else's
   * page, which is why the trace's tenancy is taken from the request context
   * rather than from the body. It answers 201 with the report because a CI
   * pipeline that posts a trace wants the verdict in the same round trip.
   */
  app.post('/v1/traces', async (request, reply) => {
    const input = ingestTraceSchema.parse(request.body);
    const report = await journeys.ingest(input, organisationIdFrom(request));
    return reply.code(201).send(report);
  });

  app.get('/v1/journey-reports', async (request) => {
    const { limit, cursor } = listAuditsQuerySchema.parse(request.query);
    return journeys.listReports({
      organisationId: organisationIdFrom(request),
      limit,
      cursor,
    });
  });

  app.get('/v1/journey-reports/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return journeys.findReport(id, organisationIdFrom(request));
  });

  /** The raw messages behind a report — the evidence, for export or re-analysis. */
  app.get('/v1/traces/:id', async (request) => {
    const id = String((request.params as { id?: string }).id ?? '');
    return journeys.findTrace(id, organisationIdFrom(request));
  });
}
