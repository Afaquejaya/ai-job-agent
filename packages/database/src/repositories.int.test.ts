import { randomUUID } from 'node:crypto';
import type { UserId } from '@job-agent/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAuditLog,
  createCandidateProfileRepository,
  createDatabaseClient,
  createDatabaseProbe,
  createUserSettingsRepository,
  type Database,
} from './index';

let db: Database;

async function createTestUser(): Promise<UserId> {
  const user = await db.user.create({
    data: { name: 'Integration Test', email: `${randomUUID()}@example.test` },
  });
  return user.id as UserId;
}

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require TEST_DATABASE_URL pointing at a *_test database');
  }
  db = createDatabaseClient(url);
});

afterAll(async () => {
  await db?.$disconnect();
});

describe('migrations and connectivity', () => {
  it('reports the database as up', async () => {
    expect(await createDatabaseProbe(db).ping()).toBe('up');
  });

  it('has applied the initial migration', async () => {
    const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(rows.map((r) => r.migration_name)).toContain('20261018120000_init');
  });
});

describe('user settings', () => {
  it('creates safe defaults on first read', async () => {
    const userId = await createTestUser();
    const settings = await createUserSettingsRepository(db).getOrCreate(userId);
    expect(settings).toMatchObject({
      timeZone: 'UTC',
      submissionMode: 'manual_only',
      dailyApplicationLimit: 20,
      targetCountries: [],
    });
  });

  it("keeps one user's changes invisible to another user", async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const repo = createUserSettingsRepository(db);

    await repo.update(alice, { timeZone: 'Asia/Dubai', submissionMode: 'approve_each' });

    expect((await repo.getOrCreate(alice)).timeZone).toBe('Asia/Dubai');
    expect(await repo.getOrCreate(bob)).toMatchObject({
      timeZone: 'UTC',
      submissionMode: 'manual_only',
    });
  });

  it('audits changed field names (not values) in the same transaction', async () => {
    const userId = await createTestUser();
    const repo = createUserSettingsRepository(db);

    const result = await repo.update(userId, {
      timeZone: 'Asia/Kolkata',
      dailyApplicationLimit: 20,
    });
    expect(result.changedFields).toEqual(['timeZone']);

    const [entry] = await createAuditLog(db).listForUser(userId);
    expect(entry).toMatchObject({
      action: 'settings.updated',
      actor: 'user',
      metadata: { changedFields: 'timeZone' },
    });
    expect(JSON.stringify(entry?.metadata)).not.toContain('Asia/Kolkata');
  });

  it('writes no audit entry when nothing changes', async () => {
    const userId = await createTestUser();
    const repo = createUserSettingsRepository(db);
    const result = await repo.update(userId, { dailyApplicationLimit: 20 });
    expect(result.changedFields).toEqual([]);
    expect(await createAuditLog(db).listForUser(userId)).toEqual([]);
  });

  it('enforces the daily limit range in the database itself', async () => {
    const userId = await createTestUser();
    await expect(
      db.userSettings.create({ data: { userId, dailyApplicationLimit: 51 } }),
    ).rejects.toThrow();
  });
});

describe('candidate profiles', () => {
  it('scopes profiles to their owner', async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const repo = createCandidateProfileRepository(db);

    await repo.upsert(alice, { headline: 'Data analyst' });

    expect((await repo.findByUser(alice))?.headline).toBe('Data analyst');
    expect(await repo.findByUser(bob)).toBeNull();
  });
});

describe('audit log', () => {
  it("lists only the requesting user's entries", async () => {
    const [alice, bob] = [await createTestUser(), await createTestUser()];
    const audit = createAuditLog(db);
    await audit.append({
      userId: alice,
      action: 'settings.updated',
      actor: 'user',
      targetType: 'user_settings',
      targetId: alice,
      metadata: { changedFields: 'timeZone' },
      occurredAt: new Date(),
    });

    expect(await audit.listForUser(alice)).toHaveLength(1);
    expect(await audit.listForUser(bob)).toHaveLength(0);
  });

  it('rejects updates to existing entries (append-only)', async () => {
    const userId = await createTestUser();
    await createAuditLog(db).append({
      userId,
      action: 'settings.updated',
      actor: 'user',
      targetType: 'user_settings',
      targetId: userId,
      metadata: {},
      occurredAt: new Date(),
    });
    await expect(
      db.auditLog.updateMany({ where: { userId }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('removes a user’s private rows when the account is deleted', async () => {
    const userId = await createTestUser();
    await createUserSettingsRepository(db).update(userId, { timeZone: 'Asia/Dubai' });
    await db.user.delete({ where: { id: userId } });
    expect(await db.userSettings.findUnique({ where: { userId } })).toBeNull();
    expect(await db.auditLog.count({ where: { userId } })).toBe(0);
  });
});
