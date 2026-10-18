// Applies migrations to the TEST database only (non-destructive `prisma migrate deploy`).
// Refuses to run unless TEST_DATABASE_URL points at a database whose name ends in "_test",
// so development or production data can never be targeted by test tooling.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  console.error(`Refusing to migrate "${databaseName}": test database names must end in "_test".`);
  process.exit(1);
}

execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url, DATABASE_DIRECT_URL: '' },
});
