'use client';

import type { JobSearchSuggestion, TaskSummary } from '@job-agent/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { TaskStatus, useTask } from '@/components/tasks/task-status';
import { apiErrorMessage } from '@/components/ui/api-error';
import { Alert, Button, Field, TextInput } from '@/components/ui/form';

const splitList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * "Find jobs for me" (D-049): the search suggested from the CV, editable, run in the background.
 * Matching jobs are added to the list below, best skills match first.
 */
export function FindJobs({ onFinished }: { onFinished: () => void }) {
  const [suggestion, setSuggestion] = useState<JobSearchSuggestion | null>(null);
  const [keywords, setKeywords] = useState('');
  const [countries, setCountries] = useState('');
  const [remoteOk, setRemoteOk] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useTask(null, () => onFinished());

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/job-search');
      if (!response.ok) return;
      const data = (await response.json()) as JobSearchSuggestion;
      setSuggestion(data);
      if (data.plan) {
        setKeywords(data.plan.keywords.join(', '));
        setCountries(data.plan.countries.join(', '));
        setRemoteOk(data.plan.remoteOk);
      }
    })();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch('/api/job-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: splitList(keywords).slice(0, 3),
        countries: splitList(countries).map((c) => c.toUpperCase()),
        remoteOk,
      }),
    });
    setPending(false);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiErrorMessage(body, 'The search could not be started.'));
      return;
    }
    setTask((body as { task: TaskSummary }).task);
  }

  if (suggestion && !suggestion.plan) {
    return (
      <p className="text-sm text-zinc-500">
        Upload your CV (CVs page) and the agent can find jobs that match it.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-semibold">Find jobs for me</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Searches job sites for roles like yours and saves the ones whose skills match your CV best
          (up to 25 per search). Suggested from your CV
          {suggestion?.plan?.topSkills.length
            ? ` (top skills: ${suggestion.plan.topSkills.join(', ')})`
            : ''}
          ; change anything before searching. The agent only reads listings: it never signs in or
          applies.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Roles to search (comma separated, up to 3)">
            <TextInput required value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </Field>
          <Field label="Countries (codes, e.g. IN, AE, SA)">
            <TextInput required value={countries} onChange={(e) => setCountries(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remoteOk}
            onChange={(e) => setRemoteOk(e.target.checked)}
          />
          Include remote jobs open to these countries
        </label>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" disabled={pending || Boolean(task?.active)} className="self-start">
          {pending ? 'Starting…' : task?.active ? 'Searching…' : 'Find jobs for me'}
        </Button>
      </form>
      {task ? (
        <TaskStatus
          task={task}
          onChange={setTask}
          activeHint="Usually under a minute. You can leave this page."
        />
      ) : null}
      {suggestion ? (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">Sources</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {suggestion.sources.map((s) => (
              <li key={s.id}>
                {s.enabled ? '✓' : '✗'} {s.name}: {s.note}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
