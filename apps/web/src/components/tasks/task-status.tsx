'use client';

import { TASK_POLL_INTERVAL_MS, type TaskDetail, type TaskSummary } from '@job-agent/shared';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/components/ui/form';
import { apiRequest } from '@/lib/api-client';

/** How each task state is shown to the user. */
export const TASK_STATE_LABELS: Record<
  string,
  { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  QUEUED: { text: 'Queued', tone: 'neutral' },
  RUNNING: { text: 'Running', tone: 'info' },
  RETRY_WAIT: { text: 'Waiting to retry', tone: 'warning' },
  NEEDS_REVIEW: { text: 'Needs review', tone: 'warning' },
  COMPLETED: { text: 'Completed', tone: 'success' },
  FAILED: { text: 'Failed', tone: 'danger' },
  CANCELLED: { text: 'Cancelled', tone: 'neutral' },
};

export const TASK_KIND_LABELS: Record<string, string> = {
  job_match_analysis: 'Match analysis',
  cv_processing: 'CV text extraction',
};

export function taskStateLabel(state: string) {
  return TASK_STATE_LABELS[state] ?? { text: state, tone: 'neutral' as const };
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Keeps a task up to date while it is active: polls GET /api/tasks/:id every 3 s and calls
 * `onFinished` once when it stops being active (completed, failed, cancelled...).
 */
export function useTask(
  initial: TaskSummary | null,
  onFinished?: (task: TaskSummary) => void,
): [TaskSummary | null, (task: TaskSummary | null) => void] {
  const [task, setTask] = useState(initial);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    setTask(initial);
  }, [initial]);

  useEffect(() => {
    if (!task?.active) return;
    const id = task.id;
    let stopped = false;
    const timer = setInterval(() => {
      void apiRequest<{ task: TaskDetail }>(`/api/tasks/${id}`).then((result) => {
        if (stopped || !result.ok) return;
        const next = result.data.task;
        setTask(next);
        if (!next.active) finished.current?.(next);
      });
    }, TASK_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.active]);

  return [task, setTask];
}

/** One line of status for a background task, with a Cancel button while it is active. */
export function TaskStatus({
  task,
  onChange,
  activeHint,
}: {
  task: TaskSummary;
  onChange: (task: TaskSummary) => void;
  /** Extra text while the task is active, e.g. "you can leave this page". */
  activeHint?: string;
}) {
  const [cancelling, setCancelling] = useState(false);
  const label = taskStateLabel(task.state);

  async function cancel() {
    setCancelling(true);
    const result = await apiRequest<{ task: TaskSummary }>(`/api/tasks/${task.id}/cancel`, {
      method: 'POST',
    });
    setCancelling(false);
    if (result.ok) onChange(result.data.task);
  }

  let detail = '';
  if (task.state === 'QUEUED') detail = 'Waiting for the background worker to pick it up.';
  if (task.state === 'RUNNING')
    detail =
      task.failedAttempts > 0 ? `Attempt ${task.failedAttempts + 1} of ${task.maxAttempts}.` : '';
  if (task.state === 'RETRY_WAIT' && task.nextRunAt) {
    detail = `${task.lastReason ?? 'It failed'}. Next try at ${time(task.nextRunAt)}.`;
  }
  if (task.state === 'FAILED' || task.state === 'NEEDS_REVIEW') detail = task.lastReason ?? '';

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
      <Badge tone={label.tone}>{label.text}</Badge>
      {task.cancelRequested && task.active ? (
        <span className="text-zinc-500">Cancelling…</span>
      ) : null}
      {detail ? <span className="text-zinc-600 dark:text-zinc-400">{detail}</span> : null}
      {task.active && activeHint ? <span className="text-zinc-500">{activeHint}</span> : null}
      {task.active && !task.cancelRequested ? (
        <Button size="sm" variant="secondary" disabled={cancelling} onClick={() => void cancel()}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      ) : null}
    </div>
  );
}
