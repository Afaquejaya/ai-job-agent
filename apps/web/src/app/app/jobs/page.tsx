import type { Metadata } from 'next';
import { getAiStatus } from '@/server/ai';
import { listJobsWithOverlap } from '@/server/matching';
import { requireUser } from '@/server/session';
import { JobsClient } from './jobs-client';

export const metadata: Metadata = { title: 'Jobs · AI Job Agent' };

export default async function JobsPage() {
  const user = await requireUser();
  const [jobs, usage] = await Promise.all([
    listJobsWithOverlap(user.userId),
    getAiStatus(user.userId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Jobs you saved here or through the agent. Links are kept for reference only and are never
          opened by the app. A match analysis compares the job with your primary CV and profile and
          quotes the evidence for every point.
        </p>
      </header>
      <JobsClient initialJobs={jobs} initialUsage={usage} />
    </div>
  );
}
