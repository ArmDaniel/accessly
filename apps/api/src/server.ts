import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { createContainer, type Container, type ContainerOverrides } from './container.js';
import { registerErrorHandler } from './http/error-handler.js';
import { problem } from './http/problem.js';
import { registerAuditRoutes } from './routes/audits.routes.js';
import { registerMetaRoutes } from './routes/meta.routes.js';
import { registerSiteRoutes } from './routes/sites.routes.js';
import { registerWatchRoutes } from './routes/watches.routes.js';

export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly container: Container;
}

/**
 * Build the HTTP application without starting it.
 *
 * Tests use this with `app.inject()`, so the whole API is exercised over real
 * routing, validation and serialisation without binding a port.
 */
export async function buildServer(
  config: Config,
  overrides: ContainerOverrides = {},
): Promise<BuiltServer> {
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : { level: config.logLevel, transport: undefined },
    // The audit endpoint accepts pasted documents, so the body limit is the
    // document limit plus headroom for the JSON envelope.
    bodyLimit: config.maxDocumentBytes + 64 * 1024,
    trustProxy: true,
  });

  await app.register(helmet, {
    // The API serves JSON only; a restrictive default CSP is free here.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-accessly-organisation'],
    maxAge: 86400,
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    // Auditing is the expensive endpoint; everything else is cheap reads.
    keyGenerator: (request) => request.ip,
    // The default error builder is a plain Error with statusCode 429, which
    // our error handler turns into the same application/problem+json shape as
    // every other error — one error format for the whole API, as advertised.
    // The plugin also sets the retry-after header for us.
  });

  registerErrorHandler(app);

  const container = createContainer(config, {
    logger: app.log,
    ...overrides,
  });

  registerMetaRoutes(app, container);
  registerAuditRoutes(app, container);
  registerSiteRoutes(app, container);
  registerWatchRoutes(app, container);

  app.get('/', async (_request, reply) =>
    problem(
      reply,
      404,
      'route_not_found',
      'This is the Accessly API.',
      'See /health for status and /v1/rules for the rule catalogue.',
    ),
  );

  return { app, container };
}
