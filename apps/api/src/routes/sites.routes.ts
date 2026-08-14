import type { FastifyInstance } from 'fastify';
import {
  createSiteSchema,
  idParamSchema,
  listAuditsQuerySchema,
  updateSiteSchema,
} from '@accessly/contracts';
import type { Container } from '../container.js';
import { organisationIdFrom } from '../http/context.js';

export function registerSiteRoutes(app: FastifyInstance, container: Container): void {
  app.post('/v1/sites', async (request, reply) => {
    const input = createSiteSchema.parse(request.body);
    const site = await container.services.sites.create(organisationIdFrom(request), input);
    return reply.code(201).send(site);
  });

  app.get('/v1/sites', async (request) => {
    const items = await container.services.sites.listByOrganisation(organisationIdFrom(request));
    return { items, nextCursor: null };
  });

  app.get('/v1/sites/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return container.services.sites.findById(id, organisationIdFrom(request));
  });

  app.patch('/v1/sites/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const patch = updateSiteSchema.parse(request.body);
    return container.services.sites.update(id, patch, organisationIdFrom(request));
  });

  app.delete('/v1/sites/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await container.services.sites.delete(id, organisationIdFrom(request));
    return reply.code(204).send();
  });

  /** Audits for one site, newest first. Honours limit and cursor like /v1/audits. */
  app.get('/v1/sites/:id/audits', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { siteId: _ignored, ...query } = listAuditsQuerySchema.parse(request.query);
    await container.services.sites.findById(id, organisationIdFrom(request));
    return container.services.audits.list({ ...query, siteId: id }, organisationIdFrom(request));
  });
}
