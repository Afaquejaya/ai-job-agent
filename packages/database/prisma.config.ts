import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files. Load the repository-root .env for local development;
// variables that are already set (CI, hosting, test scripts) are never overridden.
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection when the provider offers one.
    url: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL,
  },
});
