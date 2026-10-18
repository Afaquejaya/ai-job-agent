import { buildWebHealth } from '@/server/health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const health = buildWebHealth(process.env);
  return Response.json(health, {
    status: health.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
