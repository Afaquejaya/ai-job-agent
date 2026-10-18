import { createCandidateProfileRepository } from '@job-agent/database';
import type { Metadata } from 'next';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/session';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile · AI Job Agent' };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await createCandidateProfileRepository(getDatabase()).getForUser(user.userId);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Candidate profile</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Only what you enter or explicitly accept from your CV is stored. Empty fields stay
          &ldquo;not provided&rdquo; &mdash; nothing is guessed.
        </p>
      </header>
      <ProfileForm initial={profile} />
    </div>
  );
}
