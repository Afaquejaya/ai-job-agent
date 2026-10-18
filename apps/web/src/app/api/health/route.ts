import { createDatabaseProbe } from '@job-agent/database';
import { getDatabase } from '@/server/db';
import { buildWebHealth } from '@/server/health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const health = await buildWebHealth(process.env, () => createDatabaseProbe(getDatabase()));
  return Response.json(health, {
    status: health.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
