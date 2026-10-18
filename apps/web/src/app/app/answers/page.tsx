import { createAnswerRepository } from '@job-agent/database';
import type { Metadata } from 'next';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/session';
import { AnswersClient } from './answers-client';

export const metadata: Metadata = { title: 'Answers · AI Job Agent' };

export default async function AnswersPage() {
  const user = await requireUser();
  const answers = await createAnswerRepository(getDatabase()).list(user.userId);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reusable answers</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Answers to questions application forms ask again and again. Only answers you have
          <strong> verified </strong> will ever be used to fill a form. Editing a verified answer
          turns it back into a draft until you verify it again.
        </p>
      </header>
      <AnswersClient initial={answers} />
    </div>
  );
}
