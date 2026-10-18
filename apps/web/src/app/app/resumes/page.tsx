import { createResumeRepository } from '@job-agent/database';
import type { Metadata } from 'next';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/session';
import { ResumesClient } from './resumes-client';

export const metadata: Metadata = { title: 'CVs · AI Job Agent' };

export default async function ResumesPage() {
  const user = await requireUser();
  const resumes = await createResumeRepository(getDatabase()).listForUser(user.userId);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">CVs</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Every upload is kept as its own version. Files are stored privately and encrypted. Text is
          extracted automatically; contact details found in the CV are only suggestions until you
          accept them.
        </p>
      </header>
      <ResumesClient initial={resumes} />
    </div>
  );
}
