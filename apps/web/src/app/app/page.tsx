import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/server/session';

export default async function DashboardPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
      <Card title="Set up your profile">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Upload your CV on the{' '}
            <Link href="/app/resumes" className="text-blue-600 underline dark:text-blue-400">
              CVs
            </Link>{' '}
            page. Text is extracted, and contact details are offered as suggestions you can accept.
          </li>
          <li>
            Complete your{' '}
            <Link href="/app/profile" className="text-blue-600 underline dark:text-blue-400">
              profile
            </Link>
            . Anything you leave empty stays &ldquo;not provided&rdquo;.
          </li>
          <li>
            Save and verify{' '}
            <Link href="/app/answers" className="text-blue-600 underline dark:text-blue-400">
              answers
            </Link>{' '}
            to common application questions. Only verified answers will ever be reused.
          </li>
          <li>
            Check your{' '}
            <Link href="/app/settings" className="text-blue-600 underline dark:text-blue-400">
              settings
            </Link>
            . By default the agent never submits anything on your behalf.
          </li>
        </ol>
      </Card>
      <Card title="Coming next">
        <p>
          Background tasks (Phase 3), then AI providers and chat (Phase 4, including AI-assisted CV
          analysis).
        </p>
      </Card>
    </div>
  );
}
