import { createUserSettingsRepository } from '@job-agent/database';
import type { Metadata } from 'next';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/session';
import { AiConsentSection } from './ai-consent-section';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Settings · AI Job Agent' };

export default async function SettingsPage() {
  const user = await requireUser();
  const settings = await createUserSettingsRepository(getDatabase()).getOrCreate(user.userId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <SettingsForm initial={settings} />
      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-base font-semibold">AI processing</h2>
        <AiConsentSection initialConsent={settings.aiProcessingConsentAt !== null} />
      </section>
    </div>
  );
}
