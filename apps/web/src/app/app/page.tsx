import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/server/session';

export default async function DashboardPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">You are signed in</h1>
      <Card title="What works now">
        <p>
          Your account and{' '}
          <Link href="/app/settings" className="text-blue-600 underline dark:text-blue-400">
            settings
          </Link>{' '}
          (time zone, submission mode, daily limit, target countries). Settings default to the
          safest option: the agent never submits on your behalf until you change it.
        </p>
      </Card>
      <Card title="Coming next">
        <p>
          Background tasks (Phase 3), AI providers and chat (Phase 4), CV and profile (Phase 5).
        </p>
      </Card>
    </div>
  );
}
