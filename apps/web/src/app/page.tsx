import Link from 'next/link';
import { Card } from '@/components/ui/card';

const PLANNED = [
  'Background tasks with retries and checkpoints (Phase 3)',
  'Chat interface and AI providers (Phase 4)',
  'CV upload, analysis and candidate profile (Phase 5)',
  'Job discovery, matching and tailored documents (Phases 6–7)',
  'Application tracker, approvals, manual handoffs and overnight runs (Phases 8–11)',
];

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm font-medium text-zinc-500">Phase 2: accounts and settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">AI Job Agent</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          You can create an account, sign in and choose your settings. No job search, application or
          AI features are implemented yet.
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/sign-in"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Create account
          </Link>
        </div>
      </header>

      <Card title="Service status">
        <p>
          Web health check:{' '}
          <a className="font-mono text-blue-600 underline dark:text-blue-400" href="/api/health">
            /api/health
          </a>
        </p>
        <p>Worker health check: GET /health on the worker port (default 8081).</p>
      </Card>

      <Card title="Coming in later phases">
        <ul className="list-disc space-y-1 pl-5">
          {PLANNED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
