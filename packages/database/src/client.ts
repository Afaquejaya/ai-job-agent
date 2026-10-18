import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type Database = PrismaClient;

/**
 * Creates a Prisma client over node-postgres. Prisma 7 talks to the database through a
 * driver adapter; there is no separate query-engine binary at runtime.
 */
export function createDatabaseClient(connectionString: string): Database {
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 });
  return new PrismaClient({ adapter });
}
