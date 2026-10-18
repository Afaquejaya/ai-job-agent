/**
 * Persistence primitives shared by all repository implementations.
 *
 * Phase 1 status: no Prisma schema, migrations or repositories exist yet. The proposed schema
 * is documented in docs/architecture/database-design.md and is implemented from Phase 2.
 * Domain packages define the ports (e.g. `TaskStore` in @job-agent/agent-core); this package
 * will hold the Prisma-backed adapters.
 */

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

/** Runs `work` in one database transaction. Implemented with Prisma in Phase 2. */
export interface TransactionRunner<Tx> {
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Connectivity probe used by the /health endpoints once the database exists. */
export interface DatabaseProbe {
  ping(signal: AbortSignal): Promise<'up' | 'down'>;
}
