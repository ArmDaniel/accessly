import { randomUUID } from 'node:crypto';

/**
 * Time and identity as injected dependencies.
 *
 * The watcher is a scheduler — nearly every rule it follows is a statement
 * about time. Injecting the clock is what makes those rules testable without
 * waiting for real minutes to pass.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock the tests drive by hand. */
export class FixedClock implements Clock {
  #current: Date;

  constructor(start: Date | string = '2026-01-01T00:00:00.000Z') {
    this.#current = new Date(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(value: Date | string): void {
    this.#current = new Date(value);
  }
}

export interface IdGenerator {
  next(): string;
}

export const uuidGenerator: IdGenerator = {
  next: () => randomUUID(),
};

/** Deterministic ids, so report snapshots are stable across test runs. */
export class SequentialIdGenerator implements IdGenerator {
  #counter = 0;

  constructor(private readonly prefix = '00000000-0000-4000-8000') {}

  next(): string {
    this.#counter += 1;
    return `${this.prefix}-${String(this.#counter).padStart(12, '0')}`;
  }
}
