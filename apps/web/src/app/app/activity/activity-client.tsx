'use client';

import { TASK_POLL_INTERVAL_MS, type TaskDetail, type TaskSummary } from '@job-agent/shared';
import { useEffect, useState } from 'react';
import { TASK_KIND_LABELS, TaskStatus, taskStateLabel } from '@/components/tasks/task-status';
import { Alert, Badge, Button } from '@/components/ui/form';
import { apiRequest, describeFailure } from '@/lib/api-client';

const when = (iso: string) => new Date(iso).toLocaleString();
const seconds = (ms: number) =>
  ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`;

function Timeline({ task }: { task: TaskDetail }) {
  return (
    <ol className="flex flex-col gap-3 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800">
      {task.events.map((event) => {
        const label = taskStateLabel(event.toState);
        const sameState = event.fromState === event.toState;
        return (
          <li key={event.id} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              {sameState ? null : <Badge tone={label.tone}>{label.text}</Badge>}
              <span className="text-xs text-zinc-500">{when(event.createdAt)}</span>
            </span>
            <span className="text-zinc-700 dark:text-zinc-300">{event.reason}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Attempts({ task }: { task: TaskDetail }) {
  if (task.attempts.length === 0) return null;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500">
        <tr>
          <th className="py-1 font-medium">Attempt</th>
          <th className="py-1 font-medium">Outcome</th>
          <th className="py-1 font-medium">Started</th>
          <th className="py-1 font-medium">Took</th>
        </tr>
      </thead>
      <tbody>
        {task.attempts.map((a) => (
          <tr key={a.attempt} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-1">{a.attempt}</td>
            <td className="py-1">
              {a.outcome}
              {a.failureKind ? <span className="text-zinc-500"> ({a.failureKind})</span> : null}
            </td>
            <td className="py-1">{when(a.startedAt)}</td>
            <td className="py-1">{a.durationMs === null ? 'running…' : seconds(a.durationMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ActivityClient({ initialTasks }: { initialTasks: TaskSummary[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anyActive = tasks.some((t) => t.active) || Boolean(selected?.active);

  async function refresh() {
    const list = await apiRequest<{ tasks: TaskSummary[] }>('/api/tasks');
    if (list.ok) setTasks(list.data.tasks);
    if (selected) {
      const one = await apiRequest<{ task: TaskDetail }>(`/api/tasks/${selected.id}`);
      if (one.ok) setSelected(one.data.task);
    }
  }

  // Poll only while something is still running.
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void refresh(), TASK_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  });

  async function open(id: string) {
    setError(null);
    const result = await apiRequest<{ task: TaskDetail }>(`/api/tasks/${id}`);
    if (!result.ok) return setError(describeFailure(result.error));
    setSelected(result.data.task);
  }

  if (selected) {
    return (
      <section className="flex flex-col gap-4">
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setSelected(null)}
        >
          ← All activity
        </Button>
        <h2 className="text-xl font-semibold">
          {TASK_KIND_LABELS[selected.kind] ?? selected.kind}
        </h2>
        <TaskStatus task={selected} onChange={() => void refresh()} />
        <p className="text-xs text-zinc-500">
          Created {when(selected.createdAt)} · attempt limit {selected.maxAttempts}
        </p>
        <Timeline task={selected} />
        <Attempts task={selected} />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {tasks.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing yet. Analyse a job on the Jobs page or upload a CV, and it shows up here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {tasks.map((task) => {
            const label = taskStateLabel(task.state);
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => void open(task.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium">{TASK_KIND_LABELS[task.kind] ?? task.kind}</span>
                  <Badge tone={label.tone}>{label.text}</Badge>
                  <span className="ml-auto text-xs text-zinc-500">{when(task.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
