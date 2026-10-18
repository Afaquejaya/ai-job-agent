import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { requireUser } from '@/server/session';

// Everything under /app requires a session. Layouts are not re-rendered on client-side
// navigation, so every page under /app ALSO calls requireUser() itself.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <nav className="mx-auto flex max-w-3xl items-center gap-5 px-4 py-3 sm:px-6">
          <Link href="/app" className="font-semibold">
            AI Job Agent
          </Link>
          <Link
            href="/app/settings"
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Settings
          </Link>
          <span className="ml-auto">
            <SignOutButton />
          </span>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
