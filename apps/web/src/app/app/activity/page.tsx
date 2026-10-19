import { createTaskRepository } from '@job-agent/database';
import type { Metadata } from 'next';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/session';
import { toTaskSummary } from '@/server/tasks';
import { ActivityClient } from './activity-client';

export const metadata: Metadata = { title: 'Activity · AI Job Agent' };

export default async function ActivityPage() {
  const user = await requireUser();
  const tasks = await createTaskRepository(getDatabase()).listForUser(user.userId, 50);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Work running in the background: job searches, match analyses and CV text extraction. Each
          task keeps a timeline of every step, so you can see what happened, how long it took, and
          why it retried or stopped. You can close the website while tasks run.
        </p>
      </header>
      <ActivityClient initialTasks={tasks.map((t) => toTaskSummary(t))} />
    </div>
  );
}
