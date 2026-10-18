import type { Metadata } from 'next';
import { listConversations } from '@/server/agent/turn';
import { getAiStatus } from '@/server/ai';
import { requireUser } from '@/server/session';
import { AgentClient } from './agent-client';

export const metadata: Metadata = { title: 'Agent · AI Job Agent' };

export default async function AgentPage() {
  const user = await requireUser();
  const [usage, conversations] = await Promise.all([
    getAiStatus(user.userId),
    listConversations(user.userId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agent</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Paste a job description (and its link, if you have one) and the agent saves it, checks it
          against your CV and profile, and explains the match with quotes. Every step it takes is
          shown. It can only read your data and save jobs: it cannot apply, send messages or browse.
        </p>
      </header>
      <AgentClient initialUsage={usage} initialConversations={conversations} />
    </div>
  );
}
