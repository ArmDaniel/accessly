import type { FastifyInstance } from 'fastify';
import { createWatchSchema, idParamSchema, updateWatchSchema } from '@accessly/contracts';
import type { Container } from '../container.js';
import { organisationIdFrom } from '../http/context.js';

export function registerWatchRoutes(app: FastifyInstance, container: Container): void {
  app.post('/v1/watches', async (request, reply) => {
    const input = createWatchSchema.parse(request.body);
    const watch = await container.services.watches.create(input, organisationIdFrom(request));
    return reply.code(201).send(watch);
  });

  app.get('/v1/watches', async (request) => {
    const items = await container.services.watches.listByOrganisation(organisationIdFrom(request));
    return { items, nextCursor: null };
  });

  app.get('/v1/watches/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return container.services.watches.findById(id, organisationIdFrom(request));
  });

  app.patch('/v1/watches/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const patch = updateWatchSchema.parse(request.body);
    return container.services.watches.update(id, patch, organisationIdFrom(request));
  });

  app.delete('/v1/watches/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await container.services.watches.delete(id, organisationIdFrom(request));
    return reply.code(204).send();
  });

  /** The monitoring timeline — this is the compliance evidence trail. */
  app.get('/v1/watches/:id/events', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const items = await container.services.watches.history(id, organisationIdFrom(request));
    return { items, nextCursor: null };
  });

  /**
   * Force a poll now, without waiting for the schedule.
   * Used by "Check now" in the dashboard, and by customer CI pipelines that
   * want a re-check the moment they deploy.
   */
  app.post('/v1/watches/:id/poll', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const watch = await container.services.watches.findById(id, organisationIdFrom(request));
    return container.watcher.poll(watch);
  });
}
