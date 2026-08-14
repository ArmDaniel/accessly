import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError, ValidationError } from '../domain/errors.js';
import { problem } from './problem.js';

/** Turn a Zod issue tree into `{ "field.path": ["message"] }`. */
export function fieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    problem(
      reply,
      404,
      'route_not_found',
      'That endpoint does not exist.',
      `No route matches ${request.method} ${request.url}.`,
    ),
  );

  app.setErrorHandler((rawError: unknown, request, reply) => {
    /*
     * A handler can throw anything, including non-Errors (`throw undefined`
     * happens in the wild). Property access below must be guarded or the
     * error handler itself throws and the client gets a bare 500 with none
     * of the problem shape the API promises.
     */
    const asError = rawError instanceof Error ? rawError : null;
    const status = typeof (rawError as { statusCode?: unknown })?.statusCode === 'number'
      ? (rawError as { statusCode: number }).statusCode
      : 500;
    const code = typeof (rawError as { code?: unknown })?.code === 'string'
      ? (rawError as { code: string }).code
      : undefined;

    if (rawError instanceof ZodError) {
      return problem(
        reply,
        422,
        'validation_failed',
        'Some of the details you sent are not valid.',
        'Check the highlighted fields and try again.',
        fieldErrors(rawError),
      );
    }

    if (rawError instanceof ValidationError) {
      return problem(reply, rawError.status, rawError.code, rawError.message, rawError.detail, rawError.fields);
    }

    if (rawError instanceof DomainError) {
      return problem(reply, rawError.status, rawError.code, rawError.message, rawError.detail);
    }

    // Rate limiting rejects with a bare Error carrying statusCode 429.
    if (status === 429) {
      return problem(
        reply,
        429,
        'rate_limited',
        'Too many requests.',
        'Please wait a moment before scanning again.',
      );
    }

    // Fastify's own errors (bad JSON, payload too large) carry a usable
    // statusCode; anything without one is genuinely unexpected.
    if (asError && status < 500) {
      return problem(reply, status, code ?? 'bad_request', asError.message);
    }

    request.log.error({ err: rawError }, 'unhandled error');
    return problem(
      reply,
      500,
      'internal_error',
      'Something went wrong on our side.',
      'The failure has been logged. Please try again, and contact support if it persists.',
    );
  });
}
