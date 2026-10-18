import { Prisma } from './generated/prisma/client';

/** The record does not exist for this user (also used for other users' records: no leaking). */
export class NotFoundError extends Error {
  constructor(readonly entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

/** The request conflicts with the current state (duplicate, rule violation). Safe to show. */
export class ConflictError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Data failed domain validation (e.g. the merged profile breaks a cross-field rule). */
export class DomainValidationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super('Validation failed');
    this.name = 'DomainValidationError';
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
