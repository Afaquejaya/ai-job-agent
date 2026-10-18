import { Card } from '@/components/ui/card';

const PLANNED = [
  'Chat interface to control the agent',
  'CV upload, analysis and candidate profile',
  'Job discovery, matching and tailored documents',
  'Application tracker, approvals and manual handoffs',
  'Overnight runs and morning reports',
];

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm font-medium text-zinc-500">Phase 1 foundation</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">AI Job Agent</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          The project skeleton is in place. No job search, application or AI features are
          implemented yet.
        </p>
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
