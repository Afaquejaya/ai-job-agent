/**
 * Persistence layer: Prisma client, repositories and adapters for domain ports.
 *
 * Rules:
 * - Every repository method that touches private data takes the owning `userId` and filters
 *   by it. There is no unscoped lookup of private records.
 * - Repositories return plain records, not Prisma types, so callers never depend on Prisma.
 *
 * Implemented tables (Phase 2): users, sessions, accounts, verifications, auth_rate_limits,
 * user_settings, candidate_profiles, audit_logs. The full proposed schema is documented in
 * docs/architecture/database-design.md.
 */
export * from './audit-log';
export * from './candidate-profile-repository';
export * from './client';
export * from './probe';
export * from './user-settings-repository';

/** Thrown when a row changed between read and write (optimistic concurrency). */
export class VersionConflictError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} ${id} was modified concurrently`);
    this.name = 'VersionConflictError';
  }
}
