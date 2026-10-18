/**
 * Seeds SYNTHETIC development data: one demo account with settings and a profile headline.
 *
 * - Goes through the real Better Auth sign-up path, so the password is hashed properly.
 * - The password comes from SEED_DEMO_PASSWORD (you choose it); nothing is hard-coded or
 *   printed. Run: pnpm db:seed
 * - Idempotent: running it twice does not create duplicates.
 * - Refuses to run when NODE_ENV=production.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  createCandidateProfileRepository,
  createUserSettingsRepository,
} from '@job-agent/database';
import type { UserId } from '@job-agent/shared';

const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const DEMO_EMAIL = 'demo@example.test';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Set SEED_DEMO_PASSWORD (at least 12 characters) in .env before seeding.');
  }

  const { getDatabase } = await import('../src/server/db');
  const { getAuth } = await import('../src/server/auth');
  const db = getDatabase();

  let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    await getAuth().api.signUpEmail({
      body: { email: DEMO_EMAIL, password, name: 'Demo Candidate' },
    });
    user = await db.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    console.log(`Created demo account ${DEMO_EMAIL}`);
  } else {
    console.log(`Demo account ${DEMO_EMAIL} already exists; updating its synthetic data`);
  }

  const userId = user.id as UserId;
  await createUserSettingsRepository(db).update(userId, {
    timeZone: 'Asia/Kolkata',
    targetCountries: ['IN', 'AE'],
  });
  await createCandidateProfileRepository(db).upsert(userId, {
    headline: 'Synthetic demo profile - not a real person',
  });
  await db.$disconnect();
  console.log('Seed complete.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
