/**
 * Domain errors.
 *
 * Services throw these; the HTTP layer is the only place that knows they map to
 * status codes. That keeps the services usable from a CLI, a queue worker or a
 * test without dragging HTTP semantics along with them.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  readonly status = 404;

  constructor(resource: string, id: string) {
    super(`${resource} not found`, `No ${resource.toLowerCase()} exists with id "${id}".`);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'validation_failed';
  readonly status = 422;

  constructor(
    message: string,
    readonly fields: Readonly<Record<string, readonly string[]>> = {},
  ) {
    super(message);
  }
}

/** The caller asked us to fetch something we will not fetch. */
export class ForbiddenTargetError extends DomainError {
  readonly code = 'forbidden_target';
  readonly status = 400;
}

/** We tried to fetch the page and could not. Not the caller's fault. */
export class FetchFailedError extends DomainError {
  readonly code = 'fetch_failed';
  readonly status = 502;
}

export class ConflictError extends DomainError {
  readonly code = 'conflict';
  readonly status = 409;
}
